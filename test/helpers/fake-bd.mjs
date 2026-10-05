// Shared test helper: a stateful fake `bd` binary for create-chores.ts.
// `bd` is a genuine external system (its real database must never be touched
// by tests), so the script is driven against this fake via the BD_PATH
// override. The fake reproduces the real behaviours the tests depend on —
// `bd create --parent` label inheritance (unless `--no-inherit-labels` is
// passed) and `bd create --validate` section enforcement — and records every
// created bead to a JSON state file the test can read back.
//
// State lives in `state.json` next to the binary; the test seeds it with the
// parent bead and reads the children back after the script runs. Written async
// throughout — the repo's check-no-sync lint scans test/ (including helpers).

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FAKE_BD_SCRIPT = [
  "#!/usr/bin/env node",
  "// Stateful fake for `bd create` (test/helpers/fake-bd.mjs).",
  "const fs = require('node:fs/promises');",
  "",
  "const stateFile = process.env.FAKE_BD_STATE;",
  "const VALUE_FLAGS = new Set(['--type', '--description', '--priority', '--labels', '--parent']);",
  "const BOOL_FLAGS = new Set(['--silent', '--no-inherit-labels', '--validate']);",
  "",
  "(async () => {",
  "  const argv = process.argv.slice(2);",
  "  if (argv[0] === 'dep') process.exit(0);",
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
  "  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));",
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

/** Create a stateful fake `bd` binary in `dir`.
 * @param {string} dir  Directory to hold the binary and its state.json
 * @param {{ beads: Array<{ id: string, title: string, labels: string[] }> }} seed
 *        Pre-existing beads (the parent) the fake inherits labels from
 * @returns {Promise<{ bin: string, state: string }>} */
export async function makeFakeBd(dir, { beads }) {
  const bin = join(dir, "bd");
  const state = join(dir, "state.json");
  await writeFile(bin, FAKE_BD_SCRIPT + "\n");
  await chmod(bin, 0o755);
  await writeFile(state, JSON.stringify({ beads, nextId: 1 }));
  return { bin, state };
}
