#!/usr/bin/env node

import { parseArgs, buildHelpText, validateHarness } from "../lib/cli.mjs";
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
      const result = installPi({
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

  // claude is the first wired harness: generates the plugin subtree from the
  // canonical sources (agents/, agents-native/, skills/, hooks/claude/) via the
  // shared installClaude generator — `pnpm build:claude` is an alias of this
  // invocation, so there is no separate build-time code path.
  if (parsed.harness === "claude") {
    // Avoid loading the installer on the help/summary paths and for other harnesses.
    const { installClaude } = await import("./installers/claude.mjs");
    try {
      installClaude({ output: parsed.output, dryRun: parsed.dryRun });
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
      installCopilot({ output: parsed.output, dryRun: parsed.dryRun });
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Install failed: ${err.message}\n`);
      process.exit(1);
    }
  }

  process.exit(0);
}

function printPiInstall(result) {
  process.stdout.write(`Installing agent-cortex for "pi" harness…\n`);
  for (const agent of result.agents) {
    process.stdout.write(`  ✓ ${agent.name}.agent.md → ${agent.filePath}\n`);
  }
  process.stdout.write(`  ✓ Substituted ${result.skills.md} markdown file(s) across ${result.skills.skills} skill(s) → ${result.skills.dir}\n`);
  for (const warning of result.warnings) {
    process.stdout.write(`  ⚠ ${warning}\n`);
  }
  if (result.dryRun) {
    process.stdout.write("(dry-run — nothing written)\n");
  }
}