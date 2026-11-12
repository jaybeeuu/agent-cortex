import { basename } from "node:path";

/**
 * Result of parsing the CLI argv. Every branch returns `command`; the rest are
 * populated only for the commands that accept them.
 * @typedef {object} ParsedArgs
 * @property {"help" | "version" | "install" | "migrate" | "unknown"} command
 * @property {boolean} [report] `version` subcommand: report installed harnesses too
 * @property {boolean} [json] `version --json`: print the report as JSON
 * @property {string | null} [harness]
 * @property {string} [name]
 * @property {string} [optionError]
 * @property {boolean} [dryRun]
 * @property {string} [output]
 * @property {string} [pluginRoot]
 * @property {boolean} [requireRegister]
 * @property {boolean} [apply]
 * @property {string} [dir]
 */

/** @typedef {{ key: string, boolean?: boolean }} OptionSpec */

const SUPPORTED_HARNESSES = ["claude", "pi"];

// The published bin names. `package.json` maps all three onto bin/agent-cortex.mjs,
// so the help and error text names whichever shim the user typed.
const PROGRAM_NAMES = ["agent-cortex", "cortex", "ctx"];
const DEFAULT_PROGRAM_NAME = "agent-cortex";

/**
 * Resolve the program name to print from the path the CLI was invoked as. Only
 * the published command names are recognised; anything else (a bare `node
 * bin/agent-cortex.mjs`, a renamed copy) falls back to `agent-cortex`, so the
 * text always names a command that exists.
 * @param {string | undefined} invokedPath `process.argv[1]`, or a bare name in tests
 * @returns {string}
 */
export function resolveProgramName(invokedPath) {
  const name = basename(invokedPath ?? "");
  return PROGRAM_NAMES.includes(name) ? name : DEFAULT_PROGRAM_NAME;
}

// Options accepted by `install <harness>`. `--output`/`--dry-run` are shared by
// the claude and pi installers; `--plugin-root` is pi-specific. Unknown or
// malformed options surface as `optionError` on the parsed result; the CLI
// prints them and exits 1.
/** @type {Record<string, OptionSpec>} */
const INSTALL_OPTIONS = {
  "--dry-run": { key: "dryRun", boolean: true },
  "--output": { key: "output" },
  "--plugin-root": { key: "pluginRoot" },
  "--require-register": { key: "requireRegister", boolean: true },
};

/**
 * Parse the CLI argv.
 * @param {string[]} argv
 * @param {string} [programName] The resolved command name, for usage hints
 * @returns {ParsedArgs}
 */
export function parseArgs(argv, programName = DEFAULT_PROGRAM_NAME) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help" };
  }

  // Like `--help`, the version flags are only recognised as the first argument,
  // so they never shadow a command's own options.
  if (argv[0] === "--version" || argv[0] === "-V") {
    return { command: "version" };
  }

  const [command, ...rest] = argv;

  if (command === "version") {
    // The `version` subcommand reports the installed harness versions; the
    // `--version` flag above stays a bare CLI version for scripts.
    let json = false;
    for (const arg of rest) {
      if (arg === "--json") {
        json = true;
        continue;
      }
      return { command: "version", report: true, optionError: `Unknown option "${arg}". Run "${programName} --help" for usage.` };
    }
    return json ? { command: "version", report: true, json } : { command: "version", report: true };
  }

  if (command === "install") {
    let harness = null;
    let i = 0;
    if (rest.length > 0 && !rest[0].startsWith("--")) {
      harness = rest[0];
      i = 1;
    }

    /** @type {Record<string, string | true>} */
    const options = {};
    for (; i < rest.length; i++) {
      const arg = rest[i];
      // Support both `--output=<dir>` and `--output <dir>`.
      const inlineValue = arg.startsWith("--output=") ? arg.slice("--output=".length) : null;
      const spec = inlineValue !== null ? INSTALL_OPTIONS["--output"] : INSTALL_OPTIONS[arg];
      if (!spec) {
        return { command: "install", harness, optionError: `Unknown option "${arg}". Run "${programName} --help" for usage.` };
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
        return { command: "install", harness, optionError: `Missing value for "${arg}". Run "${programName} --help" for usage.` };
      }
      options[spec.key] = value;
      i += 1;
    }

    if (Object.keys(options).length === 0) {
      return { command: "install", harness };
    }
    return { command: "install", harness, ...options };
  }

  if (command === "migrate") {
    // Dry run is the default, so `--apply` is the only state-changing flag;
    // `--dry-run` stays accepted for scripts that pass it explicitly. `--dir`
    // points the ideas step at a workspace that keeps its idea files elsewhere.
    let sawApply = false;
    let sawDryRun = false;
    /** @type {string | undefined} */
    let dir;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--help" || arg === "-h") return { command: "help" };
      if (arg === "--apply") {
        sawApply = true;
        continue;
      }
      if (arg === "--dry-run") {
        sawDryRun = true;
        continue;
      }
      // Support both `--dir=<path>` and `--dir <path>`, like install's `--output`.
      const inlineDir = arg.startsWith("--dir=") ? arg.slice("--dir=".length) : null;
      if (inlineDir !== null && inlineDir !== "") {
        dir = inlineDir;
        continue;
      }
      if (arg === "--dir" || inlineDir !== null) {
        const value = rest[i + 1];
        if (inlineDir !== null || value == null || value.startsWith("--")) {
          return { command: "migrate", optionError: `Missing value for "--dir". Run "${programName} --help" for usage.` };
        }
        dir = value;
        i += 1;
        continue;
      }
      return { command: "migrate", optionError: `Unknown option "${arg}". Run "${programName} --help" for usage.` };
    }
    if (sawApply && sawDryRun) {
      return { command: "migrate", optionError: '"--apply" and "--dry-run" are mutually exclusive.' };
    }
    return dir === undefined ? { command: "migrate", apply: sawApply } : { command: "migrate", apply: sawApply, dir };
  }

  return { command: "unknown", name: command };
}

/**
 * @param {string} [programName] The resolved command name, for the usage line
 * @returns {string}
 */
export function buildHelpText(programName = DEFAULT_PROGRAM_NAME) {
  return `Usage: ${programName} <command> [options]

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
  migrate             Migrate the current beads workspace to the latest
                      agent-cortex migration version, applying versioned steps
                      in order (repo-agnostic — works in any beads workspace)
                      Options:
                        (no option)     Dry run — print the pending plan, write nothing
                        --apply         Apply every pending step, verifying each
                        --dir <path>    Read idea files from <path> instead of
                                        docs/ideas (step v2's source)
  version             Print the running CLI version, then one line per installed
                      harness: its name, the version its installer recorded, and
                      a marker comparing the two — current, stale, ahead (the
                      installed copy is newer), or unknown (no readable
                      fingerprint). Read-only: no install, no network, no writes.
                      Options:
                        --json          Print the same data as JSON records
  --help, -h          Show this help text
  --version, -V       Print the package version`;
}

/**
 * @param {string | null | undefined} harness
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateHarness(harness) {
  if (harness === null || harness === undefined) {
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