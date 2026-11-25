// The settled-parent close rule, driven through the module boundary and the CLI.
// The only fake is `bd` itself — a genuine external process — because a test
// must never touch the real tracker. Everything else (the decision, the report,
// the exit codes) is the shipped code.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeSettledParent, runCli } from "../skills/workflow/run-pipeline-stage/scripts/close-settled-parent.mjs";

/**
 * @typedef {object} Child
 * @property {string} id
 * @property {string} status
 * @property {string[]} [labels]
 */

/**
 * A stateful fake `bd`: it answers `show`/`children` from `state`, records
 * every `note` and `close` so a test reads what the script actually wrote, and
 * keeps `writes` — every `note`/`close` call in the order it arrived — so a
 * test can assert the order of the writes, not only their content.
 * @param {{ id: string, status?: string, children: Child[] }} seed
 * @returns {{
 *   bd: (args: string[]) => Promise<string>,
 *   state: { parent: { id: string, status: string }, children: Child[], notes: { bead: string, text: string }[], closings: { bead: string, reason: string }[], writes: string[][] },
 * }}
 */
function createBd({ id, status = "open", children }) {
  const state = {
    parent: { id, status },
    children,
    notes: /** @type {{ bead: string, text: string }[]} */ ([]),
    closings: /** @type {{ bead: string, reason: string }[]} */ ([]),
    writes: /** @type {string[][]} */ ([]),
  };
  /** @param {string[]} args */
  const bd = async (args) => {
    switch (args[0]) {
      case "show":
        return JSON.stringify([state.parent]);
      case "children":
        return JSON.stringify(state.children);
      case "note":
        state.writes.push(args);
        state.notes.push({ bead: args[1], text: args[2] });
        return "";
      case "close":
        state.writes.push(args);
        state.closings.push({ bead: args[1], reason: args[2].replace("--reason=", "") });
        state.parent.status = "closed";
        return "";
      default:
        throw new Error(`unexpected bd call: ${args.join(" ")}`);
    }
  };
  return { bd, state };
}

/** @returns {{ write: (chunk: string) => void, writeError: (chunk: string) => void, out: () => string, err: () => string }} */
function capture() {
  let stdout = "";
  let stderr = "";
  return {
    write: (chunk) => {
      stdout += chunk;
    },
    writeError: (chunk) => {
      stderr += chunk;
    },
    out: () => stdout,
    err: () => stderr,
  };
}

describe("closeSettledParent", () => {
  it("closes a parent whose children are all closed and whose gate records the merge", async () => {
    const { bd, state } = createBd({
      id: "proj-1",
      children: [
        { id: "proj-1.1", status: "closed", labels: ["execution:afk", "stage:code"] },
        { id: "proj-1.5", status: "closed", labels: ["execution:hitl", "lifecycle:feature-pr"] },
      ],
    });

    const report = await closeSettledParent({ beadId: "proj-1", bd, now: () => "2026-01-02T03:04:05Z" });

    assert.equal(report.outcome, "closed");
    assert.deepEqual(report.evidence, [{ id: "proj-1.5", label: "lifecycle:feature-pr" }]);
    assert.deepEqual(state.closings, [
      { bead: "proj-1", reason: "settled: all 2 children closed; merge evidence: proj-1.5 (lifecycle:feature-pr)" },
    ]);
  });

  it("closes a parent whose post-merge check passed and no gate child remains", async () => {
    const { bd, state } = createBd({
      id: "proj-1",
      children: [
        { id: "proj-1.1", status: "closed", labels: ["stage:code"] },
        { id: "proj-1.6", status: "closed", labels: ["lifecycle:post-merge", "stage:post-merge"] },
      ],
    });

    const report = await closeSettledParent({ beadId: "proj-1", bd, now: () => "2026-01-02T03:04:05Z" });

    assert.equal(report.outcome, "closed");
    assert.deepEqual(report.evidence, [{ id: "proj-1.6", label: "lifecycle:post-merge" }]);
    assert.equal(state.closings.length, 1);
  });

  it("leaves a parent alone when every child was closed by hand without a merge on record", async () => {
    const { bd, state } = createBd({
      id: "proj-1",
      children: [
        { id: "proj-1.1", status: "closed", labels: ["execution:afk", "stage:code"] },
        { id: "proj-1.2", status: "closed", labels: ["execution:afk", "stage:verify"] },
      ],
    });

    const report = await closeSettledParent({ beadId: "proj-1", bd, now: () => "2026-01-02T03:04:05Z" });

    assert.equal(report.outcome, "skipped");
    assert.equal(report.reason, "no merge evidence");
    assert.deepEqual(state.closings, []);
    assert.deepEqual(state.notes, []);
  });

  it("leaves a parent alone while any child is open, even with the gate closed", async () => {
    const { bd, state } = createBd({
      id: "proj-1",
      children: [
        { id: "proj-1.5", status: "closed", labels: ["execution:hitl", "lifecycle:feature-pr"] },
        { id: "proj-1.6", status: "open", labels: ["lifecycle:housekeeping", "stage:housekeeping"] },
      ],
    });

    const report = await closeSettledParent({ beadId: "proj-1", bd, now: () => "2026-01-02T03:04:05Z" });

    assert.equal(report.outcome, "skipped");
    assert.equal(report.reason, "children open");
    assert.deepEqual(report.openChildren, ["proj-1.6"]);
    assert.deepEqual(state.closings, []);
  });

  it("is a no-op on a second run, so both stages may call it on every pass", async () => {
    const { bd, state } = createBd({
      id: "proj-1",
      children: [{ id: "proj-1.5", status: "closed", labels: ["execution:hitl", "lifecycle:feature-pr"] }],
    });

    await closeSettledParent({ beadId: "proj-1", bd, now: () => "2026-01-02T03:04:05Z" });
    const second = await closeSettledParent({ beadId: "proj-1", bd, now: () => "2026-01-02T03:04:06Z" });

    assert.equal(second.outcome, "skipped");
    assert.equal(second.reason, "already closed");
    assert.equal(state.closings.length, 1);
    assert.equal(state.notes.length, 1);
  });

  it("records the merge evidence in the parent's trail before closing it", async () => {
    const { bd, state } = createBd({
      id: "proj-1",
      children: [
        { id: "proj-1.5", status: "closed", labels: ["execution:hitl", "lifecycle:feature-pr"] },
        { id: "proj-1.6", status: "closed", labels: ["lifecycle:post-merge", "stage:post-merge"] },
      ],
    });

    await closeSettledParent({ beadId: "proj-1", bd, now: () => "2026-01-02T03:04:05Z" });

    assert.deepEqual(
      state.writes.map(([command]) => command),
      ["note", "close"],
      "the note must be written before the close, so the evidence survives a failed close",
    );
    assert.deepEqual(state.notes, [
      {
        bead: "proj-1",
        text:
          "[2026-01-02T03:04:05Z] close-settled-parent: all 2 children closed; merge evidence: " +
          "proj-1.5 (lifecycle:feature-pr), proj-1.6 (lifecycle:post-merge)",
      },
    ]);
  });
});

