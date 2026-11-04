// Shared test helper: a stateful fake `bd` binary for create-chores.mjs.
// `bd` is a genuine external system (its real database must never be touched
// by tests), so the script is driven against this fake via the BD_PATH
// override. The fake reproduces the real behaviours the tests depend on —
// `bd create --parent` label inheritance (unless `--no-inherit-labels` is
// passed), `bd create --validate` section enforcement, `bd children --json`
// listing, and `bd dep add` state — and records every created bead, dependency
// and dep-add call to a JSON state file the test can read back.
//
// State lives in `state.json` next to the binary; the test seeds it with the
// parent bead and reads the children back after the script runs. Written async
// throughout — the repo's check-no-sync lint scans test/ (including helpers).

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FAKE_BD_SCRIPT = [
  "#!/usr/bin/env node",
  "// Stateful fake for `bd` (test/helpers/fake-bd.mjs): create, children, dep add.",
  "const fs = require('node:fs/promises');",
  "",
  "const stateFile = process.env.FAKE_BD_STATE;",
  "const VALUE_FLAGS = new Set(['--type', '--description', '--priority', '--labels', '--parent']);",
  "const BOOL_FLAGS = new Set(['--silent', '--no-inherit-labels', '--validate']);",
  "",
  "(async () => {",
  "  const argv = process.argv.slice(2);",
  "  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));",
  "  state.deps ??= [];",
  "  state.depAdds ??= [];",
  "",
  "  if (argv[0] === 'children') {",
  "    const parentId = argv[1];",
  "    const children = state.beads",
  "      .filter((bead) => bead.parent === parentId)",
  "      .map((bead) => ({ ...bead, dependencies: state.deps.filter((dep) => dep.issue_id === bead.id) }))",
  "      // Real bd prints the most recently created child first.",
  "      .reverse();",
  "    process.stdout.write(JSON.stringify(children, null, 2) + '\\n');",
  "    return;",
  "  }",
  "",
  "  if (argv[0] === 'dep') {",
  "    // dep add <issue-id> <depends-on-id> [--type <type>]",
  "    const issueId = argv[2];",
  "    const dependsOnId = argv[3];",
  "    const typeIndex = argv.indexOf('--type');",
  "    const type = typeIndex === -1 ? 'blocks' : argv[typeIndex + 1];",
  "    state.depAdds.push({ issue_id: issueId, depends_on_id: dependsOnId });",
  "    // Real bd treats a repeated dep as a no-op, so a converged re-run must still succeed.",
  "    const known = state.deps.some((dep) => dep.issue_id === issueId && dep.depends_on_id === dependsOnId);",
  "    if (!known) state.deps.push({ issue_id: issueId, depends_on_id: dependsOnId, type });",
  "    await fs.writeFile(stateFile, JSON.stringify(state));",
  "    return;",
  "  }",
  "",
  "  if (argv[0] !== 'create') process.exit(1);",
  "",
  "  const title = argv[1];",
  "  const flags = {};",
  "  const bools = new Set();",
  "  for (let i = 2; i < argv.length; i++) {",
  "    const arg = argv[i];",
  "    if (BOOL_FLAGS.has(arg)) { bools.add(arg); continue; }",
  "    if (VALUE_FLAGS.has(arg)) { flags[arg] = argv[++i]; continue; }",
  "  }",
  "",
  "  // Model `bd create --validate`: reject a substantive bead whose description lacks the",
  "  // required section(s) for its type. Chores have no requirements and always pass.",
  "  if (bools.has('--validate')) {",
  "    const type = flags['--type'] || 'task';",
  "    const required = {",
  "      task: ['## Acceptance Criteria'],",
  "      feature: ['## Acceptance Criteria'],",
  "      bug: ['## Steps to Reproduce', '## Acceptance Criteria'],",
  "      epic: ['## Success Criteria'],",
  "      chore: [],",
  "    }[type] || ['## Acceptance Criteria'];",
  "    const description = flags['--description'] || '';",
  "    const missing = required.filter((section) => !description.toLowerCase().includes(section.toLowerCase()));",
  "    if (missing.length > 0) {",
  "      console.error('missing required sections for ' + type + ': ' + missing.join(', '));",
  "      process.exit(1);",
  "    }",
  "  }",
  "",
  "  const explicit = (flags['--labels'] || '').split(',').filter(Boolean);",
  "  const parent = state.beads.find((b) => b.id === flags['--parent']);",
  "  const inherited = parent && !bools.has('--no-inherit-labels') ? parent.labels : [];",
  "  const labels = [...new Set([...inherited, ...explicit])];",
  "",
  "  const id = 'bd-' + state.nextId++;",
  "  state.beads.push({ id, title, labels, parent: flags['--parent'] ?? null, type: flags['--type'] || 'task', description: flags['--description'] || '', validated: bools.has('--validate') });",
  "  await fs.writeFile(stateFile, JSON.stringify(state));",
  "  process.stdout.write(id + '\\n');",
  "})().catch((err) => {",
  "  console.error(err);",
  "  process.exit(1);",
  "});",
].join("\n");

/**
 * A bead seeded into the fake's state before the script runs.
 * @typedef {object} SeedBead
 * @property {string} id
 * @property {string} title
 * @property {string[]} labels
 * @property {string | null} [parent]  Parent bead ID; omit for the parent itself
 * @property {string[]} [dependsOn]    Bead IDs this bead blocks on
 */

/** Create a stateful fake `bd` binary in `dir`.
 * @param {string} dir  Directory to hold the binary and its state.json
 * @param {{ beads: SeedBead[] }} seed  Pre-existing beads (the parent, plus any
 *        partial chore tree the test wants the script to repair)
 * @returns {Promise<{ bin: string, state: string }>} */
export async function makeFakeBd(dir, { beads }) {
  const bin = join(dir, "bd");
  const state = join(dir, "state.json");

  const deps = beads.flatMap((bead) =>
    (bead.dependsOn ?? []).map((dependsOnId) => ({
      issue_id: bead.id,
      depends_on_id: dependsOnId,
      type: "blocks",
    })),
  );

  await writeFile(bin, FAKE_BD_SCRIPT + "\n");
  await chmod(bin, 0o755);
  await writeFile(
    state,
    JSON.stringify({ beads: beads.map(({ dependsOn, ...bead }) => bead), deps, nextId: nextIdAfter(beads) }),
  );
  return { bin, state };
}

/** The first free numeric `bd-<n>` suffix above every seeded ID, so a bead the
 * script creates never collides with one the test seeded.
 * @param {SeedBead[]} beads @returns {number} */
function nextIdAfter(beads) {
  return beads.reduce((next, bead) => {
    const match = /^bd-(\d+)$/.exec(bead.id);
    return match ? Math.max(next, Number(match[1]) + 1) : next;
  }, 1);
}
