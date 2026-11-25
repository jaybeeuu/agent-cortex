// Tests for skills/workflow/ralph/scripts/idle-check.mjs — the digest the idle watch
// polls.
//
// The two halves are tested apart, as they are built: `buildDigest` is pure, so the
// sorting, stall and lease rules are proven without a tracker, and `runCli` is driven
// against the fake `bd` binary so the queue queries and the exit codes are proven end to
// end. Every instant is injected, so no case waits five minutes or reads the real clock.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTempRoot } from "./helpers/temp-root.mjs";
import { makeFakeBd } from "./helpers/fake-bd.mjs";
import {
  buildDigest,
  lastSignOfLife,
  resolveStallMinutes,
  runCli,
  STALL_MINUTES_ENV,
} from "../skills/workflow/ralph/scripts/idle-check.mjs";

const execFileAsync = promisify(execFile);
const tempRoot = createTempRoot("idle-check-");

const NOW = new Date("2026-11-24T12:10:00Z");

/**
 * A bead as `bd --json` reports it: only the fields the digest reads.
 * @param {Partial<Record<string, unknown>>} [overrides]
 * @returns {Record<string, unknown>}
 */
function createRow(overrides = {}) {
  return { id: "bead-1", status: "in_progress", priority: 1, ...overrides };
}

/**
 * An in-progress row claimed `claimedAt` with no trail entry since.
 * @param {string} id
 * @param {string} claimedAt  ISO-8601 instant
 * @returns {Record<string, unknown>}
 */
function createQuietRow(id, claimedAt) {
  return createRow({ id, heartbeat_at: claimedAt, started_at: claimedAt, updated_at: claimedAt });
}

/** @type {import("../skills/workflow/ralph/scripts/idle-check.mjs").Digest} */
const EMPTY_DIGEST = { ready: [], stalled: [] };

/**
 * Run the CLI against a fake `bd` binary, capturing what it wrote where.
 * @param {object} input
 * @param {string[]} input.argv
 * @param {Awaited<ReturnType<typeof makeFakeBd>>} input.fake
 * @param {Date} [input.now]
 * @param {Record<string, string | undefined>} [input.env]
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
async function runFake({ argv, fake, now = NOW, env = {} }) {
  /** @type {(args: string[]) => Promise<string>} */
  const bd = async (args) => {
    const { stdout } = await execFileAsync(fake.bin, args, {
      encoding: "utf-8",
      env: { ...process.env, FAKE_BD_STATE: fake.state },
    });
    return stdout;
  };
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const exitCode = await runCli({
    argv,
    deps: { bd },
    now,
    env,
    write: (chunk) => out.push(chunk),
    writeError: (chunk) => err.push(chunk),
  });
  return { exitCode, stdout: out.join(""), stderr: err.join("") };
}

