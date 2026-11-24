import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeFakeBd } from "./helpers/fake-bd.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";
import { copyPipelineFormula } from "../scripts/lib/pipeline-formula.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(testDir, "..");
const CREATE_CHORES = join(testDir, "..", "skills", "planning", "create-task", "scripts", "create-chores.mjs");

// One temp root per file, removed by the file-level `after()` hook it registers.
const tempRoot = createTempRoot("create-chores-");

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
 * @property {number} [priority]
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
 * @property {string[]} calls     Every invocation's argv, in order
 * @property {string[]} updates   Every `bd update` invocation, in order
 * @property {string[]} deleted   Every deleted bead id, in order
 * @property {{id: string, text: string}[]} notes  Every `bd note` call, in order
 * @property {{formula: string, vars: Record<string, string>, rootId: string}[]} pours
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
 * @property {string} dir  The workspace the script runs in, and where a formula is looked for
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

/** Run one script invocation with the given env overrides, in `cwd`.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 * @returns {Promise<RunResult>} */
function runScript(args, env, cwd) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CREATE_CHORES, ...args],
      { env: { ...process.env, ...env }, cwd },
      (error, stdout, stderr) => {
        resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
      },
    );
  });
}

/** Run `body` against a fresh fake `bd` seeded with `beads`.
 *
 * The script runs inside that workspace, so `.beads/` discovery — and therefore
 * whether the shipped formula is found — is decided by the test, never by the
 * checkout the suite happens to run in. With `formula`, the real formula is
 * installed the way `agent-cortex install` installs it, which also proves the
 * installer's copy and the script's lookup agree on id and filename.
 * @param {SeedBead[]} beads
 * @param {(tools: FakeBdTools) => Promise<void>} body
 * @param {{ formula?: boolean }} [options]
 * @returns {Promise<void>} */
async function withFakeBd(beads, body, { formula = false } = {}) {
  const dir = await tempRoot.createWorkspace();
  const { bin, state } = await makeFakeBd(dir, { beads });
  if (formula) {
    // A bd-initialised project: the installer writes into an existing `.beads/`, and
    // creates its `formulas/` child.
    await mkdir(join(dir, ".beads"), { recursive: true });
    const copy = await copyPipelineFormula({ root: REPO_ROOT, projectDir: dir });
    assert.equal(copy.action, "written", copy.message);
  }

  await body({
    dir,
    run: (args = ["--parent", "parent-1"]) =>
      runScript(args, { BD_PATH: bin, FAKE_BD_STATE: state }, dir),
    readState: async () => JSON.parse(await readFile(state, "utf8")),
  });
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

  it("stores the post-merge description without running the command it names", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["execution:afk"]);

    const postMerge = beads.find((candidate) => candidate.id === ids["post-merge"]);
    assert.ok(postMerge, `the run created no bead with id ${ids["post-merge"]}`);
    assert.match(postMerge.description, /post-merge-check\.mjs/);
    // A shell parsing the description substitutes the backticks: the script name
    // vanishes, `gh run list` runs for real, and its output lands in the description.
    assert.doesNotMatch(postMerge.description, /cannot open ralph-scripts/);
    assert.doesNotMatch(postMerge.description, /\t/);
  });

  it("stores the housekeeping description without running the command it names", async () => {
    const { ids, beads } = await createChoresAgainstFakeBd(["execution:afk"]);

    const housekeeping = beads.find((candidate) => candidate.id === ids.housekeeping);
    assert.ok(housekeeping, `the run created no bead with id ${ids.housekeeping}`);
    assert.match(housekeeping.description, /prune-worktrees\.mjs/);
    assert.doesNotMatch(housekeeping.description, /cannot open ralph-scripts/);
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
        "stage:post-merge": 1,
        "stage:housekeeping": 1,
        "lifecycle:feature-pr": 1,
      });
    });
  });

  it("adds the post-merge and housekeeping chores to a chain expanded before either stage existed", async () => {
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
        [
          ["execution:afk", "lifecycle:post-merge", "stage:post-merge"],
          ["execution:afk", "lifecycle:housekeeping", "stage:housekeeping"],
        ],
      );

      const state = await readState();
      for (const bead of created) {
        assert.deepEqual(
          state.deps
            .filter((dep) => dep.issue_id === bead.id)
            .map((dep) => dep.depends_on_id),
          ["bd-5"],
          `${bead.id} does not wait on the PR gate`,
        );
      }
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
          ["execution:afk", "lifecycle:post-merge", "stage:post-merge"],
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
        { issue_id: mapping["post-merge"], depends_on_id: mapping.featurePrReview },
        { issue_id: mapping.housekeeping, depends_on_id: mapping.featurePrReview },
      ]);
    });
  });
});

