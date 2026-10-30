// Behaviour tests for `agent-cortex migrate` — v1 (implementation-type:* →
// execution:*) and v2 (docs/ideas/*.md → kind:idea beads) — driven through the
// process boundary against a stateful fake `bd`
// (test/helpers/fake-bd-migrate.mjs) so the real beads database is never
// touched. The workspace is a throwaway directory that is also the child
// process's working directory, so the idea files v2 reads are fixtures, never
// this repo's own (now retired) idea directory. Assertions are on the workspace's resulting
// bead state and recorded writes — the observable effect of the command.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { makeFakeBdMigrate } from "./helpers/fake-bd-migrate.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(TEST_DIR, "..", "bin", "agent-cortex.mjs");
const MIGRATE_PATH = join(TEST_DIR, "..", "scripts", "lib", "migrate.mjs");

/** An idea file in the shape the retired scaffold wrote: the full section set. */
const IDEA_FILE = `# Idea: model selector

## Status
Backlog idea (not implementation-ready) — priority P2 (moderate)

## Created
2026-07-12

## Problem
Selecting the right model for a task is manual and brittle.

## Who benefits
Anyone running more than one model.

## Proposed outcome
A declarative "use case → model chain" mapping.

## How we might do it
Profiles name a primary model plus ordered fallbacks.

## Validity check
- Evidence: the model registry already resolves provider/id strings.

## Constraints
- Must not add LLM calls internally.

## Next validation step
Sketch the config schema and try it against real usage.

## Notes
Recorded during a planning session.
`;

/** The same shape with no priority stated and a legacy problem heading. */
const LEGACY_IDEA_FILE = `# Idea: qa extension

## Status
Captured, not yet validated.

## Why it might be useful
A QA pass could run before each merge.

## Open questions
- Who owns the fixture data?
`;

/** Two files that state the same title — the shape `.local.md` variants take. */
const TWIN_IDEA_FILE = `# Idea: task-session-context

## Problem
The resume path drops the bead's own progress trail.
`;

const TWIN_LOCAL_IDEA_FILE = `# Idea: task-session-context

## Problem
The local-only variant of the same note, with content of its own.
`;

/** @typedef {{ bin: string, state: string, cwd: string }} Workspace */

/**
 * Run `agent-cortex migrate` against a fake beads workspace, from inside it.
 *
 * @param {string[]} args
 * @param {Workspace} workspace
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
function runMigrate(args, { bin, state, cwd }) {
  return runNode([CLI_PATH, "migrate", ...args], { bin, state, cwd });
}

/**
 * Run a custom driver script with the fake `bd` in place — how the module-level
 * idea-directory override is exercised without a CLI flag.
 *
 * @param {Workspace} workspace
 * @param {string} ideaDir
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
async function runMigrateWithDir({ bin, state, cwd }, ideaDir) {
  const script = join(cwd, "run-migrate.mjs");
  await writeFile(
    script,
    `import { runMigrate } from ${JSON.stringify(pathToFileURL(MIGRATE_PATH).href)};\n` +
      `await runMigrate({ apply: false, dir: ${JSON.stringify(ideaDir)} });\n`,
  );
  return runNode([script], { bin, state, cwd });
}

/**
 * @param {string[]} args
 * @param {{ bin: string, state: string, cwd: string }} workspace
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
function runNode(args, { bin, state, cwd }) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      { cwd, env: { ...process.env, BD_PATH: bin, FAKE_BD_STATE: state } },
      (error, stdout, stderr) => resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }),
    );
  });
}

/** @param {string} statePath @returns {Promise<FakeState>} */
async function readState(statePath) {
  return JSON.parse(await readFile(statePath, "utf8"));
}

/** Labels of every bead in the fake workspace, keyed by bead id.
 * @param {string} statePath
 * @returns {Promise<Record<string, string[]>>} */
async function readLabels(statePath) {
  const state = await readState(statePath);
  return Object.fromEntries(state.beads.map((bead) => [bead.id, bead.labels]));
}

/** @typedef {{ id: string, labels: string[], title: string, status: string, priority: number,
 *   description: string, design: string, notes: string, acceptance_criteria: string }} FakeBead */
/** @typedef {{ beads: FakeBead[], writes: Array<Record<string, unknown>> }} FakeState */

/**
 * The beads created by a run — the ones the seed did not carry.
 *
 * @param {FakeState} state
 * @param {number} seeded
 * @returns {FakeBead[]}
 */
function createdBeads(state, seeded) {
  return state.beads.slice(seeded);
}