describe("close-settled-parent CLI", () => {
  it("exits zero and says it closed the parent", async () => {
    const { bd } = createBd({
      id: "proj-1",
      children: [{ id: "proj-1.5", status: "closed", labels: ["execution:hitl", "lifecycle:feature-pr"] }],
    });
    const out = capture();

    const code = await runCli({ argv: ["--parent", "proj-1"], bd, write: out.write, writeError: out.writeError });

    assert.equal(code, 0);
    assert.equal(
      out.out(),
      "closed proj-1: all 1 children closed; merge evidence: proj-1.5 (lifecycle:feature-pr)\n",
    );
  });

  it("exits zero when there is nothing to close, because both stages run routinely", async () => {
    const { bd } = createBd({
      id: "proj-1",
      children: [{ id: "proj-1.6", status: "open", labels: ["lifecycle:housekeeping", "stage:housekeeping"] }],
    });
    const out = capture();

    const code = await runCli({ argv: ["--parent", "proj-1"], bd, write: out.write, writeError: out.writeError });

    assert.equal(code, 0);
    assert.equal(out.out(), "skipped: children open — proj-1 (proj-1.6)\n");
  });

  it("exits zero and reports the no-op on a second run", async () => {
    const { bd } = createBd({
      id: "proj-1",
      children: [{ id: "proj-1.5", status: "closed", labels: ["execution:hitl", "lifecycle:feature-pr"] }],
    });
    const out = capture();
    await runCli({ argv: ["--parent", "proj-1"], bd, write: out.write, writeError: out.writeError });
    const second = capture();

    const code = await runCli({ argv: ["--parent", "proj-1"], bd, write: second.write, writeError: second.writeError });

    assert.equal(code, 0);
    assert.equal(second.out(), "skipped: already closed — proj-1 (nothing to do)\n");
  });

  it("exits one when bd cannot be read, so a genuine error is never reported as success", async () => {
    const out = capture();
    /** @returns {Promise<string>} */
    const unreadable = async () => {
      throw new Error("bd: database is locked");
    };

    const code = await runCli({ argv: ["--parent", "proj-1"], bd: unreadable, write: out.write, writeError: out.writeError });

    assert.equal(code, 1);
    assert.match(out.err(), /close-settled-parent failed: bd: database is locked/);
  });

  it("exits two and prints the usage when --parent is missing", async () => {
    const help = capture();
    await runCli({ argv: ["--help"], write: help.write, writeError: help.writeError });
    const out = capture();

    const code = await runCli({ argv: ["--json"], write: out.write, writeError: out.writeError });

    assert.equal(code, 2);
    assert.match(out.err(), /--parent is required/);
    assert.ok(
      out.err().includes(help.out()),
      `the usage error must print the usage block; stderr was:\n${out.err()}`,
    );
  });
});
