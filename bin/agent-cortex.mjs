#!/usr/bin/env node

import { parseArgs, buildHelpText, resolveProgramName, validateHarness, SUPPORTED_HARNESSES } from "../lib/cli.mjs";
import {
  collectVersionReport,
  collectHarnessStatus,
  formatVersionReport,
  serialiseVersionReport,
} from "../lib/harness-versions.mjs";
import {
  describeClaudeArtifacts,
  describePiArtifacts,
  formatHarnessTable,
  formatUpdateFlags,
  formatUpdateReport,
  promptHarnessSelection,
  runUpdate,
  selectHarnesses,
} from "../lib/harness-update.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, realpath } from "node:fs/promises";
import { runSelfUpdate } from "../lib/self-update.mjs";
import { installPi, registerPi, sweepLegacyPiUserDirs } from "./installers/pi.mjs";

/** @typedef {import("./installers/pi.mjs").InstallPiResult} InstallPiResult */
/** @typedef {import("./installers/pi.mjs").RegisterPiResult} RegisterPiResult */

const argv = process.argv.slice(2);
// `agent-cortex`, `cortex` and `ctx` all run this file; the text names the one used.
const programName = resolveProgramName(process.argv[1]);
const parsed = parseArgs(argv, programName);

if (parsed.command === "help") {
  process.stdout.write(buildHelpText(programName) + "\n");
  process.exit(0);
}

/**
 * Read the version of the package this CLI ships in: `bin/` sits one level below
 * the package root, in the repo checkout and in the published tarball alike.
 * Resolved from this file's own location, never from the cwd or node_modules
 * resolution, so an installed CLI reports the version it was installed at.
 * Throws when that manifest is missing, unreadable, malformed, or has no version
 * string, so a broken install never prints a bogus version with a success exit.
 * @returns {Promise<string>}
 */
async function readPackageVersion() {
  const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(`Cannot read the package version from ${manifestPath}: ${/** @type {Error} */ (err).message}`);
  }
  const version = /** @type {{ version?: unknown }} */ (manifest).version;
  if (typeof version !== "string" || version === "") {
    throw new Error(`Cannot read the package version from ${manifestPath}: the manifest has no "version" string.`);
  }
  return version;
}

