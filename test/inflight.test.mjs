// Tests for skills/workflow/ralph/scripts/inflight.mjs — the dispatch set, derived from
// beads alone.
//
// The two halves are tested apart, as they are built: `buildInflight` is pure, so the
// dispatch-record reading, the parent roll-up and the liveness rule are proven without a
// tracker; `runCli` is driven against the fake `bd` binary so the query and the exit codes
// are proven end to end. Every instant is injected, so no case waits five minutes or reads
// the real clock.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTempRoot } from "./helpers/temp-root.mjs";
import { makeFakeBd } from "./helpers/fake-bd.mjs";
import { buildInflight, parseDispatch, runCli } from "../skills/workflow/ralph/scripts/inflight.mjs";

const execFileAsync = promisify(execFile);
const tempRoot = createTempRoot("inflight-");

const NOW = new Date("2026-11-24T12:10:00Z");

/**
 * The dispatch trail entry ralph appends with `bd note`, as one line of a bead's notes.
 * @param {object} [fields]
 * @param {string} [fields.at]       ISO-8601 instant of the dispatch
 * @param {string} [fields.kind]     `stage`, `decompose` or `expand`
 * @param {string} [fields.worker]   The agent id the spawn call returned
 * @param {string} [fields.cwd]      Working directory the worker was spawned in
 * @param {string} [fields.session]  Session reference, or `none`
 * @returns {string}
 */
function dispatchLine({
  at = "2026-11-24T12:00:00Z",
  kind = "stage",
  worker = "agent-1",
  cwd = "/work/tree",
  session = "none",
} = {}) {
  return `[${at}] dispatched: kind=${kind} worker=${worker}; cwd=${cwd}; session=${session}`;
}

/**
 * The record ralph appends when it handles a worker's result, on the bead that carries the
 * dispatch record.
 * @param {object} [fields]
 * @param {string} [fields.at]      ISO-8601 instant of the completion
 * @param {string} [fields.kind]    `stage`, `decompose` or `expand`
 * @param {string} [fields.worker]  The agent id the dispatch named
 * @returns {string}
 */
function completionLine({ at = "2026-11-24T12:08:00Z", kind = "stage", worker = "agent-1" } = {}) {
  return `[${at}] completed: kind=${kind} worker=${worker}`;
}

/**
 * A bead as `bd list -s in_progress --json` reports it: only the fields the query reads.
 * @param {Partial<Record<string, unknown>>} [overrides]
 * @returns {Record<string, unknown>}
 */
function createRow(overrides = {}) {
  return { id: "bead-1", status: "in_progress", heartbeat_at: "2026-11-24T12:05:00Z", ...overrides };
}

/**
 * A claimed chore belonging to `parent`, its worker dispatched one minute ago.
 * @param {object} input
 * @param {string} input.id
 * @param {string} [input.parent]
 * @param {Record<string, unknown>} [input.row]  Further row fields (a lease, a note, a status)
 * @returns {Record<string, unknown>}
 */
function createChore({ id, parent = "feat-1", row = {} }) {
  return createRow({
    id,
    parent,
    labels: ["execution:afk", "stage:code"],
    notes: dispatchLine({ at: "2026-11-24T12:05:00Z", worker: `agent-${id}` }),
    ...row,
  });
}

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

describe("parseDispatch", () => {
  it("reads the kind, the worker and the two trailing fields off one dispatch line", () => {
    const dispatch = parseDispatch(
      "[2026-11-24T12:05:00Z] [code] trail:abc123\nOutcome: done\nWhat is left: none\n" +
        dispatchLine({ at: "2026-11-24T12:06:00Z", kind: "stage", worker: "agent-7", cwd: "/w", session: "PI_SESSION_ID=s1" }),
    );

    assert.deepEqual(dispatch, {
      at: "2026-11-24T12:06:00Z",
      kind: "stage",
      worker: "agent-7",
      cwd: "/w",
      session: "PI_SESSION_ID=s1",
    });
  });

  it("keeps a working directory that contains spaces", () => {
    const dispatch = parseDispatch(dispatchLine({ cwd: "/work/my tree", session: "none" }));

    assert.equal(dispatch?.cwd, "/work/my tree");
  });

  it("reads the newest dispatch when a bead was dispatched twice", () => {
    const notes = [dispatchLine({ worker: "agent-old" }), dispatchLine({ worker: "agent-new" })].join("\n");

    assert.equal(parseDispatch(notes)?.worker, "agent-new");
  });

  it("reads no dispatch off a trail that only carries stage checkpoints", () => {
    const notes = "[2026-11-24T12:05:00Z] [code] trail:abc123\nOutcome: done\nEvidence: 3 tests\n";

    assert.equal(parseDispatch(notes), null);
  });

  it("reads no dispatch off a bead that carries no notes at all", () => {
    assert.equal(parseDispatch(""), null);
  });
});