// ─── The shipped formula ─────────────────────────────────────────────────────

/** The role label a bead carries — `stage:<id>` or `lifecycle:feature-pr`.
 * @param {FakeBead} bead @returns {string | undefined} */
function roleOf(bead) {
  return bead.labels.find((label) => label.startsWith("stage:") || label === "lifecycle:feature-pr");
}

/** Every `blocks` dependency of a bead, described by the role the target plays —
 * so the same tree compares equal whichever path produced it.
 * @param {FakeState} state @param {FakeBead} bead @returns {string[]} */
function blockedRoles(state, bead) {
  return state.deps
    .filter((dep) => dep.issue_id === bead.id && dep.type === "blocks")
    .map((dep) => roleOf(state.beads.find((candidate) => candidate.id === dep.depends_on_id) ?? { id: dep.depends_on_id, title: "", labels: [], parent: null, type: "", description: "", validated: false }) ?? dep.depends_on_id)
    .sort();
}

/** Expand one fresh parent and describe every chore the expansion produced: title,
 * description, labels and blocking edges, keyed by role.
 * @param {{ formula?: boolean }} options
 * @returns {Promise<Record<string, { title: string, description: string, labels: string[], blocks: string[] }>>} */
async function expansionSnapshot(options) {
  /** @type {Record<string, { title: string, description: string, labels: string[], blocks: string[] }>} */
  let snapshot = {};

  await withFakeBd([parentBead()], async ({ run, readState }) => {
    const { exitCode, stderr } = await run();
    assert.equal(exitCode, 0, stderr);
    const state = await readState();

    for (const bead of state.beads.filter((candidate) => candidate.parent === "parent-1")) {
      const role = roleOf(bead);
      assert.ok(role, `child ${bead.id} carries no role label`);
      snapshot[role] = {
        title: bead.title,
        description: bead.description,
        labels: [...bead.labels].sort(),
        blocks: blockedRoles(state, bead),
      };
    }
  }, options);

  return snapshot;
}

