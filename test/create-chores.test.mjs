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
 * A bead the fake `bd` holds, with every flag the fake records.
 * @typedef {object} FakeBead
 * @property {string} id
 * @property {string} title
 * @property {string[]} labels
 * @property {string | null} parent
 * @property {string} type
 * @property {string} description
 * @property {boolean} validated
 */

/**
 * A `blocks` dependency the fake recorded.
 * @typedef {object} FakeDep
 * @property {string} issue_id
 * @property {string} depends_on_id
 * @property {string} type
 */

/**
 * The fake `bd`'s state file.
 * @typedef {object} FakeState
 * @property {FakeBead[]} beads
 * @property {FakeDep[]} deps
 * @property {FakeDep[]} depAdds  Every `dep add` call, in order
 */

/**
 * A bead seeded into the fake before the script runs.
 * @typedef {object} SeedBead
 * @property {string} id
 * @property {string} title
 * @property {string[]} labels
 * @property {string | null} [parent]
 * @property {string[]} [dependsOn]
 */

/**
 * The outcome of one script run.
 * @typedef {object} RunResult
 * @property {number} exitCode
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * A fake `bd` bound to a temp directory, plus the readers a test needs.
 * @typedef {object} FakeBdTools
 * @property {(args?: string[]) => Promise<RunResult>} run
 * @property {() => Promise<FakeState>} readState
 */

/** The `execution:afk` parent bead the script expands.
 * @returns {SeedBead} */
function parentBead() {
  return { id: "parent-1", title: "Feature", labels: ["execution:afk"] };
}

/** A stage chore the fake already holds — what a partially completed expansion leaves.
 * @param {string} id @param {string} stage @param {string[]} [dependsOn]
 * @returns {SeedBead} */
function stageChore(id, stage, dependsOn = []) {
  return {
    id,
    title: `[parent-1] ${stage}`,
    labels: ["execution:afk", `stage:${stage}`],
    parent: "parent-1",
    dependsOn,
  };
}

/** Run one script invocation with the given env overrides.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<RunResult>} */
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

/** Run `body` against a fresh fake `bd` seeded with `beads`, then drop the temp dir.
 * @param {SeedBead[]} beads
 * @param {(tools: FakeBdTools) => Promise<void>} body
 * @returns {Promise<void>} */
async function withFakeBd(beads, body) {
  const dir = await mkdtemp(join(tmpdir(), "create-chores-"));
  const { bin, state } = await makeFakeBd(dir, { beads });

  try {
    await body({
      run: (args = ["--parent", "parent-1"]) =>
        runScript(args, { BD_PATH: bin, FAKE_BD_STATE: state }),
      readState: async () => JSON.parse(await readFile(state, "utf8")),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run create-chores.mjs against a fake `bd` with a parent that already
 * carries `parentLabels` — the labels `bd create --parent` inherits.
 * @param {string[]} parentLabels  Labels seeded on the parent bead
 * @returns {Promise<{ ids: Record<string, string>, beads: FakeBead[], deps: FakeDep[] }>} */
async function createChoresAgainstFakeBd(parentLabels) {
  /** @type {{ ids: Record<string, string>, beads: FakeBead[], deps: FakeDep[] }} */
  let outcome = { ids: {}, beads: [], deps: [] };

  await withFakeBd([{ ...parentBead(), labels: parentLabels }], async ({ run, readState }) => {
    const { exitCode, stdout, stderr } = await run();
    assert.equal(exitCode, 0, stderr);
    const state = await readState();
    outcome = { ids: JSON.parse(stdout), beads: state.beads, deps: state.deps };
  });

  return outcome;
}

/** How many children carry each pipeline role label.
 * @param {FakeBead[]} beads @returns {Record<string, number>} */
function countRoles(beads) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const bead of beads) {
    for (const label of bead.labels) {
      if (label === "lifecycle:feature-pr" || label.startsWith("stage:")) {
        counts[label] = (counts[label] ?? 0) + 1;
      }
    }
  }
  return counts;
}

describe("create-chores", () => {
  it("gives the PR gate exactly its declared labels, without the parent's inherited execution:afk", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["execution:afk"]);

    const gate = beads.find((candidate) => candidate.id === ids.featurePrReview);
    assert.ok(gate, `the run created no bead with id ${ids.featurePrReview}`);
    assert.deepEqual(
      [...gate.labels].sort(),
      ["execution:hitl", "lifecycle:feature-pr"],
    );
  });

  it("still lets stage chores inherit execution:afk from the parent", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["execution:afk"]);

    const codeChore = beads.find((candidate) => candidate.id === ids.code);
    assert.ok(codeChore, `the run created no bead with id ${ids.code}`);
    assert.deepEqual(
      [...codeChore.labels].sort(),
      ["execution:afk", "stage:code"],
    );
  });

  it("carries the housekeeping label alongside its stage label", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["execution:afk"]);

    const housekeeping = beads.find((candidate) => candidate.id === ids.housekeeping);
    assert.ok(housekeeping, `the run created no bead with id ${ids.housekeeping}`);
    assert.deepEqual(
      [...housekeeping.labels].sort(),
      ["execution:afk", "lifecycle:housekeeping", "stage:housekeeping"],
    );
  });

  it("blocks the housekeeping chore behind the PR gate bead, not behind a stage", async () => {
    const { ids, deps } = await createChoresAgainstFakeBd(["execution:afk"]);

    const housekeepingDeps = deps
      .filter((dep) => dep.issue_id === ids.housekeeping)
      .map((dep) => [dep.depends_on_id, dep.type]);
    assert.deepEqual(housekeepingDeps, [[ids.featurePrReview, "blocks"]]);
  });

  it("validates the PR gate task but not the stage chores", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["execution:afk"]);

    const gate = beads.find((candidate) => candidate.id === ids.featurePrReview);
    assert.ok(gate, `the run created no bead with id ${ids.featurePrReview}`);
    assert.equal(gate.type, "task");
    assert.equal(gate.validated, true);
    assert.match(gate.description, /## Acceptance Criteria/);

    const codeChore = beads.find((candidate) => candidate.id === ids.code);
    assert.ok(codeChore, `the run created no bead with id ${ids.code}`);
    assert.equal(codeChore.validated, false);
  });
});

