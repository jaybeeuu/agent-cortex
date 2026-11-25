import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_TICKS,
  IdleWatch,
  MAX_BACKOFF_MS,
  NUDGE_CUSTOM_TYPE,
  buildNudge,
  changeBetween,
  digestHash,
  digestOf,
} from "./watch.ts";
import type { CommandInvocation, NudgeMessage, Scheduler, TickRun } from "./watch.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A result in the shape the check is asked for: ids under named arrays. */
function result(ready: string[], stalled: string[] = []): string {
  return JSON.stringify({
    ready: ready.map((id) => ({ id, priority: 1 })),
    stalled: stalled.map((id) => ({ id, status: "in_progress", quietMinutes: 6 })),
  });
}

function tick(code: number, stdout = ""): TickRun {
  return { code, stdout, stderr: "", killed: false };
}

/** A run pi terminated for the timeout: the output may be a partial report. */
function timeOut(): TickRun {
  return { code: 143, stdout: result(["agnt-ctx-1"]), stderr: "", killed: true };
}

/**
 * A scheduler the test steps by hand: nothing fires on its own, `fire()` awaits
 * the tick it triggers, and `delay()` reports what the watch asked for.
 */
function createStepScheduler() {
  let pending: Array<{ run: () => void | Promise<void>; delayMs: number }> = [];
  let clock = Date.parse("2026-01-01T00:00:00.000Z");

  const scheduler: Scheduler = {
    now: () => new Date(clock),
    schedule: (callback, delayMs) => {
      const timer = { run: callback, delayMs };
      pending.push(timer);
      return () => {
        pending = pending.filter((queued) => queued !== timer);
      };
    },
  };

  return {
    scheduler,
    /** How many timers are waiting. Zero means the cadence stopped. */
    pending: () => pending.length,
    /** The delay the waiting timer was scheduled with. */
    delay: () => pending[0]?.delayMs,
    /** Run the waiting tick and await everything it starts. */
    async fire(): Promise<void> {
      const [next, ...rest] = pending;
      pending = rest;
      await next?.run();
      clock += next?.delayMs ?? 0;
    },
  };
}

/** One watch over one project, with only the values a test cares about set. */
function createWatch(overrides: { runs: TickRun[]; maxTicks?: number; intervalMs?: number }) {
  const step = createStepScheduler();
  const deliveries: NudgeMessage[] = [];
  const warnings: string[] = [];
  const invocations: CommandInvocation[] = [];
  const scripted = [...overrides.runs];

  const watch = new IdleWatch({
    project: "/projects/one",
    script: "/agent-cortex/skills/idle-check.mjs",
    intervalMs: overrides.intervalMs,
    maxTicks: overrides.maxTicks,
    scheduler: step.scheduler,
    runCommand: async (invocation) => {
      invocations.push(invocation);
      const next = scripted.shift();
      if (next === undefined) throw new Error("no scripted tick left");
      return next;
    },
    deliver: (message) => deliveries.push(message),
    warn: (message) => warnings.push(message),
  });

  return { watch, step, deliveries, warnings, invocations };
}

// ─── Digest ──────────────────────────────────────────────────────────────────

describe("digestOf", () => {
  it("reduces a result to the ids it mentions, tagged with the list that carried them", () => {
    assert.deepEqual(digestOf(result(["agnt-ctx-2", "agnt-ctx-1"], ["agnt-ctx-9"])), [
      "ready:agnt-ctx-1",
      "ready:agnt-ctx-2",
      "stalled:agnt-ctx-9",
    ]);
  });

  it("ignores everything that is not an id, so a reordering is not a change", () => {
    const one = JSON.stringify({ ready: [{ id: "a", priority: 1 }] });
    const two = JSON.stringify({ ready: [{ id: "a", priority: 0, priority_name: "P0" }] });

    assert.deepEqual(digestOf(one), digestOf(two));
    assert.equal(digestHash(digestOf(one) ?? []), digestHash(digestOf(two) ?? []));
  });

  it("carries no digest for output that is empty, not JSON, or not an object", () => {
    for (const stdout of ["", "  \n", "tracker could not be read", "[]", "42", "null"]) {
      assert.equal(digestOf(stdout), undefined, `stdout ${JSON.stringify(stdout)} has no digest`);
    }
  });

  it("names no id for a result that has none", () => {
    assert.deepEqual(digestOf(JSON.stringify({ ready: [], stalled: [] })), []);
  });
});

