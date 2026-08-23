const SUPPORTED_HARNESSES = ["copilot", "claude", "pi"];

export function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help" };
  }

  const [command, ...rest] = argv;

  if (command === "install") {
    const harness = rest[0] ?? null;
    const parsed = { command: "install", harness };
    for (let i = 1; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--output") {
        if (i + 1 >= rest.length) return { command: "unknown", name: arg };
        parsed.output = rest[++i];
      } else if (arg.startsWith("--output=")) {
        parsed.output = arg.slice("--output=".length);
      } else if (arg === "--dry-run") {
        parsed.dryRun = true;
      } else {
        return { command: "unknown", name: arg };
      }
    }
    return parsed;
  }

  return { command: "unknown", name: command };
}

export function buildHelpText() {
  return `Usage: agent-cortex <command> [options]

Commands:
  install <harness>   Install agent-cortex for a harness
                      Supported harnesses: ${SUPPORTED_HARNESSES.join(", ")}
                      Options (claude):
                        --output <dir>   Write the plugin subtree to <dir>
                                         (default: <package root>/claude)
                        --dry-run        Print what would be generated without writing
  --help, -h          Show this help text`;
}

export function validateHarness(harness) {
  if (harness === null) {
    return { ok: false, error: "Missing harness argument. Supported harnesses: copilot, claude, pi" };
  }
  if (!SUPPORTED_HARNESSES.includes(harness)) {
    return { ok: false, error: `Unknown harness "${harness}". Supported harnesses: ${SUPPORTED_HARNESSES.join(", ")}` };
  }
  return { ok: true };
}

export { SUPPORTED_HARNESSES };