// Shared test helper: a stateful fake `claude` binary for the `claude plugin`
// CLI. The real CLI is a genuine external system (and its home config must
// never be touched by tests), so tests drive this fake instead. It records
// every invocation to `calls.log` (argv, space-joined, one line each) and
// simulates just enough real behaviour for idempotency assertions:
//
//   plugin --help                    → exit 0 (availability probe)
//   plugin marketplace list --json   → registered marketplaces as JSON
//   plugin marketplace add <root>    → registers <root> (name read from its
//                                      .claude-plugin/marketplace.json)
//   plugin marketplace update <m>    → exit 0
//   plugin list --json               → installed plugins as JSON
//   plugin install <id> -y           → records id at the version published by
//                                      the marketplace source's plugin.json
//   plugin update <name> -y          → re-reads the version from the source
//
// State lives in `state.json` next to the binary, so a test can re-run the CLI
// against the same fake and observe the update path. `failWhen` makes any
// invocation whose argv contains the substring exit 1 (probe/command failures).
//
// Written async throughout (the fake is a child process and the helper's own
// I/O is test code) — the repo's check-no-sync lint scans test/ for *Sync.

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FAKE_CLAUDE_SCRIPT = [
  "#!/usr/bin/env node",
  "// Stateful fake for the `claude plugin` CLI (test/helpers/fake-claude.mjs).",
  "const fs = require('node:fs/promises');",
  "const path = require('node:path');",
  "",
  "const dir = __dirname;",
  "const stateFile = path.join(dir, 'state.json');",
  "const logFile = path.join(dir, 'calls.log');",
  "const failWhenFile = path.join(dir, 'failWhen.txt');",
  "",
  "(async () => {",
  "  const argv = process.argv.slice(2);",
  "  const joined = argv.join(' ');",
  "  await fs.appendFile(logFile, joined + '\\n');",
  "",
  "  const failWhen = await fs.readFile(failWhenFile, 'utf8').catch(() => null);",
  "  if (failWhen && joined.includes(failWhen)) process.exit(1);",
  "",
  "  if (argv[0] !== 'plugin') process.exit(0);",
  "",
  "  const readState = async () => {",
  "    try {",
  "      return JSON.parse(await fs.readFile(stateFile, 'utf8'));",
  "    } catch {",
  "      return { markets: [], installed: [] };",
  "    }",
  "  };",
  "  const writeState = (state) => fs.writeFile(stateFile, JSON.stringify(state));",
  "",
  "  // Real claude resolves the plugin version from the marketplace source's",
  "  // plugin.json; the fake mirrors that by reading <source>/claude/.claude-plugin/plugin.json.",
  "  const pluginJsonVersion = async (marketPath) => {",
  "    try {",
  "      return JSON.parse(await fs.readFile(path.join(marketPath, 'claude', '.claude-plugin', 'plugin.json'), 'utf8')).version;",
  "    } catch {",
  "      return undefined;",
  "    }",
  "  };",
  "  const marketplaceName = async (source) => {",
  "    try {",
  "      return JSON.parse(await fs.readFile(path.join(source, '.claude-plugin', 'marketplace.json'), 'utf8')).name;",
  "    } catch {",
  "      return undefined;",
  "    }",
  "  };",
  "",
  "  const state = await readState();",
  "  const [sub, ...rest] = argv.slice(1);",
  "",
  "  if (sub === '--help') process.exit(0);",
  "",
  "  if (sub === 'marketplace') {",
  "    const [op, ...opArgs] = rest;",
  "    if (op === 'list') {",
  "      console.log(JSON.stringify(state.markets));",
  "      process.exit(0);",
  "    }",
  "    if (op === 'add') {",
  "      const source = path.resolve(opArgs[0]);",
  "      const name = (await marketplaceName(source)) ?? 'market-' + state.markets.length;",
  "      if (!state.markets.some((m) => m.name === name)) state.markets.push({ name, path: source });",
  "      await writeState(state);",
  "      process.exit(0);",
  "    }",
  "    if (op === 'update') process.exit(0);",
  "    process.exit(0);",
  "  }",
  "",
  "  if (sub === 'list') {",
  "    console.log(JSON.stringify(state.installed));",
  "    process.exit(0);",
  "  }",
  "",
  "  if (sub === 'install') {",
  "    const id = rest[0];",
  "    if (!state.installed.some((i) => i.id === id)) {",
  "      const [name, market] = id.split('@');",
  "      const m = state.markets.find((x) => x.name === market);",
  "      state.installed.push({ id, version: m ? (await pluginJsonVersion(m.path)) ?? '0.0.0' : '0.0.0' });",
  "      await writeState(state);",
  "    }",
  "    process.exit(0);",
  "  }",
  "",
  "  if (sub === 'update') {",
  "    const name = rest[0];",
  "    const entry = state.installed.find((i) => i.id.startsWith(name + '@'));",
  "    if (entry) {",
  "      const m = state.markets.find((x) => x.name === entry.id.split('@')[1]);",
  "      const v = m ? await pluginJsonVersion(m.path) : undefined;",
  "      if (v) entry.version = v;",
  "      await writeState(state);",
  "    }",
  "    process.exit(0);",
  "  }",
  "",
  "  process.exit(0);",
  "})().catch((err) => {",
  "  console.error(err);",
  "  process.exit(1);",
  "});",
].join("\n");

/** Create a stateful fake `claude` binary in `dir`.
 * @param {string} dir  Directory to hold bin, calls.log, state.json
 * @param {{ failWhen?: string|null }} [options]  Invocations whose argv contains
 *                                                failWhen exit 1
 * @returns {Promise<{ bin: string, log: string, state: string }>} */
export async function makeFakeClaude(dir, { failWhen = null } = {}) {
  const bin = join(dir, "claude");
  const log = join(dir, "calls.log");
  const state = join(dir, "state.json");
  await writeFile(bin, FAKE_CLAUDE_SCRIPT + "\n");
  await chmod(bin, 0o755);
  await writeFile(state, JSON.stringify({ markets: [], installed: [] }));
  if (failWhen) await writeFile(join(dir, "failWhen.txt"), failWhen);
  return { bin, log, state };
}

/** Registration actions from a fake call log: probes and state queries dropped.
 * @param {string[]} lines  Raw call-log lines
 * @returns {string[]}      Action lines (marketplace add/update, install, update) */
export function registrationActions(lines) {
  return lines.filter((c) => !c.startsWith("plugin --help") && !c.includes("--json"));
}