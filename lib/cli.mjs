import { basename } from "node:path";

/**
 * Result of parsing the CLI argv. Every branch returns `command`; the rest are
 * populated only for the commands that accept them.
 * @typedef {object} ParsedArgs
 * @property {"help" | "version" | "install" | "update" | "uninstall" | "self-update" | "migrate" | "scope" | "unknown"} command
 * @property {boolean} [report] `version` subcommand: report installed harnesses too
 * @property {boolean} [json] `version --json`: print the report as JSON
 * @property {boolean} [check] `self-update --check`: report and stop
 * @property {string | null} [harness]
 * @property {string[]} [harnesses] `update`/`uninstall`: the harnesses named on the command line
 * @property {boolean} [all] `update -a, --all`: every harness that is not at the CLI version;
 *                           `uninstall -a, --all`: every installed harness
 * @property {boolean} [force] `update -f, --force`: re-run every installer regardless of version
 * @property {string} [name]
 * @property {string} [optionError]
 * @property {boolean} [dryRun]
 * @property {string} [output]
 * @property {string} [pluginRoot]
 * @property {boolean} [requireRegister]
 * @property {boolean} [apply]
 * @property {string} [dir]
 * @property {"add" | "list"} [scopeCommand]
 * @property {string} [scopePath] `scope add --path <dir>`
 * @property {string} [scopeName] `scope add --name <n>`
 * @property {string} [scopeKind] `scope add --kind code|personal|ops`
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

// Options accepted by `scope add`. `scope list` takes none, so any option there
// is a typo rather than a silently ignored flag.
/** @type {Record<string, string>} */
const SCOPE_ADD_OPTIONS = {
  "--path": "scopePath",
  "--name": "scopeName",
  "--kind": "scopeKind",
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

  if (command === "update") {
    // `update <harness>...` refreshes exactly those harnesses; `-a` refreshes
    // every harness that is not at the CLI version and `-f` forces a re-run.
    // `-f` alone has no meaning, so it is rejected rather than ignored.
    /** @type {string[]} */
    const harnesses = [];
    let all = false;
    let force = false;
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") return { command: "help" };
      if (arg === "-a" || arg === "--all") {
        all = true;
        continue;
      }
      if (arg === "-f" || arg === "--force") {
        force = true;
        continue;
      }
      if (arg.startsWith("-")) {
        return { command: "update", optionError: `Unknown option "${arg}". Run "${programName} --help" for usage.` };
      }
      harnesses.push(arg);
    }
    if (force && !all) {
      return { command: "update", optionError: `"--force" requires "--all". Run "${programName} --help" for usage.` };
    }
    return { command: "update", harnesses, all, force };
  }

  if (command === "uninstall") {
    // `uninstall <harness>...` removes exactly those installs; `--all` removes
    // every installed harness and is the explicit opt-in when no terminal is
    // there to confirm. A name beside `--all` contradicts itself, so it is
    // rejected rather than silently resolved.
    /** @type {string[]} */
    const harnesses = [];
    let all = false;
    let dryRun = false;
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") return { command: "help" };
      if (arg === "-a" || arg === "--all") {
        all = true;
        continue;
      }
      if (arg === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (arg.startsWith("-")) {
        return { command: "uninstall", optionError: `Unknown option "${arg}". Run "${programName} --help" for usage.` };
      }
      harnesses.push(arg);
    }
    if (all && harnesses.length > 0) {
      return {
        command: "uninstall",
        optionError: `"--all" removes every installed harness and cannot be combined with a harness name. Run "${programName} --help" for usage.`,
      };
    }
    return { command: "uninstall", harnesses, all, dryRun };
  }

  if (command === "self-update") {
    // A bare run acts; `--check` reports and stops. Nothing else is accepted,
    // so a typo fails before the CLI touches the global install.
    let check = false;
    for (const arg of rest) {
      if (arg === "--help" || arg === "-h") return { command: "help" };
      if (arg === "--check") {
        check = true;
        continue;
      }
      return { command: "self-update", optionError: `Unknown option "${arg}". Run "${programName} --help" for usage.` };
    }
    return { command: "self-update", check };
  }

  if (command === "scope") {
    const [subcommand, ...scopeArgs] = rest;
    if (subcommand === "--help" || subcommand === "-h") return { command: "help" };

    if (subcommand === "add") {
      // `--path` is required: the command registers a workspace the caller names,
      // never the one it happens to run in, so a bare `scope add` cannot register
      // the wrong directory by accident.
      /** @type {Record<string, string>} */
      const options = {};
      for (let i = 0; i < scopeArgs.length; i++) {
        const arg = scopeArgs[i];
        if (arg === "--help" || arg === "-h") return { command: "help" };
        // Support both `--path=<dir>` and `--path <dir>`, like install's `--output`.
        const separator = arg.indexOf("=");
        const flag = separator === -1 ? arg : arg.slice(0, separator);
        const spec = SCOPE_ADD_OPTIONS[flag];
        if (arg.startsWith("--") && spec !== undefined) {
          const inlineValue = separator === -1 ? undefined : arg.slice(separator + 1);
          const value = inlineValue ?? scopeArgs[i + 1];
          if (value == null || value === "" || (inlineValue === undefined && value.startsWith("--"))) {
            return {
              command: "scope",
              scopeCommand: "add",
              optionError: `Missing value for "${flag}". Run "${programName} --help" for usage.`,
            };
          }
          options[spec] = value;
          if (inlineValue === undefined) i += 1;
          continue;
        }
        return {
          command: "scope",
          scopeCommand: "add",
          optionError: `Unknown option "${arg}". Run "${programName} --help" for usage.`,
        };
      }
      if (options.scopePath === undefined) {
        return {
          command: "scope",
          scopeCommand: "add",
          optionError: `Missing "--path <dir>". Run "${programName} --help" for usage.`,
        };
      }
      return { command: "scope", scopeCommand: "add", ...options };
    }

    if (subcommand === "list") {
      for (const arg of scopeArgs) {
        if (arg === "--help" || arg === "-h") return { command: "help" };
        return {
          command: "scope",
          scopeCommand: "list",
          optionError: `Unknown option "${arg}". Run "${programName} --help" for usage.`,
        };
      }
      return { command: "scope", scopeCommand: "list" };
    }

    return {
      command: "scope",
      optionError:
        subcommand === undefined
          ? `Missing scope command: "add" or "list". Run "${programName} --help" for usage.`
          : `Unknown scope command "${subcommand}". Run "${programName} --help" for usage.`,
    };
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
  update [<harness>...] Refresh installed harnesses by re-running their
                      installers. Updating never installs a harness: one that
                      was never installed is reported "not installed" and left
                      alone. Installing is "install <harness>"'s job, so naming
                      an absent harness is an error, not an install.
                      With no argument the command lists every harness with its
                      installed version and the CLI version, then asks which to
                      refresh (a non-interactive shell prints the same table and
                      the flags below, then exits non-zero without blocking).
                      Options:
                        <harness>...    Refresh exactly these installed
                                        harnesses, no prompt
                        -a, --all       Refresh every installed harness that is
                                        not at the CLI version (stale, ahead, or
                                        unknown); never installs one
                        -f, --force     With --all: re-run every installed
                                        harness installer even when the version
                                        already matches
                        --help, -h      Show this help text
  uninstall [<harness>...]
                      Remove a harness install and the registration that goes with
                      it. With no argument the command lists the installed
                      harnesses and asks which to remove; a blank answer
                      cancels and a non-interactive shell prints the same table
                      plus the flags below, then exits non-zero without
                      blocking. A named harness that is not installed is a
                      no-op. Running the command twice is safe: the second run
                      reports "already absent".
                      Options:
                        <harness>...    Remove exactly these harnesses, no prompt
                        -a, --all       Remove every installed harness. Asks for
                                        confirmation on a terminal; unattended it
                                        is the explicit opt-in. It removes harness
                                        installs and their registrations only:
                                        the agent-cortex CLI itself (your package
                                        manager owns that) and the shared
                                        ~/.agent-cortex root, which holds records
                                        that outlive an install (legacy-sweep.json,
                                        scopes.json), stay in place, and the
                                        report says which it left. No
                                        .agent-cortex/worktrees/ directory that a
                                        ralph run created is ever deleted — any it
                                        finds are reported and left
                        --dry-run       Print what would be removed and write
                                        nothing
                        --help, -h      Show this help text
  self-update         Update the globally installed CLI through the manager that
                      owns this install, then refresh the harness installs with
                      the binary the update installed. A bare run acts; --check
                      only reports. The manager is inferred from the running
                      entry point's real path (pnpm's global/<v> or store link,
                      or npm's lib/node_modules), then confirmed by asking that
                      manager to list this package among its globals at the
                      version installed beside the entry point; a manager on
                      PATH is never used in its place. An owner that cannot be
                      inferred prints both managers' install commands and exits
                      1; an inferred manager that does not confirm prints its own
                      command, says nothing was updated, and exits 1. Otherwise
                      it prints the CLI version before and after the install,
                      reading the version now on disk from the prefix the
                      manager wrote to, falling back to the new binary. It then
                      runs that binary's "update -a" with this terminal, so the
                      refresh's own output is visible. That refresh updates the
                      harnesses that are installed and installs nothing, so a
                      self-update never materialises a harness. The refresh is
                      skipped in four cases: --check, a failed update, an
                      install that exits 0 but leaves the version on disk
                      unchanged, and an
                      install already at the published version, which installs
                      nothing and points at "update -a". Otherwise the exit
                      code is the refresh's, except in two cases that exit 1: an
                      install that leaves the version on disk unchanged, and an
                      install whose version neither source reports, where the
                      refresh still runs. A refresh that cannot start prints the
                      error and the command to run by hand, and still exits
                      non-zero.
                      Options:
                        (no option)     Report, update, then refresh harnesses
                        --check         Report the installed and published
                                        versions and stop, writing nothing
  scope add --path <dir> [--name <n>] [--kind code|personal|ops]
                      Register a bd workspace in the user-level scope list
                      (<AGENT_CORTEX_HOME>/scopes.json, default
                      ~/.agent-cortex/scopes.json), or update the entry that
                      already names it. The directory must exist and must
                      carry its own .beads: one that does not is refused,
                      because bd would read the enclosing workspace's beads
                      and tag them with the wrong scope. The current
                      workspace is kept in the written list as the default
                      "code" scope, so adding a scope never drops a
                      repository out of the queue. Every other entry and
                      every unknown key in the file survives. Options:
                        --path <dir>    The workspace to register (required)
                        --name <n>      The scope name; default: the
                                        directory's own name
                        --kind <kind>   code (default), personal or ops
  scope list          Print every resolved scope with its kind, read-only
                      flag and availability, from the list a run in this
                      directory would read (a repository's own
                      .agent-cortex/scopes.json first, then the user list,
                      then the current workspace alone)
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