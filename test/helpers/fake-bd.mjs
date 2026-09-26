// Shared test helper: a stateful fake `bd` binary for create-chores.ts.
// `bd` is a genuine external system (its real database must never be touched
// by tests), so the script is driven against this fake via the BD_PATH
// override. The fake reproduces the one real behaviour the test depends on —
// `bd create --parent` inherits the parent's labels unless
// `--no-inherit-labels` is passed — and records every created bead to a JSON
// state file the test can read back.
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
  "const BOOL_FLAGS = new Set(['--silent', '--no-inherit-labels']);",
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
  "  const explicit = (flags['--labels'] || '').split(',').filter(Boolean);",
  "  const parent = state.beads.find((b) => b.id === flags['--parent']);",
  "  const inherited = parent && !bools.has('--no-inherit-labels') ? parent.labels : [];",
  "  const labels = [...new Set([...inherited, ...explicit])];",
  "",
  "  const id = 'bd-' + state.nextId++;",
  "  state.beads.push({ id, title, labels, parent: flags['--parent'] ?? null });",
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