describe("buildDigest", () => {
  it("the same ids in a different order produce an identical digest", () => {
    const first = buildDigest({
      ready: [createRow({ id: "bead-b", status: "open" }), createRow({ id: "bead-a", status: "open" })],
      inProgress: [createQuietRow("bead-d", "2026-11-24T11:50:00Z"), createQuietRow("bead-c", "2026-11-24T11:40:00Z")],
      thresholdMinutes: 5,
      now: NOW,
    });
    const second = buildDigest({
      ready: [createRow({ id: "bead-a", status: "open" }), createRow({ id: "bead-b", status: "open" })],
      inProgress: [createQuietRow("bead-c", "2026-11-24T11:40:00Z"), createQuietRow("bead-d", "2026-11-24T11:50:00Z")],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(first, second);
    assert.deepEqual(
      first.ready.map((entry) => entry.id),
      ["bead-a", "bead-b"],
    );
  });

  it("a ready bead that arrives changes the digest", () => {
    const before = buildDigest({ ready: [], inProgress: [], thresholdMinutes: 5, now: NOW });
    const after = buildDigest({
      ready: [createRow({ id: "bead-a", status: "open", priority: 0 })],
      inProgress: [],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(before, EMPTY_DIGEST);
    assert.deepEqual(after.ready, [{ id: "bead-a", priority: 0 }]);
  });

  it("a ready bead that departs changes the digest", () => {
    const before = buildDigest({
      ready: [createRow({ id: "bead-a", status: "open" }), createRow({ id: "bead-b", status: "open" })],
      inProgress: [],
      thresholdMinutes: 5,
      now: NOW,
    });
    const after = buildDigest({
      ready: [createRow({ id: "bead-a", status: "open" })],
      inProgress: [],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(
      before.ready.map((entry) => entry.id),
      ["bead-a", "bead-b"],
    );
    assert.notDeepEqual(before, after);
    assert.deepEqual(after.ready, [{ id: "bead-a", priority: 1 }]);
  });

  it("does not report a bead quiet for exactly the threshold", () => {
    const digest = buildDigest({
      ready: [],
      inProgress: [createQuietRow("bead-1", "2026-11-24T12:05:00Z")],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(digest.stalled, []);
  });

  it("reports a bead quiet past the threshold with its quiet minutes and reason", () => {
    const digest = buildDigest({
      ready: [],
      inProgress: [createQuietRow("bead-1", "2026-11-24T11:58:00Z")],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(digest.stalled, [
      { id: "bead-1", status: "in_progress", quietMinutes: 12, reason: "quiet" },
    ]);
  });

  it("does not report a bead whose last trail entry is inside the threshold", () => {
    const digest = buildDigest({
      ready: [],
      inProgress: [
        createRow({
          id: "bead-1",
          heartbeat_at: "2026-11-24T11:58:00Z",
          updated_at: "2026-11-24T11:58:00Z",
          notes: "[2026-11-24T11:58:00Z] [code] trail:1a2b\nOutcome: partial\n[2026-11-24T12:09:30.250Z] [code] trail:3c4d",
        }),
      ],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(digest.stalled, []);
  });

  it("reports an expired lease immediately, with bd's own reason", () => {
    const digest = buildDigest({
      ready: [],
      inProgress: [
        createRow({
          id: "bead-1",
          heartbeat_at: "2026-11-24T12:09:00Z",
          lease_expires_at: "2026-11-24T12:09:30Z",
        }),
      ],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(digest.stalled, [
      { id: "bead-1", status: "in_progress", quietMinutes: 1, reason: "lease-expired" },
    ]);
  });

  it("reports an in-progress bead with no timestamp at all as having no activity", () => {
    const digest = buildDigest({
      ready: [],
      inProgress: [createRow({ id: "bead-1" })],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(digest.stalled, [
      { id: "bead-1", status: "in_progress", quietMinutes: null, reason: "no-activity" },
    ]);
    assert.equal(lastSignOfLife(createRow({ id: "bead-1" })), null);
  });

  it("ignores a row that is not in progress", () => {
    const digest = buildDigest({
      ready: [],
      inProgress: [createRow({ id: "bead-1", status: "open", heartbeat_at: "2026-11-24T10:00:00Z" })],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(digest.stalled, []);
  });
});

describe("resolveStallMinutes", () => {
  it("defaults to five minutes", () => {
    assert.equal(resolveStallMinutes({}), 5);
    assert.equal(resolveStallMinutes({ env: "" }), 5);
  });

  it("reads the environment when no flag is given, and the flag when both are", () => {
    assert.equal(resolveStallMinutes({ env: "30" }), 30);
    assert.equal(resolveStallMinutes({ flag: "2", env: "30" }), 2);
  });

  it("refuses a threshold that is not a number of minutes", () => {
    assert.throws(() => resolveStallMinutes({ flag: "soon" }), /stall minutes must be a number/);
  });
});

describe("runCli", () => {
  it("prints only the documented digest on stdout", async () => {
    const workspace = await tempRoot.createWorkspace();
    const fake = await makeFakeBd(workspace, {
      beads: [
        { id: "bead-b", title: "second", labels: ["execution:afk"], priority: 3 },
        { id: "bead-a", title: "first", labels: ["execution:afk"], priority: 0 },
      ],
    });

    const { exitCode, stdout, stderr } = await runFake({ argv: [], fake });

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    const digest = JSON.parse(stdout);
    assert.deepEqual(Object.keys(digest), ["ready", "stalled"]);
    assert.deepEqual(digest, {
      ready: [
        { id: "bead-a", priority: 0 },
        { id: "bead-b", priority: 3 },
      ],
      stalled: [],
    });
    // Nothing else on the stream: no banner, no timestamp, no trailing summary.
    assert.equal(stdout, `${JSON.stringify(digest, null, 2)}\n`);
  });

  it("reports an in-progress bead through the tracker, using the documented queries", async () => {
    const workspace = await tempRoot.createWorkspace();
    const fake = await makeFakeBd(workspace, {
      beads: [
        { id: "bead-done", title: "claimed", labels: ["execution:afk"], status: "in_progress", heartbeat_at: "2026-11-24T11:58:00Z" },
        { id: "bead-busy", title: "busy", labels: ["execution:afk"], status: "in_progress", heartbeat_at: "2026-11-24T12:09:00Z" },
        { id: "bead-ready", title: "waiting", labels: ["execution:afk"], priority: 0 },
        { id: "bead-hitl", title: "human", labels: ["execution:hitl"], priority: 0 },
      ],
    });

    const { exitCode, stdout } = await runFake({ argv: [], fake });

    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(stdout), {
      ready: [{ id: "bead-ready", priority: 0 }],
      stalled: [{ id: "bead-done", status: "in_progress", quietMinutes: 12, reason: "quiet" }],
    });
  });

  it("reads the threshold from the flag, and the flag wins over the environment", async () => {
    const workspace = await tempRoot.createWorkspace();
    const fake = await makeFakeBd(workspace, {
      beads: [
        { id: "bead-quiet", title: "quiet", labels: ["execution:afk"], status: "in_progress", heartbeat_at: "2026-11-24T11:58:00Z" },
      ],
    });

    const byEnv = await runFake({ argv: [], fake, env: { [STALL_MINUTES_ENV]: "2" } });
    const byFlag = await runFake({ argv: ["--stall-minutes", "30"], fake, env: { [STALL_MINUTES_ENV]: "2" } });

    /** @type {{ stalled: Array<{ id: string }> }} */
    const envDigest = JSON.parse(byEnv.stdout);
    /** @type {{ stalled: Array<{ id: string }> }} */
    const flagDigest = JSON.parse(byFlag.stdout);

    assert.deepEqual(
      envDigest.stalled.map((entry) => entry.id),
      ["bead-quiet"],
    );
    assert.deepEqual(flagDigest.stalled, []);
  });

  it("exits 1 and prints no digest when the tracker command fails", async () => {
    const result = await runCli({
      argv: [],
      now: NOW,
      env: {},
      deps: {
        bd: async () => {
          throw new Error("bd: database is locked");
        },
      },
      write: () => assert.fail("a failed tracker must print no digest"),
      writeError: () => {},
    });

    assert.equal(result, 1);
  });

  it("exits 1 and prints no digest when the tracker prints something that is not JSON", async () => {
    const result = await runCli({
      argv: [],
      now: NOW,
      env: {},
      deps: { bd: async () => "bd: not read" },
      write: () => assert.fail("an empty tracker answer is not a digest"),
      writeError: () => {},
    });

    assert.equal(result, 1);
  });

  it("exits 2, distinct from a tracker failure, when an argument is unusable", async () => {
    const result = await runCli({
      argv: ["--stall-minutes", "soon"],
      now: NOW,
      env: {},
      deps: { bd: async () => "[]" },
      write: () => assert.fail("a usage error must print no digest"),
      writeError: () => {},
    });

    assert.equal(result, 2);
  });
});