describe("buildInflight", () => {
  it("reports a claimed chore carrying a dispatch entry as in flight", () => {
    const digest = buildInflight({
      inProgress: [createChore({ id: "chore-1", parent: "feat-1" })],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.equal(digest.inflight.length, 1);
    assert.equal(digest.inflight[0]?.id, "chore-1");
    assert.equal(digest.inflight[0]?.kind, "stage");
    assert.equal(digest.inflight[0]?.parentId, "feat-1");
    assert.equal(digest.inflight[0]?.worker, "agent-chore-1");
    assert.equal(digest.inflight[0]?.liveness, "running");
    assert.deepEqual(digest.parents, ["feat-1"]);
  });

  it("reports nothing for a bead that is no longer in progress", () => {
    // A completed stage is closed, so the in-progress read never returns it: the work
    // leaves the query by leaving the status, with no record to delete.
    const digest = buildInflight({ inProgress: [], thresholdMinutes: 5, now: NOW });

    assert.deepEqual(digest, { inflight: [], parents: [], stalled: [], unrecorded: [] });
  });

  it("reports a decomposition worker under the feature bead it decomposes", () => {
    const feature = createRow({
      id: "feat-1",
      type: "feature",
      notes: dispatchLine({ kind: "decompose", worker: "agent-d" }),
    });

    const digest = buildInflight({ inProgress: [feature], thresholdMinutes: 5, now: NOW });

    assert.equal(digest.inflight[0]?.kind, "decompose");
    assert.equal(digest.inflight[0]?.parentId, "feat-1");
    assert.equal(digest.inflight[0]?.worker, "agent-d");
  });

  it("reports an expansion worker under the task bead it expands", () => {
    const task = createRow({
      id: "task-1",
      type: "task",
      notes: dispatchLine({ kind: "expand", worker: "agent-e" }),
    });

    const digest = buildInflight({ inProgress: [task], thresholdMinutes: 5, now: NOW });

    assert.equal(digest.inflight[0]?.kind, "expand");
    assert.equal(digest.inflight[0]?.parentId, "task-1");
  });

  it("takes the parent from the dependency when the row carries no parent field", () => {
    const chore = createChore({ id: "chore-1", row: { parent: undefined } });
    chore.dependencies = [{ id: "feat-9", dependency_type: "parent-child" }];

    const digest = buildInflight({ inProgress: [chore], thresholdMinutes: 5, now: NOW });

    assert.equal(digest.inflight[0]?.parentId, "feat-9");
  });

  it("reports an in-progress bead with no dispatch entry as unrecorded rather than in flight", () => {
    const digest = buildInflight({
      inProgress: [createRow({ id: "chore-1", parent: "feat-1", notes: "" })],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(digest.inflight, []);
    assert.deepEqual(digest.unrecorded, ["chore-1"]);
  });

  it("counts one parent once however many of its workers are in flight", () => {
    const digest = buildInflight({
      inProgress: [
        createChore({ id: "chore-1", parent: "feat-1" }),
        createChore({ id: "chore-2", parent: "feat-1" }),
        createChore({ id: "chore-3", parent: "feat-2" }),
      ],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(digest.parents, ["feat-1", "feat-2"]);
  });

  it("counts a parent as owned, not unrecorded, while its worker is in flight", () => {
    const digest = buildInflight({
      inProgress: [
        createRow({ id: "feat-1", notes: "" }),
        createChore({ id: "chore-1", parent: "feat-1" }),
      ],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.deepEqual(digest.unrecorded, []);
  });

  it("leaves the dispatch set when the newest record on the bead is a completion", () => {
    // A decomposition worker holds no chore, so the record sits on the feature bead, whose
    // status stays in progress after the worker is done.
    const feature = createRow({
      id: "feat-1",
      type: "feature",
      notes: [dispatchLine({ kind: "decompose" }), completionLine({ kind: "decompose" })].join("\n"),
    });

    const digest = buildInflight({ inProgress: [feature], thresholdMinutes: 5, now: NOW });

    assert.deepEqual(digest, { inflight: [], parents: [], stalled: [], unrecorded: [] });
  });

  it("keeps a bead in the dispatch set when a newer dispatch follows a completion", () => {
    const feature = createRow({
      id: "feat-1",
      type: "feature",
      notes: [
        dispatchLine({ kind: "decompose", worker: "agent-old" }),
        completionLine({ kind: "decompose", worker: "agent-old" }),
        dispatchLine({ at: "2026-11-24T12:07:00Z", kind: "expand", worker: "agent-new" }),
      ].join("\n"),
    });

    const digest = buildInflight({ inProgress: [feature], thresholdMinutes: 5, now: NOW });

    assert.deepEqual(digest.inflight.map((entry) => entry.worker), ["agent-new"]);
  });

  it("reports a worker silent past the threshold as stalled, with the idle check's reason", () => {
    const digest = buildInflight({
      inProgress: [
        createChore({
          id: "chore-1",
          row: { heartbeat_at: "2026-11-24T11:50:00Z", notes: dispatchLine({ at: "2026-11-24T11:50:00Z" }) },
        }),
      ],
      thresholdMinutes: 5,
      now: NOW,
    });

    assert.equal(digest.inflight[0]?.liveness, "stalled");
    assert.equal(digest.inflight[0]?.reason, "quiet");
    assert.equal(digest.inflight[0]?.quietMinutes, 20);
    assert.deepEqual(digest.stalled, ["chore-1"]);
  });

  it("reports an expired lease as stalled before the threshold elapses", () => {
    const digest = buildInflight({
      inProgress: [
        createChore({
          id: "chore-1",
          row: { heartbeat_at: "2026-11-24T12:09:00Z", lease_expires_at: "2026-11-24T12:09:30Z" },
        }),
      ],
      thresholdMinutes: 30,
      now: NOW,
    });

    assert.equal(digest.inflight[0]?.liveness, "stalled");
    assert.equal(digest.inflight[0]?.reason, "lease-expired");
    assert.deepEqual(digest.stalled, ["chore-1"]);
  });

  it("sorts the workers and the parents so the same dispatch set prints the same digest", () => {
    const rows = [
      createChore({ id: "chore-b", parent: "feat-b" }),
      createChore({ id: "chore-a", parent: "feat-a" }),
    ];
    const reversed = [...rows].reverse();

    assert.deepEqual(
      buildInflight({ inProgress: rows, thresholdMinutes: 5, now: NOW }),
      buildInflight({ inProgress: reversed, thresholdMinutes: 5, now: NOW }),
    );
  });
});

describe("runCli", () => {
  it("prints the dispatch set as JSON over the beads the tracker reports", async () => {
    const fake = await makeFakeBd(await tempRoot.createWorkspace(), {
      beads: [
        { id: "feat-1", title: "Add auth", labels: ["execution:afk"], status: "in_progress" },
        {
          id: "chore-1",
          title: "[feat-1] Code",
          labels: ["execution:afk", "stage:code"],
          parent: "feat-1",
          status: "in_progress",
          heartbeat_at: "2026-11-24T12:05:00Z",
          notes: dispatchLine({ worker: "agent-9" }),
        },
      ],
    });

    const { exitCode, stdout } = await runFake({ argv: [], fake });

    assert.equal(exitCode, 0);
    const digest = JSON.parse(stdout);
    assert.deepEqual(digest.parents, ["feat-1"]);
    assert.deepEqual(
      digest.inflight.map(
        /** @param {Record<string, unknown>} entry */ (entry) => [entry.id, entry.worker, entry.liveness],
      ),
      [["chore-1", "agent-9", "running"]],
    );
    // The feature is in progress without a dispatch record of its own, but its worker is in
    // flight, so it is owned rather than unexplained.
    assert.deepEqual(digest.unrecorded, []);
  });

  it("reads only in-progress beads, so a completed stage never reaches the answer", async () => {
    const fake = await makeFakeBd(await tempRoot.createWorkspace(), {
      beads: [
        {
          id: "chore-1",
          title: "[feat-1] Code",
          labels: ["execution:afk", "stage:code"],
          parent: "feat-1",
          status: "closed",
          notes: dispatchLine(),
        },
      ],
    });

    const { exitCode, stdout } = await runFake({ argv: [], fake });

    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(stdout).inflight, []);
  });

  it("prints no digest and exits 1 when the tracker cannot be read", async () => {
    const fake = await makeFakeBd(await tempRoot.createWorkspace(), { beads: [], failures: [{ command: "list" }] });

    const { exitCode, stdout, stderr } = await runFake({ argv: [], fake });

    assert.equal(exitCode, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /failed/);
  });

  it("exits 2 on an argument it cannot use", async () => {
    const fake = await makeFakeBd(await tempRoot.createWorkspace(), { beads: [] });

    const { exitCode, stderr } = await runFake({ argv: ["--stall-minutes", "soon"], fake });

    assert.equal(exitCode, 2);
    assert.match(stderr, /stall minutes/);
  });
});