if (parsed.command === "version") {
  if (parsed.optionError) {
    process.stderr.write(`${parsed.optionError}\n`);
    process.exit(1);
  }
  try {
    const cliVersion = await readPackageVersion();
    // `--version` prints the bare version for scripts; the `version` subcommand
    // adds one line per installed harness, read from the installers'
    // fingerprints (read-only — no install, no network, no writes).
    if (parsed.report === true) {
      const report = await collectVersionReport({ cli: cliVersion });
      const output = parsed.json === true ? serialiseVersionReport(report) : formatVersionReport(report);
      process.stdout.write(`${output}\n`);
    } else {
      process.stdout.write(`${cliVersion}\n`);
    }
  } catch (err) {
    process.stderr.write(`${/** @type {Error} */ (err).message}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (parsed.command === "unknown") {
  process.stderr.write(`Unknown command: ${parsed.name}\nRun "${programName} --help" for usage.\n`);
  process.exit(1);
}

if (parsed.command === "install") {
  if (parsed.optionError) {
    process.stderr.write(`${parsed.optionError}\n`);
    process.exit(1);
  }

  const check = validateHarness(parsed.harness);
  if (!check.ok) {
    process.stderr.write(`${check.error}\nRun "${programName} --help" for usage.\n`);
    process.exit(1);
  }

  try {
    await installHarness(/** @type {"pi" | "claude"} */ (parsed.harness), {
      dryRun: parsed.dryRun ?? false,
      ...(parsed.output ? { output: parsed.output } : {}),
      ...(parsed.pluginRoot ? { pluginRoot: parsed.pluginRoot } : {}),
      requireRegister: parsed.requireRegister ?? false,
    });
  } catch (err) {
    process.stderr.write(`Install failed: ${/** @type {Error} */ (err).message}\n`);
    process.exit(1);
  }
  process.exit(0);
}

if (parsed.command === "update") {
  process.exitCode = await runUpdateCommand(parsed, programName);
}

/**
 * Run one harness's installer and, for a plain install, its registration.
 * `install <harness>` and `update` both come through here, so update-vs-install
 * stays the installer's decision and neither command grows a second install path.
 * @param {"pi" | "claude"} harness
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @param {string} [options.output]
 * @param {string} [options.pluginRoot]
 * @param {boolean} [options.requireRegister]
 * @returns {Promise<string[]>} What the installer wrote, for the update report
 */
async function installHarness(harness, { dryRun = false, output, pluginRoot, requireRegister = false } = {}) {
  if (harness === "pi") {
    // A plain `agent-cortex install pi` stages the package into the home
    // install root (~/.agent-cortex/pi) and registers that directory with pi
    // through pi's own `pi install` (idempotent by state: a re-run is a no-op
    // update); `--output <dir>` is the stage-only form (tests/CI) and prints
    // the registration command instead.
    const result = await installPi({
      dryRun,
      warn: () => {}, // warnings surface once in the printed summary
      ...(output ? { output } : {}),
      ...(pluginRoot ? { pluginRoot } : {}),
    });
    printPiInstall(result);
    if (output === undefined) {
      const registration = await registerPi({
        output: result.output,
        dryRun,
        requireRegister,
        warn: (msg) => process.stdout.write(`  ⚠ ${msg}\n`),
      });
      // The old installer's rendered copies are only stale once the staged
      // package is what pi loads — and nothing is deleted on a dry run. The
      // flag is passed through as well, so the sweep's own guarantee does not
      // depend on this guard staying in place.
      if (registration.registered && !dryRun) {
        printPiSweep(
          await sweepLegacyPiUserDirs({
            piUserDir: dirname(registration.settingsPath),
            dryRun,
          }),
        );
      }
    } else {
      process.stdout.write(`  → register it with pi: pi install ${result.output}\n`);
    }
    return describePiArtifacts(result);
  }

  process.stdout.write(`Installing agent-cortex for "${harness}" harness…\n`);

  // claude is the first wired harness: a plain `agent-cortex install claude`
  // materialises the plugin into the home install root (~/.agent-cortex/claude)
  // with copied, token-substituted skills, writes the marketplace manifest at
  // ~/.agent-cortex/.claude-plugin/marketplace.json, merges the committed
  // claude/settings.json template into ~/.claude/settings.json (asserting only
  // the enabledPlugins + extraKnownMarketplaces entries the template declares), and registers it with Claude Code
  // (marketplace add → install → update); `--output <dir>` is the generate-only
  // form (tests/CI validation), and the generated claude/ plugin subtree is
  // never committed — only the settings template is.

  // Avoid loading the installer on the help/summary paths and for other harnesses.
  const { installClaude, registerClaude } = await import("./installers/claude.mjs");
  const result = await installClaude({
    dryRun,
    warn: () => {}, // warnings surface once via result.warnings
    ...(output ? { output } : {}),
  });
  for (const warning of result.warnings) {
    process.stdout.write(`  ⚠ ${warning}\n`);
  }
  // Runtime registration happens only for the plain install — `--output`
  // keeps generating only (documented in --help).
  if (output === undefined) {
    await registerClaude({
      // A default install always materialises the marketplace manifest; the
      // generate-only form (--output) is the only path where it is null, and
      // this branch is not that path.
      root: /** @type {string} */ (result.marketplaceRoot),
      manifest: /** @type {object} */ (result.marketplaceManifest),
      pluginVersion: result.pluginVersion,
      // The enablement check reads the same file this install just merged:
      // a plugin Claude Code does not enable loads nothing.
      ...(result.settings ? { settingsPath: result.settings.path } : {}),
      dryRun,
      requireRegister,
    });
  }
  return describeClaudeArtifacts(result);
}

/**
 * `ctx update`: choose the harnesses, refresh each through its installer, report
 * what changed. Every write happens inside `installHarness`'s call into the
 * harness installer — this command adds selection and reporting only.
 * @param {import("../lib/cli.mjs").ParsedArgs} parsed
 * @param {string} programName
 * @returns {Promise<number>} The exit code
 */
async function runUpdateCommand(parsed, programName) {
  if (parsed.optionError) {
    process.stderr.write(`${parsed.optionError}\n`);
    return 1;
  }
  try {
    const cliVersion = await readPackageVersion();
    const statuses = await collectHarnessStatus({ cli: cliVersion });
    const all = parsed.all ?? false;
    let harnesses = parsed.harnesses ?? [];

    // Bare `ctx update` asks; a non-interactive shell gets the same table plus
    // the flags that select without a prompt, and a non-zero exit so a script
    // never mistakes "nothing chosen" for "nothing to do".
    if (harnesses.length === 0 && !all) {
      if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
        process.stdout.write(`${formatHarnessTable(statuses)}\n\n${formatUpdateFlags(programName)}\n`);
        return 1;
      }
      harnesses = await promptHarnessSelection({ statuses });
      if (harnesses.length === 0) {
        process.stdout.write("No harness selected; nothing updated.\n");
        return 0;
      }
    }

    const plan = selectHarnesses({ statuses, harnesses, all, force: parsed.force ?? false });
    if (plan.unknown.length > 0) {
      const names = plan.unknown.map((name) => `"${name}"`).join(", ");
      process.stderr.write(
        `Unknown harness ${names}. Supported harnesses: ${SUPPORTED_HARNESSES.join(", ")}\nRun "${programName} --help" for usage.\n`,
      );
      return 1;
    }

    const entries = await runUpdate({
      cli: cliVersion,
      targets: plan.targets,
      refresh: (harness) => installHarness(/** @type {"pi" | "claude"} */ (harness), {}),
    });
    process.stdout.write(`${formatUpdateReport({ cli: cliVersion, entries, skipped: plan.skipped })}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`Update failed: ${/** @type {Error} */ (err).message}\n`);
    return 1;
  }
}