describe("changeBetween", () => {
  it("reports an arrival and a departure as the ids that moved", () => {
    assert.deepEqual(changeBetween(["ready:a"], ["ready:a", "ready:b"]), {
      added: ["ready:b"],
      removed: [],
    });
    assert.deepEqual(changeBetween(["ready:a", "ready:b"], ["ready:b"]), {
      added: [],
      removed: ["ready:a"],
    });
  });

  it("reports a bead that became stalled, because its tag moved with it", () => {
    assert.deepEqual(changeBetween(["ready:a"], ["stalled:a"]), {
      added: ["stalled:a"],
      removed: ["ready:a"],
    });
  });
});

// ─── Nudge payload ───────────────────────────────────────────────────────────

describe("buildNudge", () => {
  it("carries the changed ids and no other part of the result", () => {
    const nudge = buildNudge({
      project: "/projects/one",
      script: "/agent-cortex/skills/idle-check.mjs",
      added: ["ready:agnt-ctx-2"],
      removed: ["ready:agnt-ctx-1"],
      checksRun: 4,
      maxTicks: 40,
      at: "2026-01-01T00:01:00.000Z",
    });

    assert.equal(nudge.customType, NUDGE_CUSTOM_TYPE);
    assert.equal(nudge.display, true);
    assert.match(nudge.content, /ready:agnt-ctx-2/);
    assert.match(nudge.content, /ready:agnt-ctx-1/);
    assert.match(nudge.content, /Tick: 4 of 40/);
    assert.deepEqual(nudge.details.added, ["ready:agnt-ctx-2"]);
    assert.deepEqual(nudge.details.removed, ["ready:agnt-ctx-1"]);
  });
});

// ─── The cadence ─────────────────────────────────────────────────────────────

