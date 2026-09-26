import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeFakeBd } from "./helpers/fake-bd.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const CREATE_CHORES = join(testDir, "..", "skills", "planning", "create-task", "scripts", "create-chores.ts");

/** Run create-chores.ts against the fake `bd` with a parent that already
 * carries implementation-type:afk — the label `bd create --parent` inherits.
 * @param {string[]} parentLabels  Labels seeded on the parent bead
 * @returns {Promise<{ ids: Record<string, string>, beads: Array<{ id: string, title: string, labels: string[] }> }>} */
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

/** Run create-chores.ts with the given env overrides. */
function runScript(args, env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CREATE_CHORES, ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr });
      },
    );
  });
}

describe("create-chores", () => {
  it("gives the PR gate exactly its declared labels, without the parent's inherited implementation-type:afk", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["implementation-type:afk"]);

    const gate = beads.find((b) => b.id === ids.featurePrReview);
    assert.deepEqual(
      [...gate.labels].sort(),
      ["implementation-type:hitl", "lifecycle:feature-pr"],
    );
  });

  it("still lets stage chores inherit implementation-type:afk from the parent", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["implementation-type:afk"]);

    const codeChore = beads.find((b) => b.id === ids.code);
    assert.deepEqual(
      [...codeChore.labels].sort(),
      ["implementation-type:afk", "stage:code"],
    );
  });
});