/** @param {{ removed: string[] }} result */
function printPiSweep({ removed }) {
  if (removed.length === 0) return;
  process.stdout.write(
    `  ✓ Removed ${removed.length} artifact(s) the pre-staged-model installer rendered into pi's user directory (one-time migration — the staged package is the source from now on)\n`,
  );
  for (const path of removed) {
    process.stdout.write(`    - ${path}\n`);
  }
}

if (parsed.command === "self-update") {
  if (parsed.optionError) {
    process.stderr.write(`${parsed.optionError}\n`);
    process.exit(1);
  }
  try {
    // The real path follows the global bin shim into the layout of the manager
    // that installed this copy, which is what identifies the owner. Taking it
    // from this file's own URL keeps detection on the running entry point, not
    // on the cwd or on PATH.
    const entryPoint = await realpath(fileURLToPath(import.meta.url));
    process.exitCode = await runSelfUpdate({ entryPoint, programName, check: parsed.check ?? false });
  } catch (err) {
    process.stderr.write(`${/** @type {Error} */ (err).message}\n`);
    process.exit(1);
  }
}

if (parsed.command === "migrate") {
  if (parsed.optionError) {
    process.stderr.write(`${parsed.optionError}\n`);
    process.exit(1);
  }

  // Loaded lazily: the migration registry is only needed on this path.
  const { runMigrate } = await import("../scripts/lib/migrate.mjs");
  try {
    await runMigrate({ apply: parsed.apply ?? false, dir: parsed.dir });
  } catch (err) {
    process.stderr.write(`Migration failed: ${/** @type {Error} */ (err).message}\n`);
    process.exit(1);
  }
  process.exit(0);
}

/** @param {InstallPiResult} result */
function printPiInstall(result) {
  process.stdout.write(`Installing agent-cortex for "pi" harness…\n`);
  process.stdout.write(`  ✓ Staged pi package → ${result.output}\n`);
  for (const agent of result.agents) {
    process.stdout.write(`  ✓ ${agent.name}.agent.md → ${agent.filePath}\n`);
  }
  process.stdout.write(`  ✓ Substituted ${result.skills.md} markdown file(s) across ${result.skills.skills} skill(s) → ${result.skills.dir}\n`);
  if (result.docs.files.length > 0) {
    process.stdout.write(`  ✓ Copied ${result.docs.files.length} doc(s) → ${result.docs.dir}\n`);
  }
  process.stdout.write(`  ✓ Copied ${result.extensions.files} extension file(s) → ${result.extensions.dir}\n`);
  for (const name of result.packages.bundled) {
    process.stdout.write(`  ✓ Bundled pi package ${name} → ${join(result.packages.dir, name)}\n`);
  }
  const transitive = result.packages.staged.length - result.packages.bundled.length;
  if (transitive > 0) {
    process.stdout.write(`  ✓ Copied ${transitive} transitive dependency tree(s) → ${result.packages.dir}\n`);
  }
  process.stdout.write(`  ✓ ${result.dryRun ? "Would write" : "Wrote"} ${result.manifest.path} (version ${result.manifest.manifest.version})\n`);
  for (const warning of result.warnings) {
    process.stdout.write(`  ⚠ ${warning}\n`);
  }
  if (result.dryRun) {
    process.stdout.write("(dry-run — nothing written)\n");
  }
}
