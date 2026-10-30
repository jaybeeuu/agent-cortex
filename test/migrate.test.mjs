// Behaviour tests for `agent-cortex migrate` (v1: implementation-type:* →
// execution:*), driven through the process boundary against a stateful fake
// `bd` (test/helpers/fake-bd-migrate.mjs) so the real beads database is never
// touched. Assertions are on the workspace's resulting label state and
// recorded writes — the observable effect of the command.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeFakeBdMigrate } from "./helpers/fake-bd-migrate.mjs";

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "agent-cortex.mjs");

/**
 * Run `agent-cortex migrate` against a fake beads workspace.
 *
 * @param {string[]} args
 * @param {{ bin: string, state: string }} workspace
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
function runMigrate(args, { bin, state }) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI_PATH, "migrate", ...args],
      { env: { ...process.env, BD_PATH: bin, FAKE_BD_STATE: state } },
      (error, stdout, stderr) => resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr }),
    );
  });
}

/** @param {string} statePath @returns {Promise<{ beads: Array<{ id: string, labels: string[] }>, writes: unknown[] }>} */
async function readState(statePath) {
  return JSON.parse(await readFile(statePath, "utf8"));
}

/** Labels of every bead in the fake workspace, keyed by bead id. */
async function readLabels(statePath) {
  const state = await readState(statePath);
  return Object.fromEntries(state.beads.map((bead) => [bead.id, bead.labels]));
}

/**
 * Create a throwaway fake beads workspace, run `fn`, then remove it.
 *
 * @param {Array<{ id: string, labels: string[], status?: string }>} beads
 * @param {(workspace: { bin: string, state: string }) => Promise<void>} fn
 * @param {{
 *   failOn?: string | null,
 *   listHidesClosed?: boolean,
 *   ignoreLabelRemovals?: boolean,
 *   exportDropsLabel?: string | null,
 * }} [options]
 */
async function withWorkspace(beads, fn, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "agent-cortex-migrate-"));
  try {
    await fn(await makeFakeBdMigrate(dir, { beads, ...options }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("agent-cortex migrate v1 label rename", () => {
  it("writes nothing on the default dry run", async () => {
    await withWorkspace(
      [
        { id: "bd-open", labels: ["implementation-type:afk", "epic:epic-1"] },
        { id: "bd-closed", labels: ["implementation-type:hitl"], status: "closed" },
      ],
      async (workspace) => {
        const { exitCode, stdout } = await runMigrate([], workspace);

        assert.equal(exitCode, 0);
        assert.deepEqual(await readLabels(workspace.state), {
          "bd-open": ["implementation-type:afk", "epic:epic-1"],
          "bd-closed": ["implementation-type:hitl"],
        });
        assert.equal((await readState(workspace.state)).writes.length, 0);
        // The plan is the dry run's deliverable: it names every bead it would touch.
        assert.match(stdout, /bd-open/);
        assert.match(stdout, /bd-closed/);
      },
    );
  });

  it("renames legacy labels on open and closed beads when applied", async () => {
    await withWorkspace(
      [
        { id: "bd-open", labels: ["implementation-type:afk"] },
        { id: "bd-closed", labels: ["implementation-type:hitl"], status: "closed" },
      ],
      async (workspace) => {
        const { exitCode } = await runMigrate(["--apply"], workspace);

        assert.equal(exitCode, 0);
        assert.deepEqual(await readLabels(workspace.state), {
          "bd-open": ["execution:afk"],
          "bd-closed": ["execution:hitl"],
        });
      },
    );
  });

  it("gives a bead carrying both legacy labels both execution labels", async () => {
    await withWorkspace(
      [{ id: "bd-both", labels: ["implementation-type:afk", "implementation-type:hitl"] }],
      async (workspace) => {
        const { exitCode } = await runMigrate(["--apply"], workspace);

        assert.equal(exitCode, 0);
        const { "bd-both": labels } = await readLabels(workspace.state);
        assert.deepEqual([...labels].sort(), ["execution:afk", "execution:hitl"]);
      },
    );
  });

  it("is a no-op on a second run", async () => {
    await withWorkspace([{ id: "bd-a", labels: ["implementation-type:afk"] }], async (workspace) => {
      assert.equal((await runMigrate(["--apply"], workspace)).exitCode, 0);
      const afterFirst = await readState(workspace.state);

      const { exitCode } = await runMigrate(["--apply"], workspace);

      assert.equal(exitCode, 0);
      const afterSecond = await readState(workspace.state);
      assert.equal(afterSecond.writes.length, afterFirst.writes.length);
      assert.deepEqual(afterSecond.beads, afterFirst.beads);
    });
  });

  it("reports a workspace whose only pending work is a closed bead", async () => {
    await withWorkspace(
      [{ id: "bd-closed", labels: ["implementation-type:afk"], status: "closed" }],
      async (workspace) => {
        const { exitCode, stdout } = await runMigrate([], workspace);

        assert.equal(exitCode, 0);
        assert.match(stdout, /bd-closed/);
        assert.match(stdout, /1 bead\(s\) pending/);
        assert.doesNotMatch(stdout, /already at v1/);
      },
      { listHidesClosed: true },
    );
  });

  it("renames a closed bead's legacy label when nothing else is pending", async () => {
    await withWorkspace(
      [{ id: "bd-closed", labels: ["implementation-type:hitl"], status: "closed" }],
      async (workspace) => {
        const { exitCode } = await runMigrate(["--apply"], workspace);

        assert.equal(exitCode, 0);
        assert.deepEqual(await readLabels(workspace.state), { "bd-closed": ["execution:hitl"] });
      },
      { listHidesClosed: true },
    );
  });

  it("fails verification and names the closed bead when its legacy label survives the apply", async () => {
    await withWorkspace(
      [{ id: "bd-closed", labels: ["implementation-type:afk"], status: "closed" }],
      async (workspace) => {
        const { exitCode, stderr } = await runMigrate(["--apply"], workspace);

        assert.equal(exitCode, 1);
        assert.match(stderr, /verification failed/);
        assert.match(stderr, /bd-closed/);
      },
      { ignoreLabelRemovals: true },
    );
  });

  it("refuses to report a workspace as migrated when the label index sees a legacy label the export loses", async () => {
    await withWorkspace(
      [{ id: "bd-closed", labels: ["implementation-type:afk"], status: "closed" }],
      async (workspace) => {
        const { exitCode, stderr } = await runMigrate([], workspace);

        assert.equal(exitCode, 1);
        assert.match(stderr, /implementation-type:afk/);
      },
      { exportDropsLabel: "implementation-type:afk" },
    );
  });

  it("fails loudly when bd is not available", async () => {
    await withWorkspace([{ id: "bd-a", labels: ["implementation-type:afk"] }], async ({ state }) => {
      const { exitCode, stderr } = await runMigrate([], { bin: join(dirname(state), "missing-bd"), state });

      assert.equal(exitCode, 1);
      assert.match(stderr, /bd/);
    });
  });

  it("fails loudly when a bd subcommand errors", async () => {
    await withWorkspace(
      [{ id: "bd-a", labels: ["implementation-type:afk"] }],
      async (workspace) => {
        const { exitCode, stderr } = await runMigrate(["--apply"], workspace);

        assert.equal(exitCode, 1);
        assert.match(stderr, /simulated bd error/);
      },
      { failOn: "label add" },
    );
  });
});
