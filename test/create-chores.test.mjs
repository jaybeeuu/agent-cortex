import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeFakeBd } from "./helpers/fake-bd.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const CREATE_CHORES = join(testDir, "..", "skills", "planning", "create-task", "scripts", "create-chores.mjs");

/**
 * A bead the fake `bd` created, with every flag the fake records.
 * @typedef {object} FakeBead
 * @property {string} id
 * @property {string} title
 * @property {string[]} labels
 * @property {string | null} parent
 * @property {string} type
 * @property {string} description
 * @property {boolean} validated
 */

/** The bead with `id`, or a failure when the run created no such bead.
 * @param {FakeBead[]} beads @param {string} id @returns {FakeBead} */
function requireBead(beads, id) {
  const bead = beads.find((candidate) => candidate.id === id);
  assert.ok(bead, `the run created no bead with id ${id}`);
  return bead;
}

/** Run create-chores.mjs against the fake `bd` with a parent that already
 * carries execution:afk — the label `bd create --parent` inherits.
 * @param {string[]} parentLabels  Labels seeded on the parent bead
 * @returns {Promise<{ ids: Record<string, string>, beads: FakeBead[] }>} */
async function createChoresAgainstFakeBd(parentLabels) {
  const dir = await mkdtemp(join(tmpdir(), "create-chores-"));
  const { bin, state } = await makeFakeBd(dir, {
    beads: [{ id: "parent-1", title: "Feature", labels: parentLabels }],
  });

  try {
    const { exitCode, stdout, stderr } = await runScript(
      ["--parent", "parent-1"],
      { BD_PATH: bin, FAKE_BD_STATE: state },
    );
    assert.equal(exitCode, 0, stderr);

    const ids = JSON.parse(stdout);
    const { beads } = JSON.parse(await readFile(state, "utf8"));
    return { ids, beads };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run create-chores.mjs with the given env overrides.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>} */
function runScript(args, env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CREATE_CHORES, ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
      },
    );
  });
}

describe("create-chores", () => {
  it("gives the PR gate exactly its declared labels, without the parent's inherited execution:afk", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["execution:afk"]);

    const gate = requireBead(beads, ids.featurePrReview);
    assert.deepEqual(
      [...gate.labels].sort(),
      ["execution:hitl", "lifecycle:feature-pr"],
    );
  });

  it("still lets stage chores inherit execution:afk from the parent", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["execution:afk"]);

    const codeChore = requireBead(beads, ids.code);
    assert.deepEqual(
      [...codeChore.labels].sort(),
      ["execution:afk", "stage:code"],
    );
  });

  it("validates the PR gate task but not the stage chores", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["execution:afk"]);

    const gate = requireBead(beads, ids.featurePrReview);
    assert.equal(gate.type, "task");
    assert.equal(gate.validated, true);
    assert.match(gate.description, /## Acceptance Criteria/);

    const codeChore = requireBead(beads, ids.code);
    assert.equal(codeChore.validated, false);
  });
});
