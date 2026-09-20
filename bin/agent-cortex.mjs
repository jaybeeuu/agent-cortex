#!/usr/bin/env node

import { parseArgs, buildHelpText, validateHarness, validateExtHarness } from "../lib/cli.mjs";
import { installPi } from "./installers/pi.mjs";

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

if (parsed.command === "ext") {
  if (parsed.optionError) {
    process.stderr.write(`${parsed.optionError}\n`);
    process.exit(1);
  }

  if (parsed.subcommand === null) {
    process.stdout.write(buildHelpText() + "\n");
    process.exit(0);
  }

  // `ext prune` defaults to the pi harness — agent-cortex's own home harness —
  // because the store it lists is per-harness (see --help).
  if (parsed.subcommand === "prune") {
    const harness = parsed.harness ?? "pi";
    const check = validateExtHarness(harness);
    if (!check.ok) {
      process.stderr.write(`${check.error}\nRun "agent-cortex --help" for usage.\n`);
      process.exit(1);
    }

    const { pruneExtensions } = await import("./installers/ext-prune.mjs");
    try {
      const result = await pruneExtensions({ harness, dryRun: parsed.dryRun ?? false });
      // A failed uninstall is a non-zero exit so scripts can see it; every
      // selection was still attempted and reported individually.
      process.exit(result.failed.length > 0 ? 1 : 0);
    } catch (err) {
      process.stderr.write(`Extension prune failed: ${err.message}\n`);
      process.exit(1);
    }
  }

  // parsed.subcommand === "install" (parseArgs rejects any other subcommand).
  const check = validateExtHarness(parsed.harness);
  if (!check.ok) {
    process.stderr.write(`${check.error}\nRun "agent-cortex --help" for usage.\n`);
    process.exit(1);
  }

  const { installExtensions } = await import("./installers/ext.mjs");
  try {
    const result = await installExtensions({ harness: parsed.harness, dryRun: parsed.dryRun ?? false });
    printExtInstall(result);
    // A partial failure is a non-zero exit so callers (CI, scripts) can see it;
    // every extension was still attempted and reported individually.
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (err) {
    process.stderr.write(`Extension install failed: ${err.message}\n`);
    process.exit(1);
  }
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
    try {
      const result = await installPi({
        dryRun: parsed.dryRun ?? false,
        warn: () => {}, // warnings surface once in the printed summary
        ...(parsed.output ? { output: parsed.output } : {}),
        ...(parsed.pluginRoot ? { pluginRoot: parsed.pluginRoot } : {}),
      });
      printPiInstall(result);
    } catch (err) {
      process.stderr.write(`Install failed: ${err.message}\n`);
      process.exit(1);
    }
    process.exit(0);
  }

  process.stdout.write(`Installing agent-cortex for "${parsed.harness}" harness…\n`);

  // claude is the first wired harness: a plain `agent-cortex install claude`
  // materialises the plugin into the home install root (~/.agent-cortex/claude)
  // with copied, token-substituted skills, writes the marketplace manifest at
  // ~/.agent-cortex/.claude-plugin/marketplace.json, and registers it with
  // Claude Code (marketplace add → install → update); `--output <dir>` is the
  // generate-only form (tests/CI validation), and there is no committed claude/
  // subtree in the repo anymore.
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
          root: result.marketplaceRoot,
          manifest: result.marketplaceManifest,
          pluginVersion: result.pluginVersion,
          dryRun: parsed.dryRun ?? false,
          requireRegister: parsed.requireRegister ?? false,
        });
      }
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Install failed: ${err.message}\n`);
      process.exit(1);
    }
  }

  // copilot regenerates the flat agents/*.agent.md files the Copilot plugin
  // loads via plugin.json ("agents": "agents/") — the same code path
  // `pnpm build:copilot` runs.
  if (parsed.harness === "copilot") {
    const { installCopilot } = await import("./installers/copilot.mjs");
    try {
      await installCopilot({ output: parsed.output, dryRun: parsed.dryRun });
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Install failed: ${err.message}\n`);
      process.exit(1);
    }
  }

  process.exit(0);
}

/** Report the extension install plan: one line per extension plus a summary. */
function printExtInstall(result) {
  process.stdout.write(`Installing declared extensions for "${result.harness}" harness…\n`);
  for (const step of result.plan) {
    if (step.status === "already-installed") {
      process.stdout.write(`  · ${step.source} (already installed)\n`);
    } else if (step.status === "would-install") {
      process.stdout.write(`  → ${step.source} (would install)\n`);
    } else if (step.status === "installed") {
      process.stdout.write(`  ✓ ${step.source}\n`);
    } else {
      process.stdout.write(`  ⚠ ${step.source} — ${step.error}\n`);
    }
  }
  process.stdout.write(
    `  ${result.installed} ${result.dryRun ? "to install" : "installed"}, ${result.skipped} already installed, ${result.failed} failed\n`,
  );
  if (result.dryRun) {
    process.stdout.write("(dry-run — nothing installed)\n");
  }
}

function printPiInstall(result) {
  process.stdout.write(`Installing agent-cortex for "pi" harness…\n`);
  for (const agent of result.agents) {
    process.stdout.write(`  ✓ ${agent.name}.agent.md → ${agent.filePath}\n`);
  }
  process.stdout.write(`  ✓ Substituted ${result.skills.md} markdown file(s) across ${result.skills.skills} skill(s) → ${result.skills.dir}\n`);
  printManagedConfig("settings.json", result.settings);
  printManagedConfig("keybindings.json", result.keybindings);
  for (const warning of result.warnings) {
    process.stdout.write(`  ⚠ ${warning}\n`);
  }
  if (result.dryRun) {
    process.stdout.write("(dry-run — nothing written)\n");
  }
}

/** Report one managed pi config file (settings.json / keybindings.json). */
function printManagedConfig(label, info) {
  if (!info) return;
  if (info.action === "would-remove-symlink") {
    process.stdout.write(`  → would remove symlink ${info.path} and write ${label}\n`);
  } else if (info.action === "would-write") {
    process.stdout.write(`  → would write ${label} → ${info.path}\n`);
  } else if (info.action === "unchanged") {
    process.stdout.write(`  · ${label} → ${info.path} (unchanged)\n`);
  } else if (info.action === "skipped") {
    process.stdout.write(`  ⚠ ${label} modified after install — left untouched → ${info.path}\n`);
  } else if (info.action === "removed-symlink") {
    process.stdout.write(`  ✓ ${label} → ${info.path} (removed legacy symlink)\n`);
  } else {
    process.stdout.write(`  ✓ ${label} → ${info.path}\n`);
  }
}