describe("create-chores on an already expanded parent", () => {
  it("creates no bead, wires no dep, and reports the same mapping as the first run", async () => {
    await withFakeBd([parentBead()], async ({ run, readState }) => {
      const first = await run();
      assert.equal(first.exitCode, 0, first.stderr);
      const firstMapping = JSON.parse(first.stdout);
      const expanded = await readState();

      const second = await run();
      assert.equal(second.exitCode, 0, second.stderr);

      assert.deepEqual(JSON.parse(second.stdout), firstMapping);

      const rerun = await readState();
      assert.equal(rerun.beads.length, expanded.beads.length);
      assert.deepEqual(rerun.depAdds, expanded.depAdds);
    });
  });

  it("leaves exactly one chore per stage and exactly one PR gate", async () => {
    await withFakeBd([parentBead()], async ({ run, readState }) => {
      assert.equal((await run()).exitCode, 0);
      assert.equal((await run()).exitCode, 0);

      assert.deepEqual(countRoles((await readState()).beads), {
        "stage:code": 1,
        "stage:verify": 1,
        "stage:review": 1,
        "stage:document": 1,
        "stage:housekeeping": 1,
        "lifecycle:feature-pr": 1,
      });
    });
  });

  it("adds the housekeeping chore to a chain expanded before the stage existed", async () => {
    const seeded = [
      parentBead(),
      stageChore("bd-1", "code"),
      stageChore("bd-2", "verify", ["bd-1"]),
      stageChore("bd-3", "review", ["bd-2"]),
      stageChore("bd-4", "document", ["bd-3"]),
      {
        id: "bd-5",
        title: "[parent-1] PR Review and Merge",
        labels: ["execution:hitl", "lifecycle:feature-pr"],
        parent: "parent-1",
        dependsOn: ["bd-4"],
      },
    ];

    await withFakeBd(seeded, async ({ run, readState }) => {
      const { exitCode, stdout, stderr } = await run();
      assert.equal(exitCode, 0, stderr);

      const mapping = JSON.parse(stdout);
      assert.equal(mapping.featurePrReview, "bd-5");

      const created = (await readState()).beads.slice(seeded.length);
      assert.deepEqual(
        created.map((bead) => [...bead.labels].sort()),
        [["execution:afk", "lifecycle:housekeeping", "stage:housekeeping"]],
      );

      const state = await readState();
      assert.deepEqual(
        state.deps
          .filter((dep) => dep.issue_id === created[0].id)
          .map((dep) => dep.depends_on_id),
        ["bd-5"],
      );
    });
  });

  it("does not adopt a stage chore that belongs to another parent", async () => {
    const foreignChore = {
      id: "bd-1",
      title: "[other-1] Code",
      labels: ["execution:afk", "stage:code"],
      parent: "other-1",
    };

    await withFakeBd([parentBead(), foreignChore], async ({ run }) => {
      const { exitCode, stdout, stderr } = await run();
      assert.equal(exitCode, 0, stderr);

      assert.notEqual(JSON.parse(stdout).code, "bd-1");
    });
  });
});

describe("create-chores after a mid-chain failure", () => {
  /** The tree a failure after `verify` leaves behind: code and verify exist, the
   * rest of the chain and the PR gate do not.
   * @returns {SeedBead[]} */
  function failedChain() {
    return [
      parentBead(),
      stageChore("bd-1", "code"),
      stageChore("bd-2", "verify", ["bd-1"]),
    ];
  }

  it("creates only the beads the failed run left out", async () => {
    const seeded = failedChain();

    await withFakeBd(seeded, async ({ run, readState }) => {
      const { exitCode, stderr } = await run();
      assert.equal(exitCode, 0, stderr);

      const created = (await readState()).beads.slice(seeded.length);
      assert.deepEqual(
        created.map((bead) => [...bead.labels].sort()),
        [
          ["execution:afk", "stage:review"],
          ["execution:afk", "stage:document"],
          ["execution:afk", "lifecycle:housekeeping", "stage:housekeeping"],
          ["execution:hitl", "lifecycle:feature-pr"],
        ],
      );
    });
  });

  it("wires only the dependencies the failed run left out", async () => {
    await withFakeBd(failedChain(), async ({ run, readState }) => {
      const { exitCode, stdout, stderr } = await run();
      assert.equal(exitCode, 0, stderr);

      const mapping = JSON.parse(stdout);
      assert.equal(mapping.code, "bd-1");
      assert.equal(mapping.verify, "bd-2");

      assert.deepEqual((await readState()).depAdds, [
        { issue_id: mapping.review, depends_on_id: "bd-2" },
        { issue_id: mapping.document, depends_on_id: mapping.review },
        { issue_id: mapping.featurePrReview, depends_on_id: mapping.document },
        { issue_id: mapping.housekeeping, depends_on_id: mapping.featurePrReview },
      ]);
    });
  });
});
