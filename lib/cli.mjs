const SUPPORTED_HARNESSES = ["claude", "pi"];

// Options accepted by `install <harness>`. `--output`/`--dry-run` are shared by
// the claude and pi installers; `--plugin-root` is pi-specific. Unknown or
// malformed options surface as `optionError` on the parsed result; the CLI
// prints them and exits 1.
const INSTALL_OPTIONS = {
  "--dry-run": { key: "dryRun", boolean: true },
  "--output": { key: "output" },
  "--plugin-root": { key: "pluginRoot" },
  "--require-register": { key: "requireRegister", boolean: true },
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
      if (spec.boolean) {
        options[spec.key] = true;
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
                        (no --output)   Materialise the plugin into
                                        ~/.agent-cortex/claude, write the
                                        marketplace manifest at
                                        ~/.agent-cortex/.claude-plugin/
                                        marketplace.json, and register it with
                                        Claude Code via the "claude plugin" CLI
                                        (marketplace add → install → update,
                                        idempotent by state: a re-run is the
                                        update path, repeat install a no-op;
                                        requires the plugin CLI, v2+)
                        --output <dir>  Write the plugin subtree to <dir> only —
                                        no marketplace manifest or registration
                                        (default: ~/.agent-cortex/claude)
                        --dry-run       Print what would be generated/registered
                                        without writing
                        --require-register
                                        Fail the install when Claude Code
                                        registration cannot run (missing CLI,
                                        pre-v2 build); default warns and prints
                                        the manual registration commands
                      Options (pi):
                        (no --output)         Materialise the pi package into
                                              ~/.agent-cortex/pi: package.json,
                                              agents/, skills/, extensions/ and
                                              the bundled third-party pi packages
                                              (pi-questions, pi-web-access), then
                                              REGISTER that directory with pi via
                                              "pi install" (user scope, idempotent
                                              by state: a re-run is a no-op update,
                                              and stale raw-repo sources are
                                              removed so one source remains).
                                              Once registered, the artifacts the
                                              pre-staged-model installer rendered
                                              into ~/.pi/agent are removed in a
                                              one-time migration: agents and
                                              skills whose names this package
                                              ships or once shipped. Anything
                                              else there is left alone, including
                                              the whole extensions/ directory.
                                              A migration that removed every
                                              copy it attributed is recorded in
                                              ~/.agent-cortex/legacy-sweep.json
                                              (keyed by the pi user directory)
                                              and never runs there twice; one
                                              that could not be completed warns
                                              and is retried on the next install.
                        --output <dir>        Stage the package into <dir> only —
                                              no registration (default:
                                              ~/.agent-cortex/pi)
                        --dry-run             Show what would be staged and
                                              registered without writing or spawning
                        --plugin-root <dir>   Override the plugin root used for {{PATH:...}}
                                              tokens (default: token-map.json's pi value)
                        --require-register
                                              Fail the install when the pi CLI
                                              cannot register the staged package
                                              (missing from PATH); default warns and
                                              prints the manual commands
  --help, -h          Show this help text`;
}

export function validateHarness(harness) {
  if (harness === null) {
    return {
      ok: false,
      error: `Missing harness argument. Supported harnesses: ${SUPPORTED_HARNESSES.join(", ")}`,
    };
  }
  if (!SUPPORTED_HARNESSES.includes(harness)) {
    return { ok: false, error: `Unknown harness "${harness}". Supported harnesses: ${SUPPORTED_HARNESSES.join(", ")}` };
  }
  return { ok: true };
}

export { SUPPORTED_HARNESSES };