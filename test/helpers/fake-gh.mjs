// Shared test helper: a `gh` double for post-merge-check.mjs.
//
// `gh` is a genuine external boundary — its real output and its rate limits belong to
// GitHub — so the script is driven against this double, via the GH_PATH override or an
// injected runner. The double reproduces the calls the check makes and serves payloads
// captured from the real CLI: `repo view --json nameWithOwner,defaultBranchRef`,
// `run list --commit <sha> --json ...`, and `run view <id> --json jobs`.
//
// It records every invocation, so a test can prove what the check did *not* call (a
// workflow re-run, for instance). Written async throughout — the repo's check-no-sync
// lint scans test/ (including helpers).

import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FAKE_GH_SCRIPT = [
  "#!/usr/bin/env node",
  "// Stateful fake for `gh` (test/helpers/fake-gh.mjs): repo view, run list, run view.",
  "const fs = require('node:fs/promises');",
  "",
  "const stateFile = process.env.FAKE_GH_STATE;",
  "",
  "(async () => {",
  "  const argv = process.argv.slice(2);",
  "  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));",
  "  state.calls.push(argv.join(' '));",
  "  await fs.writeFile(stateFile, JSON.stringify(state));",
  "",
  "  if (argv[0] === 'repo' && argv[1] === 'view') {",
  "    if (state.repositoryError) {",
  "      process.stderr.write(state.repositoryError + '\\n');",
  "      process.exit(1);",
  "    }",
  "    process.stdout.write(JSON.stringify(state.repository) + '\\n');",
  "    return;",
  "  }",
  "",
  "  if (argv[0] === 'run' && argv[1] === 'list') {",
  "    // Successive lists model polling: the last payload repeats once the script is out.",
  "    const list = state.runLists.length > 1 ? state.runLists.shift() : state.runLists[0];",
  "    await fs.writeFile(stateFile, JSON.stringify(state));",
  "    process.stdout.write(JSON.stringify(list ?? []) + '\\n');",
  "    return;",
  "  }",
  "",
  "  if (argv[0] === 'run' && argv[1] === 'view') {",
  "    const view = state.runViews[argv[2]];",
  "    if (!view) {",
  "      process.stderr.write('no such run: ' + argv[2] + '\\n');",
  "      process.exit(1);",
  "    }",
  "    process.stdout.write(JSON.stringify(view) + '\\n');",
  "    return;",
  "  }",
  "",
  "  process.stderr.write('fake gh: unsupported command: ' + argv.join(' ') + '\\n');",
  "  process.exit(1);",
  "})().catch((err) => {",
  "  console.error(err);",
  "  process.exit(1);",
  "});",
].join('\n');

/**
 * @typedef {object} FakeGhSeed
 * @property {{ nameWithOwner: string, defaultBranchRef: { name: string } } | null} [repository]
 *   Payload of `gh repo view`; a null repository means gh cannot resolve a GitHub repo.
 * @property {string} [repositoryError]  stderr `gh repo view` prints before exiting 1.
 * @property {object[][]} [runLists]     Successive `gh run list` payloads; the last repeats.
 * @property {Record<string, unknown>} [runViews]  `gh run view <id>` payloads, keyed by run id.
 */

/** Create a stateful fake `gh` binary in `dir`.
 * @param {string} dir  Directory to hold the binary and its state file
 * @param {FakeGhSeed} seed
 * @returns {Promise<{ bin: string, state: string }>} */
export async function makeFakeGh(dir, { repository = null, repositoryError, runLists = [[]], runViews = {} }) {
  const bin = join(dir, "gh");
  const state = join(dir, "gh-state.json");

  await writeFile(bin, FAKE_GH_SCRIPT + "\n");
  await chmod(bin, 0o755);
  await writeFile(state, JSON.stringify({ repository, repositoryError, runLists, runViews, calls: [] }));
  return { bin, state };
}