/**
 * Create a throwaway fake beads workspace, run `fn`, then remove it.
 *
 * @param {Array<{ id: string, labels: string[], status?: string, title?: string, notes?: string }>} beads
 * @param {(workspace: Workspace) => Promise<void>} fn
 * @param {{
 *   failOn?: string | null,
 *   listHidesClosed?: boolean,
 *   ignoreLabelRemovals?: boolean,
 *   exportDropsLabel?: string | null,
 *   ideaFiles?: Record<string, string>,
 *   ideaDir?: string,
 * }} [options]  `ideaFiles` maps a path below `ideaDir` to its markdown content.
 */
async function withWorkspace(beads, fn, options = {}) {
  const { ideaFiles = {}, ideaDir = "docs/ideas", ...fakeOptions } = options;
  const dir = await mkdtemp(join(tmpdir(), "agent-cortex-migrate-"));
  try {
    for (const [name, content] of Object.entries(ideaFiles)) {
      const path = join(dir, ideaDir, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    const workspace = await makeFakeBdMigrate(dir, { beads, ...fakeOptions });
    await fn({ ...workspace, cwd: dir });
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

  it("migrates both allowlisted values and leaves other labels alone", async () => {
    await withWorkspace(
      [
        { id: "bd-afk", labels: ["implementation-type:afk"] },
        { id: "bd-hitl", labels: ["implementation-type:hitl", "epic:epic-1"] },
        { id: "bd-control", labels: ["epic:epic-1"] },
      ],
      async (workspace) => {
        const { exitCode } = await runMigrate(["--apply"], workspace);

        assert.equal(exitCode, 0);
        assert.deepEqual(await readLabels(workspace.state), {
          "bd-afk": ["execution:afk"],
          "bd-hitl": ["epic:epic-1", "execution:hitl"],
          "bd-control": ["epic:epic-1"],
        });
      },
    );
  });

  it("refuses an unmapped label value on both the dry run and --apply, writing nothing", async () => {
    await withWorkspace(
      [
        { id: "bd-afk", labels: ["implementation-type:afk"] },
        { id: "bd-wip", labels: ["implementation-type:wip"] },
        { id: "bd-wip-closed", labels: ["implementation-type:wip"], status: "closed" },
      ],
      async (workspace) => {
        // Both invocations must stop before planning, so the allowlisted bead
        // is not migrated either — a half-migrated workspace is the failure
        // mode the allowlist exists to prevent.
        for (const args of [[], ["--apply"]]) {
          const { exitCode, stdout, stderr } = await runMigrate(args, workspace);

          assert.equal(exitCode, 1);
          assert.equal(stdout, "");
          assert.match(stderr, /bd-wip/);
          assert.match(stderr, /bd-wip-closed/);
          assert.match(stderr, /implementation-type:wip/);
          assert.deepEqual(await readLabels(workspace.state), {
            "bd-afk": ["implementation-type:afk"],
            "bd-wip": ["implementation-type:wip"],
            "bd-wip-closed": ["implementation-type:wip"],
          });
          assert.equal((await readState(workspace.state)).writes.length, 0);
        }
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
        assert.doesNotMatch(stdout, /already at v2/);
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
    await withWorkspace([{ id: "bd-a", labels: ["implementation-type:afk"] }], async ({ state, cwd }) => {
      const { exitCode, stderr } = await runMigrate([], { bin: join(dirname(state), "missing-bd"), state, cwd });

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

describe("agent-cortex migrate v2 ideas to beads", () => {
  it("plans one line per idea file and writes nothing on the dry run", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        const { exitCode, stdout } = await runMigrate([], workspace);

        assert.equal(exitCode, 0);
        assert.match(stdout, /docs\/ideas\/model-selector\.md → Idea: model selector \(P2\)/);
        assert.match(stdout, /docs\/ideas\/qa-extension\.md → Idea: qa extension \(P4\)/);
        assert.match(stdout, /2 bead\(s\) pending/);
        const state = await readState(workspace.state);
        assert.equal(state.writes.length, 0);
        assert.deepEqual(state.beads, []);
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE, "qa-extension.md": LEGACY_IDEA_FILE } },
    );
  });

  it("creates a hitl idea bead per file with the sections in their mapped fields", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        assert.equal((await runMigrate(["--apply"], workspace)).exitCode, 0);

        const [bead] = createdBeads(await readState(workspace.state), 0);
        assert.deepEqual([...bead.labels].sort(), ["execution:hitl", "kind:idea"]);
        assert.equal(bead.title, "Idea: model selector");
        assert.equal(bead.priority, 2);
        assert.match(bead.description, /## Problem/);
        assert.match(bead.description, /## Who benefits/);
        assert.match(bead.description, /## Proposed outcome/);
        assert.match(bead.design, /## How we might do it/);
        assert.match(bead.notes, /## Validity check/);
        assert.match(bead.notes, /## Constraints/);
        assert.match(bead.notes, /## Next validation step/);
        assert.equal(bead.status, "open");
        // A `task` bead needs acceptance criteria to lint clean.
        assert.notEqual(bead.acceptance_criteria, undefined);
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE } },
    );
  });

  it("loses no line of the source file", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        assert.equal((await runMigrate(["--apply"], workspace)).exitCode, 0);

        const [bead] = createdBeads(await readState(workspace.state), 0);
        const migrated = [bead.description, bead.design, bead.notes].join("\n");
        const bodyLines = IDEA_FILE.split("\n")
          .slice(1) // the `#` heading becomes the bead title
          .filter((line) => line.trim() !== "");

        for (const line of bodyLines) assert.ok(migrated.includes(line), `dropped: ${line}`);
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE } },
    );
  });

  it("keeps a legacy heading inside the field it maps to", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        assert.equal((await runMigrate(["--apply"], workspace)).exitCode, 0);

        const [bead] = createdBeads(await readState(workspace.state), 0);
        // `## Why it might be useful` is the pre-template name for the problem.
        assert.match(bead.description, /## Why it might be useful/);
        assert.match(bead.notes, /## Open questions/);
      },
      { ideaFiles: { "qa-extension.md": LEGACY_IDEA_FILE } },
    );
  });

  it("falls back to backlog priority when the file states none", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        assert.equal((await runMigrate(["--apply"], workspace)).exitCode, 0);

        const [bead] = createdBeads(await readState(workspace.state), 0);
        assert.equal(bead.priority, 4);
      },
      { ideaFiles: { "qa-extension.md": LEGACY_IDEA_FILE } },
    );
  });

  it("migrates a nested idea directory", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        assert.equal((await runMigrate(["--apply"], workspace)).exitCode, 0);

        const [bead] = createdBeads(await readState(workspace.state), 0);
        assert.equal(bead.title, "Idea: model selector");
      },
      { ideaFiles: { "model-selector/model-selector.md": IDEA_FILE } },
    );
  });

  it("is a no-op on a second run", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        assert.equal((await runMigrate(["--apply"], workspace)).exitCode, 0);
        const afterFirst = await readState(workspace.state);

        const second = await runMigrate(["--apply"], workspace);

        assert.equal(second.exitCode, 0);
        assert.match(second.stdout, /already at v2/);
        const afterSecond = await readState(workspace.state);
        assert.equal(afterSecond.beads.length, afterFirst.beads.length);
        assert.equal(afterSecond.writes.length, afterFirst.writes.length);
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE } },
    );
  });

  it("skips a file whose record already exists under the same title", async () => {
    await withWorkspace(
      [{ id: "pre-migrated", labels: ["kind:idea", "execution:hitl"], title: "Design: model selector" }],
      async (workspace) => {
        const { stdout } = await runMigrate(["--apply"], workspace);

        // The pre-existing record is a `Design: ` title for the same idea, so the
        // comparison ignores the prefix and the punctuation of the file name.
        assert.doesNotMatch(stdout, /model-selector\.md/);
        const state = await readState(workspace.state);
        const created = createdBeads(state, 1);
        assert.equal(created.length, 1);
        assert.equal(created[0].title, "Idea: qa extension");
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE, "qa-extension.md": LEGACY_IDEA_FILE } },
    );
  });

  it("skips a file a bead already records under a provenance heading", async () => {
    await withWorkspace(
      [
        {
          id: "pre-migrated",
          labels: ["kind:idea", "execution:hitl"],
          title: "Design: a different title entirely",
          notes: "## Provenance\n- `docs/ideas/model-selector.md` (2026-07-12) — source.\n",
        },
      ],
      async (workspace) => {
        const state = await runMigrate(["--apply"], workspace);
        assert.equal(state.exitCode, 0);

        const created = createdBeads(await readState(workspace.state), 1);
        assert.deepEqual(
          created.map((bead) => bead.title),
          ["Idea: qa extension"],
        );
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE, "qa-extension.md": LEGACY_IDEA_FILE } },
    );
  });

  it("does not treat a passing cross-reference as a record of the file", async () => {
    await withWorkspace(
      [
        {
          id: "neighbour",
          labels: ["kind:idea", "execution:hitl"],
          title: "Design: a different title entirely",
          notes: "## Status\nSee `docs/ideas/model-selector.md` for the related idea.\n",
        },
      ],
      async (workspace) => {
        assert.equal((await runMigrate(["--apply"], workspace)).exitCode, 0);

        const created = createdBeads(await readState(workspace.state), 1);
        assert.deepEqual(
          created.map((bead) => bead.title),
          ["Idea: model selector", "Idea: qa extension"],
        );
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE, "qa-extension.md": LEGACY_IDEA_FILE } },
    );
  });

  it("reports nothing to do when the workspace has no idea directory", async () => {
    await withWorkspace([], async (workspace) => {
      const { exitCode, stdout } = await runMigrate([], workspace);

      assert.equal(exitCode, 0);
      assert.match(stdout, /already at v2/);
      assert.equal((await readState(workspace.state)).writes.length, 0);
    });
  });

  it("cites the source file under a provenance heading", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        assert.equal((await runMigrate(["--apply"], workspace)).exitCode, 0);

        const [bead] = createdBeads(await readState(workspace.state), 0);
        assert.match(bead.notes, /## Provenance/);
        assert.match(bead.notes, /docs\/ideas\/model-selector\.md/);
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE } },
    );
  });

  it("resumes a twin-title apply that died between the two creates", async () => {
    await withWorkspace(
      [
        {
          id: "already-created",
          labels: ["kind:idea", "execution:hitl"],
          title: "Idea: task-session-context",
          notes: "## Provenance\nMigrated from `docs/ideas/task-session-context.local.md` by `agent-cortex migrate`.",
        },
      ],
      async (workspace) => {
        const { exitCode, stdout } = await runMigrate(["--apply"], workspace);

        // Both files state the same title, so a title-keyed skip would call this
        // workspace done and never record `task-session-context.md`.
        assert.equal(exitCode, 0);
        const created = createdBeads(await readState(workspace.state), 1);
        assert.equal(created.length, 1);
        assert.equal(created[0].title, "Idea: task-session-context");
        assert.match(created[0].description, /drops the bead's own progress trail/);
        assert.match(created[0].notes, /docs\/ideas\/task-session-context\.md/);
        assert.match(stdout, /v2 ideas-to-beads verified/);
      },
      {
        ideaFiles: {
          "task-session-context.md": TWIN_IDEA_FILE,
          "task-session-context.local.md": TWIN_LOCAL_IDEA_FILE,
        },
      },
    );
  });

  it("still skips a source-less record by its title after a twin is recorded", async () => {
    await withWorkspace(
      [
        {
          id: "hand-migrated",
          labels: ["kind:idea", "execution:hitl"],
          title: "Design: task-session-context",
          notes: "A summary a human wrote before the step existed.",
        },
      ],
      async (workspace) => {
        const { stdout } = await runMigrate(["--apply"], workspace);

        assert.doesNotMatch(stdout, /task-session-context/);
        assert.equal(createdBeads(await readState(workspace.state), 1).length, 0);
      },
      {
        ideaFiles: {
          "task-session-context.md": TWIN_IDEA_FILE,
          "task-session-context.local.md": TWIN_LOCAL_IDEA_FILE,
        },
      },
    );
  });

  it("reads ideas from an overridden directory", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        const { exitCode, stdout } = await runMigrateWithDir(workspace, "docs/notes");

        assert.equal(exitCode, 0);
        assert.match(stdout, /docs\/notes\/model-selector\.md → Idea: model selector/);
        assert.equal((await readState(workspace.state)).writes.length, 0);
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE }, ideaDir: "docs/notes" },
    );
  });

  it("reads ideas from an overridden directory through the --dir flag", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        const { exitCode, stdout } = await runMigrate(["--dir", "docs/notes"], workspace);

        assert.equal(exitCode, 0);
        assert.match(stdout, /docs\/notes\/model-selector\.md → Idea: model selector/);
        assert.equal((await readState(workspace.state)).writes.length, 0);
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE }, ideaDir: "docs/notes" },
    );
  });

  it("fails loudly when creating a bead errors", async () => {
    await withWorkspace(
      [],
      async (workspace) => {
        const { exitCode, stderr } = await runMigrate(["--apply"], workspace);

        assert.equal(exitCode, 1);
        assert.match(stderr, /simulated bd error/);
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE }, failOn: "create" },
    );
  });

  it("runs after the label rename in the same apply", async () => {
    await withWorkspace(
      [{ id: "bd-legacy", labels: ["implementation-type:afk"] }],
      async (workspace) => {
        const { exitCode, stdout } = await runMigrate(["--apply"], workspace);

        assert.equal(exitCode, 0);
        assert.match(stdout, /v1 label-rename/);
        assert.match(stdout, /v2 ideas-to-beads/);
        const state = await readState(workspace.state);
        assert.deepEqual(state.beads[0].labels, ["execution:afk"]);
        assert.equal(state.beads.length, 2);
      },
      { ideaFiles: { "model-selector.md": IDEA_FILE } },
    );
  });
});
