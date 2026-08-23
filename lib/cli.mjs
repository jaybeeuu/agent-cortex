const SUPPORTED_HARNESSES = ["copilot", "claude", "pi"];

// Options accepted by `install <harness>`. `--output`/`--dry-run` are shared by
// the claude and pi installers; `--plugin-root` is pi-specific. Unknown or
// malformed options surface as `optionError` on the parsed result; the CLI
// prints them and exits 1.
const INSTALL_OPTIONS = {
  "--dry-run": { key: "dryRun" },
  "--output": { key: "output" },
  "--plugin-root": { key: "pluginRoot" },
};

export function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help" };
  }

  const [command, ...rest] = argv;

  if (command === "install") {
    let harness = null;
    let i = 0;
    if (rest.length > 0 && !rest[0].startsWith("--")) {
      harness = rest[0];
      i = 1;
    }

    const options = {};
    for (; i < rest.length; i++) {
      const arg = rest[i];
      // Support both `--output=<dir>` and `--output <dir>`.
      const inlineValue = arg.startsWith("--output=") ? arg.slice("--output=".length) : null;
      const spec = inlineValue !== null ? INSTALL_OPTIONS["--output"] : INSTALL_OPTIONS[arg];
      if (!spec) {
        return { command: "install", harness, optionError: `Unknown option "${arg}". Run "agent-cortex --help" for usage.` };
      }
      if (spec.key === "dryRun") {
        options.dryRun = true;
        continue;
      }
      if (inlineValue !== null) {
        options[spec.key] = inlineValue;
        continue;
      }
      const value = rest[i + 1];
      if (value == null || value.startsWith("--")) {
        return { command: "install", harness, optionError: `Missing value for "${arg}". Run "agent-cortex --help" for usage.` };
      }
      options[spec.key] = value;
      i += 1;
    }

    if (Object.keys(options).length === 0) {
      return { command: "install", harness };
    }
    return { command: "install", harness, ...options };
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
                      Options (pi):
                        --dry-run             Show what would be installed without writing
                        --output <dir>        Install into <dir>/agents and <dir>/skills
                                              (default: ~/.pi/agent)
                        --plugin-root <dir>   Override the plugin root used for {{PATH:...}}
                                              tokens (default: token-map.json's pi value)
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