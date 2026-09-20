import { EXT_HARNESSES } from "./extension-manifest.mjs";

const SUPPORTED_HARNESSES = ["copilot", "claude", "pi"];

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

// Options accepted by every `ext` subcommand. `--harness` selects the harness
// (validated by validateExtHarness); `--dry-run` is shared with the installers.
const EXT_OPTIONS = {
  "--dry-run": { key: "dryRun", boolean: true },
  "--harness": { key: "harness" },
};

// `ext` subcommands the CLI understands.
const EXT_SUBCOMMANDS = ["install", "prune"];

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

  if (command === "ext") {
    const [subcommand, ...extRest] = rest;
    if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
      return { command: "ext", subcommand: null };
    }
    if (!EXT_SUBCOMMANDS.includes(subcommand)) {
      return {
        command: "ext",
        subcommand,
        optionError: `Unknown ext subcommand "${subcommand}". Supported: ${EXT_SUBCOMMANDS.join(", ")}. Run "agent-cortex --help" for usage.`,
      };
    }

    const options = {};
    for (let i = 0; i < extRest.length; i++) {
      const arg = extRest[i];
      // Support both `--harness=pi` and `--harness pi`.
      const inlineValue = arg.startsWith("--harness=") ? arg.slice("--harness=".length) : null;
      const spec = inlineValue !== null ? EXT_OPTIONS["--harness"] : EXT_OPTIONS[arg];
      if (!spec) {
        return { command: "ext", subcommand, optionError: `Unknown option "${arg}". Run "agent-cortex --help" for usage.` };
      }
      if (spec.boolean) {
        options[spec.key] = true;
        continue;
      }
      if (inlineValue !== null) {
        options[spec.key] = inlineValue;
        continue;
      }
      const value = extRest[i + 1];
      if (value == null || value.startsWith("--")) {
        return { command: "ext", subcommand, optionError: `Missing value for "${arg}". Run "agent-cortex --help" for usage.` };
      }
      options[spec.key] = value;
      i += 1;
    }

    return { command: "ext", subcommand, ...options };
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
                      Options (copilot):
                        --output <dir>   Write the flat *.agent.md files to <dir>
                                         (default: <package root>/agents — the dir
                                         plugin.json "agents" scans)
                        --dry-run        Print what would be generated without writing
                      Options (pi):
                        --dry-run             Show what would be installed without writing
                        --output <dir>        Install into <dir> — agents/, skills/,
                                              settings.json (merged, packages managed)
                                              and keybindings.json (default: ~/.pi/agent)
                        --plugin-root <dir>   Override the plugin root used for {{PATH:...}}
                                              tokens (default: token-map.json's pi value)
  ext install         Install the third-party extensions declared in the
                      committed per-harness manifest
                      Options:
                        --harness <name>  Harness to install for (required).
                                          Supported: ${EXT_HARNESSES.join(", ")}
                        --dry-run         Print the install plan without
                                          installing anything
  ext prune           List the extensions installed in the harness's LOCAL
                      store and uninstall the ones you pick. The committed
                      manifest is never modified — dropping an extension from
                      it stays a manual edit + commit
                      Options:
                        --harness <name>  Harness to prune for (default: pi).
                                          Supported: ${EXT_HARNESSES.join(", ")}
                        --dry-run         List the installed extensions without
                                          offering to uninstall them
  --help, -h          Show this help text`;
}

export function validateExtHarness(harness) {
  if (harness == null) {
    return { ok: false, error: `Missing --harness argument. Supported harnesses: ${EXT_HARNESSES.join(", ")}` };
  }
  if (!EXT_HARNESSES.includes(harness)) {
    return { ok: false, error: `Unknown harness "${harness}". Supported harnesses: ${EXT_HARNESSES.join(", ")}` };
  }
  return { ok: true };
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

export { SUPPORTED_HARNESSES, EXT_HARNESSES };