describe("IdleWatch cadence", () => {
  it("returns before it runs the check, so the caller's turn is not held open", () => {
    const { watch, step, invocations } = createWatch({ runs: [tick(0, result(["a"]))] });

    watch.start();

    assert.equal(watch.active, true);
    assert.equal(step.pending(), 1, "the first tick is scheduled, not run");
    assert.deepEqual(invocations, [], "no child process starts during the call");
  });

  it("sends one message on the first digest and nothing while it repeats", async () => {
    const { watch, step, deliveries } = createWatch({
      runs: [tick(0, result(["a"])), tick(0, result(["a"])), tick(0, result(["a"]))],
    });

    watch.start();
    await step.fire();
    assert.equal(deliveries.length, 1, "the first digest is a change from nothing");
    assert.deepEqual(deliveries[0].details.added, ["ready:a"]);

    await step.fire();
    await step.fire();

    assert.equal(deliveries.length, 1, "an unchanged digest sends nothing");
  });

  it("establishes the first digest silently when it names no ids, so an empty queue wakes nobody", async () => {
    // A watch armed on an empty queue is the designed case. Its first digest is a
    // baseline, not an arrival, so an empty first result reports "0 added, 0
    // removed" to nobody; the first id to arrive is the change.
    const { watch, step, deliveries } = createWatch({
      runs: [tick(0, result([])), tick(0, result(["agnt-ctx-1"]))],
    });

    watch.start();
    await step.fire();

    assert.equal(deliveries.length, 0, "an empty first result is a baseline, not a change");

    await step.fire();

    assert.equal(deliveries.length, 1, "the first id to arrive is the change");
    assert.deepEqual(deliveries[0].details.added, ["ready:agnt-ctx-1"]);
    assert.deepEqual(deliveries[0].details.removed, []);
  });

  it("sends exactly one message carrying the changed ids when the digest changes", async () => {
    const { watch, step, deliveries } = createWatch({
      runs: [tick(0, result(["a"])), tick(0, result(["a", "b"]))],
    });

    watch.start();
    await step.fire();
    await step.fire();

    assert.equal(deliveries.length, 2);
    assert.deepEqual(deliveries[1].details.added, ["ready:b"]);
    assert.deepEqual(deliveries[1].details.removed, []);
    assert.equal(deliveries[1].details.checksRun, 2);
  });

  it("sends nothing when the check fails, and keeps watching", async () => {
    const { watch, step, deliveries } = createWatch({
      runs: [tick(0, result(["a"])), tick(1, ""), tick(0, result(["a"])), tick(0, result(["a", "b"]))],
    });

    watch.start();
    await step.fire();
    await step.fire();

    assert.equal(deliveries.length, 1, "a tracker failure wakes nobody");

    await step.fire();
    assert.equal(deliveries.length, 1, "the previous digest stands, so the recovery is no arrival");

    await step.fire();
    assert.equal(deliveries.length, 2, "a failed tick does not end the watch");
    assert.deepEqual(deliveries[1].details.added, ["ready:b"]);
  });

  it("sends nothing when a failed run prints a digestable result, and keeps the previous digest", async () => {
    // A check can print a full-looking report and then fail to exit zero, so the
    // exit code decides whether the run counts, not the shape of its output.
    const { watch, step, deliveries } = createWatch({
      runs: [
        tick(0, result(["agnt-ctx-1"])),
        tick(1, result(["agnt-ctx-2"])),
        tick(0, result(["agnt-ctx-1"])),
      ],
    });

    watch.start();
    await step.fire();
    await step.fire();

    assert.equal(deliveries.length, 1, "a non-zero exit sends nothing, whatever its output says");
    assert.equal(watch.active, true, "a failed run does not end the watch");

    await step.fire();
    assert.equal(deliveries.length, 1, "the failed run left the previous digest in place");
  });

  it("sends nothing when the check times out", async () => {
    const { watch, step, deliveries } = createWatch({ runs: [tick(0, result(["a"])), timeOut()] });

    watch.start();
    await step.fire();
    await step.fire();

    assert.equal(deliveries.length, 1);
    assert.equal(watch.status.checksRun, 2, "the timed-out tick still counts and still watches");
    assert.equal(watch.active, true);
  });

  it("sends nothing when a run is killed, even though its exit code is zero", async () => {
    // pi's ExecResult covers abort and output over maxBuffer as well as timeout,
    // so a killed run need not carry a non-zero code: `killed` is the only signal.
    const { watch, step, deliveries } = createWatch({
      runs: [
        tick(0, result(["agnt-ctx-1"])),
        { code: 0, stdout: result(["agnt-ctx-2"]), stderr: "", killed: true },
        tick(0, result(["agnt-ctx-1"])),
      ],
    });

    watch.start();
    await step.fire();
    await step.fire();

    assert.equal(deliveries.length, 1, "a killed run sends nothing, whatever its output says");
    assert.equal(watch.active, true, "a killed run does not end the watch");

    await step.fire();
    assert.equal(deliveries.length, 1, "the killed run left the previous digest in place");
  });

  it("sends nothing when the check runner throws, and reports it once", async () => {
    const step = createStepScheduler();
    const deliveries: NudgeMessage[] = [];
    const warnings: string[] = [];
    let calls = 0;
    const watch = new IdleWatch({
      project: "/projects/one",
      script: "/agent-cortex/skills/idle-check.mjs",
      scheduler: step.scheduler,
      runCommand: async () => {
        calls += 1;
        if (calls === 1) throw new Error("spawn failed");
        return tick(0, result(["a"]));
      },
      deliver: (message) => deliveries.push(message),
      warn: (message) => warnings.push(message),
    });

    watch.start();
    await step.fire();

    assert.deepEqual(deliveries, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /could not run/);

    await step.fire();
    assert.equal(deliveries.length, 1, "the watch survives a runner that threw");
  });

  it("stops at the named bound instead of polling for ever", async () => {
    const { watch, step, deliveries } = createWatch({
      maxTicks: 3,
      runs: [tick(0, result(["a"])), tick(0, result(["b"])), tick(0, result(["c"]))],
    });

    watch.start();
    await step.fire();
    await step.fire();
    await step.fire();

    assert.equal(watch.active, false);
    assert.equal(step.pending(), 0, "no timer survives the last tick");
    assert.equal(watch.status.checksRun, 3);
    assert.equal(watch.status.budgetLeft, 0);
    assert.equal(deliveries.length, 3);
  });

  it("stops instead of waking anyone when the budget runs out", async () => {
    const { watch, step, deliveries } = createWatch({
      maxTicks: 2,
      runs: [tick(0, result(["a"])), tick(1, "")],
    });

    watch.start();
    await step.fire();
    await step.fire();

    assert.equal(deliveries.length, 1, "the spent budget is not itself a nudge");
    assert.equal(watch.active, false);
    assert.equal(step.pending(), 0);
  });

  it("backs off while nothing changes, up to the cap, and resets when something does", async () => {
    const { watch, step } = createWatch({
      runs: [
        tick(0, result(["a"])),
        tick(0, result(["a"])),
        tick(0, result(["a"])),
        tick(0, result(["a"])),
        tick(0, result(["a"])),
        tick(0, result(["b"])),
      ],
    });

    watch.start();
    assert.equal(step.delay(), DEFAULT_INTERVAL_MS, "the first tick waits the base interval");

    await step.fire();
    assert.equal(step.delay(), DEFAULT_INTERVAL_MS, "a change keeps the base interval");
    await step.fire();
    assert.equal(step.delay(), DEFAULT_INTERVAL_MS * 2, "one quiet tick doubles it");
    await step.fire();
    assert.equal(step.delay(), DEFAULT_INTERVAL_MS * 4);
    await step.fire();
    assert.equal(step.delay(), MAX_BACKOFF_MS, "the cap holds the interval down");
    await step.fire();
    assert.equal(step.delay(), MAX_BACKOFF_MS);
    await step.fire();
    assert.equal(step.delay(), DEFAULT_INTERVAL_MS, "a change puts the interval back to base");
  });

  it("gives a started watch a fresh budget and no previous digest", async () => {
    const { watch, step, deliveries } = createWatch({
      maxTicks: 2,
      runs: [tick(0, result(["a"])), tick(0, result(["a"])), tick(0, result(["a"]))],
    });

    watch.start();
    await step.fire();
    await step.fire();
    assert.equal(watch.active, false, "the budget is spent");

    watch.start();
    assert.deepEqual(
      { watching: watch.active, checks: watch.status.checksRun, left: watch.status.budgetLeft },
      { watching: true, checks: 0, left: 2 },
    );

    await step.fire();
    assert.equal(deliveries.length, 2, "the first tick after a restart reports what is there");
    assert.deepEqual(deliveries[1].details.added, ["ready:a"]);
  });

  it("stops the cadence when it is told to, and leaves the counts readable", async () => {
    const { watch, step, deliveries } = createWatch({ runs: [tick(0, result(["a"]))] });

    watch.start();
    await step.fire();
    watch.stop();

    assert.equal(watch.active, false);
    assert.equal(step.pending(), 0, "the pending timer is cancelled");
    assert.equal(deliveries.length, 1);
    assert.equal(watch.status.checksRun, 1);
  });
  it("sends nothing when a check is in flight as the watch stops", async () => {
    // `stop()` cancels the next timer, but a tick already awaiting its check
    // cannot be cancelled. It must deliver nothing when it resumes, or a stopped
    // watch — and a session that has shut down — can still push a follow-up.
    const step = createStepScheduler();
    const deliveries: NudgeMessage[] = [];
    const invocations: CommandInvocation[] = [];
    let finish: ((run: TickRun) => void) | undefined;

    const watch = new IdleWatch({
      project: "/projects/one",
      script: "/agent-cortex/skills/idle-check.mjs",
      scheduler: step.scheduler,
      runCommand: (invocation) => {
        invocations.push(invocation);
        return new Promise<TickRun>((resolve) => {
          finish = resolve;
        });
      },
      deliver: (message) => deliveries.push(message),
    });

    watch.start();
    const ticking = step.fire();
    assert.equal(invocations.length, 1, "the check is in flight");
    assert.equal(watch.active, true);

    watch.stop();
    finish?.(tick(0, result(["agnt-ctx-1"])));
    await ticking;

    assert.deepEqual(deliveries, [], "a stopped watch sends nothing for a check it no longer owns");
    assert.equal(watch.status.nudgesSent, 0);
    assert.equal(step.pending(), 0, "a stopped watch schedules no next tick");
  });
});

