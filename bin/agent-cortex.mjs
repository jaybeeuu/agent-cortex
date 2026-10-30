#!/usr/bin/env node

import { parseArgs, buildHelpText, validateHarness } from "../lib/cli.mjs";
import { join, dirname } from "node:path";
import { installPi, registerPi, sweepLegacyPiUserDirs } from "./installers/pi.mjs";

/** @typedef {import("./installers/pi.mjs").InstallPiResult} InstallPiResult */
/** @typedef {import("./installers/pi.mjs").RegisterPiResult} RegisterPiResult */

const argv = process.argv.slice(2);
const parsed = parseArgs(argv);

if (parsed.command === "help") {
  process.stdout.write(buildHelpText() + "\n");
  process.exit(0);
}

if (parsed.command === "unknown") {
  process.stderr.write(`Unknown command: ${parsed.name}\nRun "agent-cortex --help" for usage.\n`);
  process.exit(1);
}

if (parsed.command === "install") {
  if (parsed.optionError) {
    process.stderr.write(`${parsed.optionError}\n`);
    process.exit(1);
  }

  const check = validateHarness(parsed.harness);
  if (!check.ok) {
    process.stderr.write(`${check.error}\nRun "agent-cortex --help" for usage.\n`);
    process.exit(1);
  }

  if (parsed.harness === "pi") {
    // A plain `agent-cortex install pi` stages the package into the home
    // install root (~/.agent-cortex/pi) and registers that directory with pi
    // through pi's own `pi install` (idempotent by state: a re-run is a no-op
    // update); `--output <dir>` is the stage-only form (tests/CI) and prints
    // the registration command instead.
    try {
      const result = await installPi({
        dryRun: parsed.dryRun ?? false,
        warn: () => {}, // warnings surface once in the printed summary
        ...(parsed.output ? { output: parsed.output } : {}),
        ...(parsed.pluginRoot ? { pluginRoot: parsed.pluginRoot } : {}),
      });
      printPiInstall(result);
      if (parsed.output === undefined) {
        const registration = await registerPi({
          output: result.output,
          dryRun: parsed.dryRun ?? false,
          requireRegister: parsed.requireRegister ?? false,
          warn: (msg) => process.stdout.write(`  ⚠ ${msg}\n`),
        });
        // The old installer's rendered copies are only stale once the staged
        // package is what pi loads — and nothing is deleted on a dry run. The
        // flag is passed through as well, so the sweep's own guarantee does not
        // depend on this guard staying in place.
        if (registration.registered && !(parsed.dryRun ?? false)) {
          printPiSweep(
            await sweepLegacyPiUserDirs({
              piUserDir: dirname(registration.settingsPath),
              dryRun: parsed.dryRun ?? false,
            }),
          );
        }
      } else {
        process.stdout.write(`  → register it with pi: pi install ${result.output}\n`);
      }
    } catch (err) {
      process.stderr.write(`Install failed: ${/** @type {Error} */ (err).message}\n`);
      process.exit(1);
    }
    process.exit(0);
  }

  process.stdout.write(`Installing agent-cortex for "${parsed.harness}" harness…\n`);

  // claude is the first wired harness: a plain `agent-cortex install claude`
  // materialises the plugin into the home install root (~/.agent-cortex/claude)
  // with copied, token-substituted skills, writes the marketplace manifest at
  // ~/.agent-cortex/.claude-plugin/marketplace.json, merges the committed
  // claude/settings.json template into ~/.claude/settings.json (owning only
  // enabledPlugins + extraKnownMarketplaces), and registers it with Claude Code
  // (marketplace add → install → update); `--output <dir>` is the generate-only
  // form (tests/CI validation), and the generated claude/ plugin subtree is
  // never committed — only the settings template is.
  if (parsed.harness === "claude") {
    // Avoid loading the installer on the help/summary paths and for other harnesses.
    const { installClaude, registerClaude } = await import("./installers/claude.mjs");
    try {
      const result = await installClaude({
        dryRun: parsed.dryRun ?? false,
        warn: () => {}, // warnings surface once via result.warnings
        ...(parsed.output ? { output: parsed.output } : {}),
      });
      for (const warning of result.warnings) {
        process.stdout.write(`  ⚠ ${warning}\n`);
      }
      // Runtime registration happens only for the plain install — `--output`
      // keeps generating only (documented in --help).
      if (parsed.output === undefined) {
        await registerClaude({
          // A default install always materialises the marketplace manifest; the
          // generate-only form (--output) is the only path where it is null, and
          // this branch is not that path.
          root: /** @type {string} */ (result.marketplaceRoot),
          manifest: /** @type {object} */ (result.marketplaceManifest),
          pluginVersion: result.pluginVersion,
          dryRun: parsed.dryRun ?? false,
          requireRegister: parsed.requireRegister ?? false,
        });
      }
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Install failed: ${/** @type {Error} */ (err).message}\n`);
      process.exit(1);
    }
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

if (parsed.command === "migrate") {
  if (parsed.optionError) {
    process.stderr.write(`${parsed.optionError}\n`);
    process.exit(1);
  }

  // Loaded lazily: the migration registry is only needed on this path.
  const { runMigrate } = await import("../scripts/lib/migrate.mjs");
  try {
    await runMigrate({ apply: parsed.apply ?? false });
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
