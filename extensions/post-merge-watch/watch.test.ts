import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { createTempRoot } from "../../test/helpers/temp-root.mjs";
import {
  PostMergeWatch,
  buildWake,
  readVerdict,
  stateFileFor,
  verdictOf,
  WAKE_CUSTOM_TYPE,
} from "./watch.ts";
import type { CheckRun, Scheduler, WakeMessage, WatchState } from "./watch.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const tempRoot = createTempRoot("post-merge-watch-");

/** The JSON the real check script prints, cut down to the fields the watch reads. */
function report({ reason, runUrl }: { reason: string; runUrl?: string }): string {
  return JSON.stringify({
    outcome: reason,
    reason,
    runs: runUrl === undefined ? [] : [{ databaseId: 1, url: runUrl, status: "completed" }],
  });
}

function run(code: number, stdout = ""): CheckRun {
  return { code, stdout, stderr: "", killed: false };
}

/**
 * A scheduler the test steps by hand: nothing fires on its own, and `fire()`
 * awaits the poll it triggers, so no test sleeps or polls for async work.
 */
function createStepScheduler() {
  let pending: Array<() => void | Promise<void>> = [];
  let clock = Date.parse("2026-01-01T00:00:00.000Z");

  const scheduler: Scheduler = {
    now: () => new Date(clock),
    schedule: (callback) => {
      pending.push(callback);
      return () => {
        pending = pending.filter((queued) => queued !== callback);
      };
    },
  };

  return {
    scheduler,
    /** How many timers are waiting. Zero means no orphan. */
    pending: () => pending.length,
    /** Run the waiting timer and await the poll it starts. */
    async fire(): Promise<void> {
      const [next, ...rest] = pending;
      pending = rest;
      await next?.();
      clock += 15_000;
    },
  };
}

/** A watch over one project and bead, with only the values a test cares about set. */
function createWatch(overrides: {
  runs: CheckRun[];
  stateDir: string;
  project?: string;
  bead?: string;
  maxAttempts?: number;
}) {
  const step = createStepScheduler();
  const deliveries: WakeMessage[] = [];
  const warnings: string[] = [];
  const scripted = [...overrides.runs];

  const watch = new PostMergeWatch({
    bead: overrides.bead ?? "agnt-ctx-86u4.2",
    project: overrides.project ?? "/projects/one",
    script: "/agent-cortex/skills/workflow/ralph/scripts/post-merge-check.mjs",
    stateDir: overrides.stateDir,
    maxAttempts: overrides.maxAttempts,
    scheduler: step.scheduler,
    runCheck: async () => {
      const next = scripted.shift();
      if (next === undefined) throw new Error("no scripted run left");
      return next;
    },
    deliver: (message) => deliveries.push(message),
    warn: (message) => warnings.push(message),
  });

  return { watch, step, deliveries, warnings };
}