// ─── Status ──────────────────────────────────────────────────────────────────

describe("IdleWatch status", () => {
  it("reports watching, the last check, the checks run, the nudges sent and the budget left", async () => {
    const { watch, step } = createWatch({
      maxTicks: 5,
      runs: [tick(0, result(["a"])), tick(0, result(["a", "b"]))],
    });

    assert.deepEqual(
      {
        watching: watch.status.watching,
        lastCheck: watch.status.lastCheck,
        checks: watch.status.checksRun,
        nudges: watch.status.nudgesSent,
        left: watch.status.budgetLeft,
      },
      { watching: false, lastCheck: null, checks: 0, nudges: 0, left: 5 },
    );

    watch.start();
    await step.fire();
    await step.fire();

    const status = watch.status;
    assert.equal(status.watching, true);
    assert.equal(status.checksRun, 2);
    assert.equal(status.nudgesSent, 2);
    assert.equal(status.budgetLeft, 3);
    assert.equal(status.maxTicks, 5);
    assert.equal(status.lastCheck, "2026-01-01T00:00:15.000Z");
    assert.equal(status.script, "/agent-cortex/skills/idle-check.mjs");
    assert.equal(status.project, "/projects/one");
  });

  it("counts a failed tick as budget spent", async () => {
    const { watch, step } = createWatch({ maxTicks: 4, runs: [tick(1, "")] });

    watch.start();
    await step.fire();

    assert.deepEqual(
      { checks: watch.status.checksRun, nudges: watch.status.nudgesSent, left: watch.status.budgetLeft },
      { checks: 1, nudges: 0, left: 3 },
    );
  });

  it("defaults to the documented bound", () => {
    const { watch } = createWatch({ runs: [] });

    assert.equal(watch.status.maxTicks, DEFAULT_MAX_TICKS);
    assert.equal(watch.status.budgetLeft, DEFAULT_MAX_TICKS);
  });
});
