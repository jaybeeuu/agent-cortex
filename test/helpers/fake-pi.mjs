// Shared test helper: a stateful fake `pi` binary for pi's package commands.
// The real CLI is a genuine external system (and its user settings must never
// be touched by tests), so tests drive this fake instead. It records every
// invocation to `calls.log` (argv, space-joined, one line each) and simulates
// just enough real behaviour to assert registration state:
//
//   --version          → exit 0 (availability probe)
//   list               → configured package sources
//   install <source>   → adds <source> to settings.json `packages`, persisted
//                        relative to the settings file's directory (what real
//                        pi does) unless an entry already resolves to it
//   remove <source>    → drops the matching entry; exit 1 when none matches
//
// Local sources are resolved the way pi resolves them: relative to the
// directory holding settings.json. `failWhen` makes any invocation whose argv
// contains the substring exit 1 (command failures).
//
// Written async throughout (the fake is a child process and the helper's own
// I/O is test code) — the repo's check-no-sync lint scans test/ for *Sync.

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FAKE_PI_SCRIPT = [
  "#!/usr/bin/env node",
  "// Stateful fake for the `pi` package CLI (test/helpers/fake-pi.mjs).",
  "const fs = require('node:fs/promises');",
  "const path = require('node:path');",
  "const os = require('node:os');",
  "",
  "const dir = __dirname;",
  "const settingsFile = path.join(dir, 'settings.json');",
  "const logFile = path.join(dir, 'calls.log');",
  "const failWhenFile = path.join(dir, 'failWhen.txt');",
  "",
  "const expand = (p) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);",
  "const sourceOf = (entry) => (typeof entry === 'string' ? entry : entry && entry.source);",
  "// pi resolves a configured local source against the settings file's directory.",
  "const resolvedSource = (entry) => path.resolve(dir, expand(sourceOf(entry)));",
  "const resolvedArgument = (arg) => path.resolve(dir, expand(arg));",
  "",
  "(async () => {",
  "  const argv = process.argv.slice(2);",
  "  const joined = argv.join(' ');",
  "  await fs.appendFile(logFile, joined + '\\n');",
  "",
  "  const failWhen = await fs.readFile(failWhenFile, 'utf8').catch(() => null);",
  "  if (failWhen && joined.includes(failWhen)) process.exit(1);",
  "",
  "  if (argv[0] === '--version' || argv[0] === '-v') {",
  "    console.log('1.4.0');",
  "    process.exit(0);",
  "  }",
  "",
  "  const readSettings = async () => {",
  "    try {",
  "      return JSON.parse(await fs.readFile(settingsFile, 'utf8'));",
  "    } catch {",
  "      return {};",
  "    }",
  "  };",
  "  const writePackages = async (settings, packages) =>",
  "    fs.writeFile(settingsFile, JSON.stringify({ ...settings, packages }, null, 2) + '\\n');",
  "",
  "  const [command, argument] = argv;",
  "  const settings = await readSettings();",
  "  const packages = settings.packages ?? [];",
  "",
  "  if (command === 'list') {",
  "    if (packages.length === 0) {",
  "      console.log('No packages installed.');",
  "      process.exit(0);",
  "    }",
  "    console.log('User packages:');",
  "    for (const entry of packages) console.log('  ' + sourceOf(entry));",
  "    process.exit(0);",
  "  }",
  "",
  "  if (command === 'install') {",
  "    const target = resolvedArgument(argument);",
  "    const persisted = path.relative(dir, target) || '.';",
  "    const index = packages.findIndex((entry) => resolvedSource(entry) === target);",
  "    if (index === -1) {",
  "      packages.push(persisted);",
  "    } else if (typeof packages[index] === 'string') {",
  "      packages[index] = persisted;",
  "    } else {",
  "      packages[index] = { ...packages[index], source: persisted };",
  "    }",
  "    await writePackages(settings, packages);",
  "    console.log('Installed ' + argument);",
  "    process.exit(0);",
  "  }",
  "",
  "  if (command === 'remove') {",
  "    const target = resolvedArgument(argument);",
  "    const next = packages.filter((entry) => resolvedSource(entry) !== target);",
  "    if (next.length === packages.length) {",
  "      console.error('No matching package found for ' + argument);",
  "      process.exit(1);",
  "    }",
  "    await writePackages(settings, next);",
  "    console.log('Removed ' + argument);",
  "    process.exit(0);",
  "  }",
  "",
  "  process.exit(0);",
  "})().catch((err) => {",
  "  console.error(err);",
  "  process.exit(1);",
  "});",
].join("\n");

/** Create a stateful fake `pi` binary in `dir`.
 *
 * The binary's own directory doubles as pi's settings directory, so a local
 * package source is persisted relative to it exactly as real pi does.
 * @param {string} dir  Directory to hold bin, calls.log, settings.json
 * @param {{ failWhen?: string|null, packages?: unknown[] }} [options]
 *   failWhen: invocations whose argv contains the substring exit 1;
 *   packages: initial `packages` array for settings.json
 * @returns {Promise<{ bin: string, log: string, settingsPath: string }>} */
export async function makeFakePi(dir, { failWhen = null, packages = [] } = {}) {
  const bin = join(dir, "pi");
  const log = join(dir, "calls.log");
  const settingsPath = join(dir, "settings.json");
  await writeFile(bin, FAKE_PI_SCRIPT + "\n");
  await chmod(bin, 0o755);
  await writeFile(settingsPath, `${JSON.stringify({ packages }, null, 2)}\n`);
  if (failWhen) await writeFile(join(dir, "failWhen.txt"), failWhen);
  return { bin, log, settingsPath };
}