/** Read a state file the watch wrote, as data. */
async function readState(path: string): Promise<WatchState> {
  return JSON.parse(await readFile(path, "utf-8")) as WatchState;
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

describe("readVerdict", () => {
  it("takes the verdict from the exit code, not from the report body", () => {
    const verdict = readVerdict(run(1, report({ reason: "run-failed", runUrl: "https://gh/run/9" })));

    assert.equal(verdict.verdict, "failed");
    assert.equal(verdict.exitCode, 1);
    assert.equal(verdict.runUrl, "https://gh/run/9");
  });

  it("reads a killed run as inconclusive, whatever its partial output says", () => {
    const verdict = readVerdict({ code: 143, stdout: "", stderr: "", killed: true });

    assert.equal(verdict.verdict, "inconclusive");
    assert.equal(verdict.reason, "check-timed-out");
    assert.equal(verdict.runUrl, undefined);
  });

  it("reads an unreadable report as inconclusive without inventing a run", () => {
    const verdict = readVerdict(run(2, "gh: not logged in"));

    assert.deepEqual(
      { verdict: verdict.verdict, reason: verdict.reason, runUrl: verdict.runUrl },
      { verdict: "inconclusive", reason: "unreadable-report", runUrl: undefined },
    );
  });

  it("maps every non-zero, non-one exit code to inconclusive", () => {
    assert.deepEqual([0, 1, 2, 127, 143].map(verdictOf), [
      "passed",
      "failed",
      "inconclusive",
      "inconclusive",
      "inconclusive",
    ]);
  });
});

// ─── Wake payload ────────────────────────────────────────────────────────────

describe("buildWake", () => {
  it("names the bead, the verdict and the run URL", () => {
    const wake = buildWake({
      bead: "agnt-ctx-86u4.2",
      verdict: "failed",
      runUrl: "https://github.com/o/r/actions/runs/9",
      exitCode: 1,
      reason: "run-failed",
      attempts: 3,
      project: "/projects/one",
    });

    assert.equal(wake.customType, WAKE_CUSTOM_TYPE);
    assert.equal(wake.display, true);
    assert.match(wake.content, /agnt-ctx-86u4\.2/);
    assert.match(wake.content, /Verdict: failed/);
    assert.match(wake.content, /https:\/\/github\.com\/o\/r\/actions\/runs\/9/);
    assert.deepEqual(wake.details, {
      bead: "agnt-ctx-86u4.2",
      verdict: "failed",
      runUrl: "https://github.com/o/r/actions/runs/9",
      exitCode: 1,
      reason: "run-failed",
      attempts: 3,
      project: "/projects/one",
    });
  });

  it("says no run was reported rather than leaving the line empty", () => {
    const wake = buildWake({
      bead: "agnt-ctx-86u4.2",
      verdict: "inconclusive",
      runUrl: null,
      exitCode: 2,
      reason: "no-run",
      attempts: 40,
      project: "/projects/one",
    });

    assert.match(wake.content, /Run: none reported/);
  });
});

// ─── Watch lifecycle ─────────────────────────────────────────────────────────

describe("PostMergeWatch", () => {
  it("polls while the run is in progress and wakes once when the verdict lands", async () => {
    const stateDir = join(await tempRoot.createWorkspace(), "state");
    const { watch, step, deliveries } = createWatch({
      stateDir,
      runs: [
        run(2, report({ reason: "still-running" })),
        run(2, report({ reason: "still-running" })),
        run(1, report({ reason: "run-failed", runUrl: "https://gh/run/9" })),
      ],
    });

    await watch.start();
    await step.fire();
    await step.fire();

    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0].details, {
      bead: "agnt-ctx-86u4.2",
      verdict: "failed",
      runUrl: "https://gh/run/9",
      exitCode: 1,
      reason: "run-failed",
      attempts: 3,
      project: "/projects/one",
    });
    assert.equal(step.pending(), 0);
    assert.equal(watch.active, false);
  });

  it("gives up at the attempt cap and reports an inconclusive verdict", async () => {
    const stateDir = join(await tempRoot.createWorkspace(), "state");
    const inProgress = run(2, report({ reason: "still-running" }));
    const { watch, step, deliveries } = createWatch({
      stateDir,
      maxAttempts: 3,
      runs: [inProgress, inProgress, inProgress, inProgress],
    });

    await watch.start();
    await step.fire();
    await step.fire();

    assert.equal(deliveries.length, 1);
    assert.deepEqual(
      {
        verdict: deliveries[0].details.verdict,
        reason: deliveries[0].details.reason,
        runUrl: deliveries[0].details.runUrl,
        attempts: deliveries[0].details.attempts,
      },
      { verdict: "inconclusive", reason: "still-running", runUrl: null, attempts: 3 },
    );
    assert.equal(step.pending(), 0);
  });

  it("keeps polling when the check script cannot run, then reports inconclusive", async () => {
    const stateDir = join(await tempRoot.createWorkspace(), "state");
    const step = createStepScheduler();
    const deliveries: WakeMessage[] = [];
    const warnings: string[] = [];

    const watch = new PostMergeWatch({
      bead: "agnt-ctx-86u4.2",
      project: "/projects/one",
      script: "/missing/post-merge-check.mjs",
      stateDir,
      maxAttempts: 2,
      scheduler: step.scheduler,
      runCheck: async () => {
        throw new Error("spawn ENOENT");
      },
      deliver: (message) => deliveries.push(message),
      warn: (message) => warnings.push(message),
    });

    await watch.start();
    await step.fire();

    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].details.verdict, "inconclusive");
    assert.equal(deliveries[0].details.reason, "no-report");
    assert.match(warnings.join("\n"), /spawn ENOENT/);
  });

  it("records one state file per project and bead, and removes it when the watch settles", async () => {
    const stateDir = join(await tempRoot.createWorkspace(), "state");
    const inProgress = () => [run(2, report({ reason: "still-running" }))];
    const sameBeadOtherProject = createWatch({ stateDir, project: "/projects/two", runs: inProgress() });
    const otherBeadSameProject = createWatch({ stateDir, bead: "agnt-ctx-other.1", runs: inProgress() });

    const first = createWatch({ stateDir, runs: inProgress() });
    await first.watch.start();
    await sameBeadOtherProject.watch.start();
    await otherBeadSameProject.watch.start();

    const paths = [
      first.watch.stateFile,
      sameBeadOtherProject.watch.stateFile,
      otherBeadSameProject.watch.stateFile,
    ];
    assert.equal(new Set(paths).size, 3, "one file per project and bead");
    assert.deepEqual(
      { bead: (await readState(paths[0])).bead, project: (await readState(paths[0])).project },
      { bead: "agnt-ctx-86u4.2", project: "/projects/one" },
    );
    assert.deepEqual(
      { bead: (await readState(paths[1])).bead, project: (await readState(paths[1])).project },
      { bead: "agnt-ctx-86u4.2", project: "/projects/two" },
    );

    await first.watch.stop();

    await assert.rejects(stat(paths[0]), "a settled watch leaves no state file");
    assert.equal((await stat(paths[1])).isFile(), true, "another project's watch is untouched");

    await Promise.all([sameBeadOtherProject.watch.stop(), otherBeadSameProject.watch.stop()]);
  });

  it("stops polling and removes its state file when the session shuts down", async () => {
    const stateDir = join(await tempRoot.createWorkspace(), "state");
    const { watch, step, deliveries } = createWatch({
      stateDir,
      runs: [run(2, report({ reason: "still-running" }))],
    });

    await watch.start();
    const stateFile = watch.stateFile;
    assert.equal((await readState(stateFile)).attempts, 1);

    await watch.stop();

    await assert.rejects(stat(stateFile));
    assert.equal(step.pending(), 0);
    assert.equal(watch.active, false);
    assert.deepEqual(deliveries, []);
  });

  it("does not wake a session that stopped while a check was in flight", async () => {
    const stateDir = join(await tempRoot.createWorkspace(), "state");
    const step = createStepScheduler();
    const deliveries: WakeMessage[] = [];
    const gate = createDeferred<CheckRun>();

    const watch = new PostMergeWatch({
      bead: "agnt-ctx-86u4.2",
      project: "/projects/one",
      script: "/agent-cortex/skills/workflow/ralph/scripts/post-merge-check.mjs",
      stateDir,
      scheduler: step.scheduler,
      runCheck: () => gate.promise,
      deliver: (message) => deliveries.push(message),
    });

    const starting = watch.start();
    await watch.stop();
    gate.resolve(run(1, report({ reason: "run-failed", runUrl: "https://gh/run/9" })));
    await starting;

    assert.deepEqual(deliveries, []);
    await assert.rejects(stat(watch.stateFile));
  });
});

describe("stateFileFor", () => {
  it("keeps two projects that share a directory name apart", () => {
    const stateDir = "/state";
    const left = stateFileFor(stateDir, "/work/one/project", "agnt-ctx-86u4.2");
    const right = stateFileFor(stateDir, "/work/two/project", "agnt-ctx-86u4.2");

    assert.notEqual(left, right);
    assert.match(left, /agnt-ctx-86u4\.2/);
    assert.equal(stateFileFor(stateDir, "/work/one/project", "agnt-ctx-86u4.2"), left);
  });
});

/** A promise the test settles itself, so an in-flight check can be held open. */
function createDeferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}