describe("create-chores through the shipped formula", () => {
  it("pours once, reparents every step onto the parent, and deletes the molecule root", async () => {
    await withFakeBd([parentBead()], async ({ run, readState }) => {
      const { exitCode, stdout, stderr } = await run();
      assert.equal(exitCode, 0, stderr);
      const mapping = JSON.parse(stdout);
      const state = await readState();

      assert.equal(state.pours.length, 1, "one pour per expansion");
      assert.equal(state.pours[0].formula, "pipeline");

      assert.deepEqual(state.deleted, [state.pours[0].rootId], "the molecule root is deleted");
      assert.ok(
        !state.beads.some((bead) => bead.type === "molecule"),
        "no molecule root is left addressable",
      );

      // One reparent per stage, and the PR gate stays where it always was.
      const reparents = state.updates.filter((update) => update.includes("--parent parent-1"));
      assert.equal(reparents.length, Object.keys(mapping).length - 1);
      for (const id of Object.values(mapping)) {
        const bead = state.beads.find((candidate) => candidate.id === id);
        assert.ok(bead, `${id} is not in the tree`);
        assert.equal(bead.parent, "parent-1", `${id} was not reparented onto the feature bead`);
      }

      // The budget the script's header states: no per-stage create survives.
      assert.deepEqual(
        state.calls.filter((call) => call.startsWith("create ")).length,
        1,
        "the PR gate is the only bd create",
      );
      assert.equal(state.calls.filter((call) => call.startsWith("dep add")).length, 3);
    }, { formula: true });
  });

  it("records the poured formula on the feature bead", async () => {
    await withFakeBd([parentBead()], async ({ run, readState }) => {
      assert.equal((await run()).exitCode, 0);
      const state = await readState();

      assert.equal(state.notes.length, 1, "exactly one note, on a first pour");
      assert.equal(state.notes[0].id, "parent-1");
      assert.match(state.notes[0].text, /poured formula 'pipeline'/);
      assert.match(state.notes[0].text, /code=bd-/);
      assert.match(state.notes[0].text, /molecule root bd-.* deleted/);
    }, { formula: true });
  });

  it("gives every step the parent's labels and the requested priority", async () => {
    await withFakeBd([parentBead()], async ({ run, readState }) => {
      const { exitCode, stdout, stderr } = await run(["--parent", "parent-1", "--priority", "0"]);
      assert.equal(exitCode, 0, stderr);
      const mapping = JSON.parse(stdout);
      const state = await readState();

      const codeChore = state.beads.find((bead) => bead.id === mapping.code);
      assert.ok(codeChore, "the poured code chore is in the tree");
      assert.deepEqual([...codeChore.labels].sort(), ["execution:afk", "stage:code"]);
      assert.equal(codeChore.priority, 0);

      const housekeeping = state.beads.find((bead) => bead.id === mapping.housekeeping);
      assert.ok(housekeeping, "the poured housekeeping chore is in the tree");
      assert.deepEqual(
        [...housekeeping.labels].sort(),
        ["execution:afk", "lifecycle:housekeeping", "stage:housekeeping"],
      );
    }, { formula: true });
  });

  it("says which path ran, once, on stderr", async () => {
    await withFakeBd([parentBead()], async ({ run }) => {
      const { stderr } = await run();
      const lines = stderr.split("\n").filter((line) => line.startsWith("create-chores:"));
      assert.equal(lines.length, 1, stderr);
      assert.match(lines[0], /poured formula 'pipeline'/);
    }, { formula: true });
  });

  it("creates the same tree as the per-stage path", async () => {
    const poured = await expansionSnapshot({ formula: true });
    const looped = await expansionSnapshot({ formula: false });

    assert.deepEqual(poured, looped);
    // The post-merge description holds a real command in backticks; a pour that
    // ran it would have substituted its output for the text.
    assert.match(poured["stage:post-merge"].description, /`node <ralph-scripts>\/post-merge-check\.mjs`/);
  });

  it("expanding twice ends with exactly one chore per stage and one PR gate", async () => {
    await withFakeBd([parentBead()], async ({ run, readState }) => {
      const first = await run();
      assert.equal(first.exitCode, 0, first.stderr);
      const afterFirst = await readState();

      const second = await run();
      assert.equal(second.exitCode, 0, second.stderr);
      const afterSecond = await readState();

      assert.deepEqual(countRoles(afterSecond.beads), {
        "stage:code": 1,
        "stage:verify": 1,
        "stage:review": 1,
        "stage:document": 1,
        "stage:post-merge": 1,
        "stage:housekeeping": 1,
        "lifecycle:feature-pr": 1,
      });

      assert.equal(afterSecond.pours.length, 1, "the second run does not pour again");
      assert.equal(afterSecond.notes.length, 1, "the pour record is not appended twice");
      assert.deepEqual(JSON.parse(second.stdout), JSON.parse(first.stdout));
      assert.equal(afterSecond.beads.length, afterFirst.beads.length, "no bead is duplicated");
      assert.deepEqual(afterSecond.depAdds, afterFirst.depAdds, "no dependency is rewired");

      const lines = second.stderr.split("\n").filter((line) => line.startsWith("create-chores:"));
      assert.equal(lines.length, 1, second.stderr);
      assert.match(lines[0], /per-stage path — the parent already has stage chores/);
    }, { formula: true });
  });

  it("falls back to the per-stage path when the formula is absent, and says so once", async () => {
    await withFakeBd([parentBead()], async ({ run, readState }) => {
      const { exitCode, stderr } = await run();
      assert.equal(exitCode, 0, stderr);

      const state = await readState();
      assert.equal(state.pours.length, 0, "nothing was poured");
      assert.deepEqual(countRoles(state.beads), {
        "stage:code": 1,
        "stage:verify": 1,
        "stage:review": 1,
        "stage:document": 1,
        "stage:post-merge": 1,
        "stage:housekeeping": 1,
        "lifecycle:feature-pr": 1,
      });

      const lines = stderr.split("\n").filter((line) => line.startsWith("create-chores:"));
      assert.equal(lines.length, 1, stderr);
      assert.match(lines[0], /per-stage path — no pipeline\.formula\.json in a \.beads\/formulas\/ directory/);
    }, { formula: false });
  });

  it("falls back to the per-stage path when the pour fails, and reports it", async () => {
    await withFakeBd([parentBead()], async ({ dir, run, readState }) => {
      // A formula file bd cannot cook: present, so the script tries the pour, and
      // then the pour fails the way a schema drift would.
      const { writeFile, unlink } = await import("node:fs/promises");
      const formulaPath = join(dir, ".beads", "formulas", "pipeline.formula.json");
      await writeFile(formulaPath, "{ not json");
      try {
        const { exitCode, stderr } = await run();
        assert.equal(exitCode, 0, stderr);

        const state = await readState();
        assert.equal(state.pours.length, 0);
        assert.equal(state.beads.filter((bead) => bead.parent === "parent-1").length, 7);
        assert.match(stderr, /pour of 'pipeline' failed .*reverted it and used the per-stage path/);
      } finally {
        await unlink(formulaPath);
      }
    }, { formula: true });
  });
});
