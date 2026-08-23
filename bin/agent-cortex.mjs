#!/usr/bin/env node

import { parseArgs, buildHelpText, validateHarness } from "../lib/cli.mjs";

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
  const check = validateHarness(parsed.harness);
  if (!check.ok) {
    process.stderr.write(`${check.error}\nRun "agent-cortex --help" for usage.\n`);
    process.exit(1);
  }

  process.stdout.write(`Installing agent-cortex for "${parsed.harness}" harness…\n`);

  // claude is the first wired harness: generates the plugin subtree from the
  // canonical sources (agents/, agents-native/, skills/, hooks/claude/) via the
  // shared installClaude generator — the same code path `pnpm build:claude` runs.
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

  // copilot/pi installers are tracked as separate workstreams — nothing to do yet.
  process.exit(0);
}