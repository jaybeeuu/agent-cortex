// `ctx self-update`: bring the globally installed CLI up to date through the
// manager that actually owns this install.
//
// The owning manager is inferred from the running entry point's real path, then
// confirmed by asking that manager to list this package among its global
// installs. Inference alone is a guess: two managers can be installed and only
// one owns this copy, so on a machine whose owner is not the manager on PATH a
// guess updates the wrong store — or fails. An owner that cannot be inferred or
// confirmed is reported, and never replaced by a manager found on PATH.
//
// Every process is spawned with an argv array (`execFile`, `spawn`), never a
// shell string, so a path with a space or a shell metacharacter stays one
// argument.

import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The package this CLI ships in. */
export const PACKAGE_NAME = "@jaybeeuu/agent-cortex";

/**
 * The bin name this package publishes under its own name. `package.json` maps
 * `agent-cortex`, `cortex` and `ctx` onto the same file, so the canonical name
 * addresses the newly installed copy whatever alias the user typed.
 */
export const BIN_NAME = "agent-cortex";

/**
 * The manager that installed this copy. `pnpm` and `npm` are the two global
 * installation layouts the inference below recognises.
 * @typedef {"pnpm" | "npm"} Manager
 */

/**
 * The argv each manager needs: list the global installs (confirmation), read
 * the published version, and install the latest release.
 * @typedef {object} ManagerCommands
 * @property {string[]} list
 * @property {string[]} view
 * @property {string[]} install
 */

/** @type {Record<Manager, ManagerCommands>} */
const MANAGER_COMMANDS = {
  pnpm: {
    list: ["ls", "-g", "--depth", "0", "--json"],
    view: ["view", PACKAGE_NAME, "version"],
    install: ["add", "-g", `${PACKAGE_NAME}@latest`],
  },
  npm: {
    list: ["ls", "-g", "--depth", "0", "--json"],
    view: ["view", PACKAGE_NAME, "version"],
    install: ["install", "-g", `${PACKAGE_NAME}@latest`],
  },
};

/**
 * The manager that owns an install, with the binary to spawn.
 * @typedef {object} Owner
 * @property {Manager} manager
 * @property {string} prefix The manager's global prefix — the pnpm home, or the node prefix
 * @property {string} command The manager binary inside that prefix
 */

/**
 * Result of one spawned command.
 * @typedef {object} RunResult
 * @property {number} code The exit code, or 1 when the process could not run
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * Spawn a command with an argv array and collect its output. Injected so a test
 * can drive the manager without installing anything globally.
 * @typedef {(command: string, args: string[]) => Promise<RunResult>} Run
 */

/**
 * The outcome of handing the terminal to a child process.
 * @typedef {object} SpawnResult
 * @property {number} code The child's exit code, or 1 when it never ran
 * @property {string} [error] Why the child could not be started at all
 */

/**
 * Spawn a command with the caller's stdio and resolve its exit code. Injected
 * for the same reason as `Run`.
 * @typedef {(command: string, args: string[]) => Promise<SpawnResult>} Spawn
 */

/** @type {(text: string) => void} */
const writeLine = (text) => {
  process.stdout.write(`${text}\n`);
};

/** @type {(text: string) => void} */
const writeErrorLine = (text) => {
  process.stderr.write(`${text}\n`);
};

// pnpm keeps a versioned home: `global/<v>` holds the install tree the bin shim
// points at, and `store/<v>` holds the content-addressed copy that tree links
// into. Resolving the entry point's real path can land in either.
const PNPM_MARKERS = new Set(["global", "store"]);
const VERSIONED = /^v?\d+$/;

/**
 * Split a path on either separator while remembering whether it was absolute,
 * so a prefix is rebuilt with the shape it arrived with: a POSIX absolute path
 * stays absolute, and a Windows path keeps its drive segment.
 * @param {string} path
 * @returns {{ segments: string[], prefixOf: (index: number) => string }}
 */
function splitPath(path) {
  const unified = path.replace(/\\/g, "/");
  const segments = unified.split("/").filter((segment) => segment !== "");
  const absolute = unified.startsWith("/");
  /**
   * @param {number} index
   * @returns {string} The path up to (not including) segment `index`
   */
  const prefixOf = (index) => {
    const head = segments.slice(0, index).join("/");
    return absolute ? `/${head}` : head;
  };
  return { segments, prefixOf };
}

/**
 * @param {Manager} manager
 * @param {string} prefix
 * @returns {Owner}
 */
function ownerOf(manager, prefix) {
  return { manager, prefix, command: `${prefix}/bin/${manager}` };
}

/**
 * Infer the owning manager from the running entry point's real path. The two
 * recognised layouts are the ones the supported managers create:
 *
 * - pnpm: `<prefix>/global/<v>/<hash>/node_modules/<package>/...` for the path
 *   the bin shim execs, and `<prefix>/store/<v>/links/<package>/<version>/
 *   <hash>/node_modules/<package>/...` once the global tree's link is resolved;
 * - npm: `<prefix>/lib/node_modules/<package>/...`.
 *
 * Anything else — a checkout, a locally linked install, a manager with another
 * layout — returns null. The caller reports that instead of guessing, because a
 * wrong guess updates a manager that does not own this copy.
 * @param {string} entryPoint The resolved real path of the running CLI script
 * @returns {Owner | null}
 */
export function inferOwner(entryPoint) {
  const { segments, prefixOf } = splitPath(entryPoint);
  const modules = segments.indexOf("node_modules");
  // The package must sit under node_modules, and a global prefix in front of it.
  if (modules <= 1) return null;

  if (segments[modules - 1] === "lib") {
    const prefix = prefixOf(modules - 1);
    return prefix === "" || prefix === "/" ? null : ownerOf("npm", prefix);
  }

  for (let index = modules - 1; index > 0; index--) {
    if (!PNPM_MARKERS.has(segments[index])) continue;
    // A marker segment that is not followed by a version is not a pnpm home.
    if (!VERSIONED.test(segments[index + 1] ?? "")) break;
    const prefix = prefixOf(index);
    return prefix === "" || prefix === "/" ? null : ownerOf("pnpm", prefix);
  }
  return null;
}

/**
 * Read the version a global install is at, from the manifest beside the entry
 * point, so a stale process still reports what is on disk. Throws when the
 * manifest is missing, unreadable, or carries no version.
 * @param {string} manifestPath
 * @returns {Promise<string>}
 */
export async function readInstalledVersion(manifestPath) {
  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(`Cannot read the installed version from ${manifestPath}: ${/** @type {Error} */ (err).message}`);
  }
  const version = /** @type {{ version?: unknown }} */ (manifest).version;
  if (typeof version !== "string" || version === "") {
    throw new Error(`Cannot read the installed version from ${manifestPath}: the manifest has no "version" string.`);
  }
  return version;
}

/**
 * Parse `<manager> ls -g --depth 0 --json` into package name → installed
 * version. pnpm prints an array of install trees; npm prints an object keyed by
 * global prefix, with the dependencies inside each value.
 * @param {string} stdout
 * @returns {Record<string, string>}
 */
export function parseGlobalListing(stdout) {
  /** @type {unknown} */
  const parsed = JSON.parse(stdout);
  /** @type {Record<string, string>} */
  const versions = {};
  /**
   * @param {unknown} tree
   * @returns {void}
   */
  const collect = (tree) => {
    if (tree === null || typeof tree !== "object") return;
    const dependencies = /** @type {{ dependencies?: unknown }} */ (tree).dependencies;
    if (dependencies === null || typeof dependencies !== "object") return;
    for (const [name, entry] of Object.entries(dependencies)) {
      if (name in versions || entry === null || typeof entry !== "object") continue;
      const version = /** @type {{ version?: unknown }} */ (entry).version;
      if (typeof version === "string") versions[name] = version;
    }
  };
  collect(parsed);
  if (Array.isArray(parsed)) {
    for (const tree of parsed) collect(tree);
  } else if (parsed !== null && typeof parsed === "object") {
    for (const tree of Object.values(parsed)) collect(tree);
  }
  return versions;
}

/**
 * The outcome of asking the inferred manager to list its global installs.
 * @typedef {object} Confirmation
 * @property {boolean} ok
 * @property {string} [reason] Why the owner is unconfirmed
 */

/**
 * Confirm the inferred manager owns this copy: its own global listing must carry
 * this package at the version installed beside the entry point. Two managers can
 * be installed, so the listing is the only evidence that separates the owner
 * from a candidate.
 * @param {object} options
 * @param {Owner} options.owner
 * @param {string} options.installedVersion
 * @param {Run} options.run
 * @returns {Promise<Confirmation>}
 */
export async function confirmOwner({ owner, installedVersion, run }) {
  const args = MANAGER_COMMANDS[owner.manager].list;
  const result = await run(owner.command, args);
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim() || "no output").split("\n")[0];
    return { ok: false, reason: `"${display(owner.command, args)}" exited ${result.code}: ${detail}` };
  }
  /** @type {Record<string, string>} */
  let versions;
  try {
    versions = parseGlobalListing(result.stdout);
  } catch (err) {
    return { ok: false, reason: `"${display(owner.command, args)}" printed output that is not JSON: ${/** @type {Error} */ (err).message}` };
  }
  const listed = versions[PACKAGE_NAME];
  if (listed === undefined) {
    return { ok: false, reason: `"${display(owner.command, args)}" does not list ${PACKAGE_NAME} among its global packages.` };
  }
  if (listed !== installedVersion) {
    return {
      ok: false,
      reason: `"${display(owner.command, args)}" lists ${PACKAGE_NAME} at ${listed}, but this copy is ${installedVersion}.`,
    };
  }
  return { ok: true };
}

/**
 * Read the published version through the confirmed manager's own `view`
 * command, so the answer comes from the registry that manager installs from.
 * @param {object} options
 * @param {Owner} options.owner
 * @param {Run} options.run
 * @returns {Promise<string>}
 */
export async function readPublishedVersion({ owner, run }) {
  const args = MANAGER_COMMANDS[owner.manager].view;
  const result = await run(owner.command, args);
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim() || "no output").split("\n")[0];
    throw new Error(`"${display(owner.command, args)}" exited ${result.code}: ${detail}`);
  }
  // A `view` that succeeded always prints the version; anything else means the
  // registry answer cannot be trusted, so an update is not offered.
  const published = lastLine(result.stdout);
  if (published === "") {
    throw new Error(`"${display(owner.command, args)}" printed no version.`);
  }
  return published;
}

/**
 * The version a command printed last, ignoring blank lines. A manager that
 * prints a banner or a warning before its answer still yields the answer.
 * @param {string} text
 * @returns {string}
 */
function lastLine(text) {
  return text.trim().split("\n").filter((line) => line !== "").pop() ?? "";
}

/**
 * Read the version the binary the update just installed reports. The running
 * process is the old code and its manifest is the old manifest, so the new
 * binary is the only source for the version that is now on disk.
 * @param {object} options
 * @param {string} options.bin The installed binary the refresh will run
 * @param {Run} options.run
 * @returns {Promise<string | null>} The version, or null when the probe answers nothing usable
 */
export async function probeBinaryVersion({ bin, run }) {
  const args = ["--version"];
  const result = await run(bin, args);
  if (result.code !== 0) return null;
  const version = lastLine(result.stdout);
  return version === "" ? null : version;
}

/**
 * Render one command for a human. Display only: nothing here is ever executed,
 * every spawn receives the argv array itself.
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
export function display(command, args) {
  return [command, ...args].join(" ");
}

/**
 * Render the report a `--check` run prints and a bare run prints before it acts.
 * @param {object} options
 * @param {string} options.programName The command name the user typed
 * @param {string} options.installedVersion
 * @param {string} options.publishedVersion
 * @param {Owner} options.owner
 * @param {boolean} [options.check]
 * @returns {string} Text without a trailing newline
 */
export function formatSelfUpdateReport({ programName, installedVersion, publishedVersion, owner, check = false }) {
  const status =
    installedVersion === publishedVersion
      ? "current"
      : `update available: ${installedVersion} → ${publishedVersion}`;
  const lines = [
    `${programName} self-update`,
    `  installed  ${installedVersion}`,
    `  published  ${publishedVersion}`,
    `  owner      ${owner.manager} (${owner.command})`,
    `  status     ${status}`,
    `  command    ${display(owner.command, MANAGER_COMMANDS[owner.manager].install)}`,
  ];
  if (check) lines.push("", "Check only — nothing was updated.");
  return lines.join("\n");
}

/**
 * The message for an entry point that is in neither recognised layout. Both
 * commands are printed: the CLI cannot know which one owns the copy, and the
 * user can.
 * @param {object} options
 * @param {string} options.entryPoint
 * @returns {string} Text without a trailing newline
 */
export function formatUnknownOwner({ entryPoint }) {
  /** @type {Manager[]} */
  const managers = ["pnpm", "npm"];
  return [
    "Cannot identify the package manager that owns this install.",
    `  This copy runs from ${entryPoint}, which is not a pnpm or npm global layout.`,
    "  Update it with the manager that installed it:",
    ...managers.map((manager) => `    ${display(manager, MANAGER_COMMANDS[manager].install)}`),
  ].join("\n");
}

/**
 * The message for an inferred owner its own listing does not confirm.
 * @param {object} options
 * @param {Owner} options.owner
 * @param {string} options.reason
 * @returns {string} Text without a trailing newline
 */
export function formatUnconfirmedOwner({ owner, reason }) {
  return [
    `Cannot confirm that ${owner.manager} owns this install.`,
    `  ${reason}`,
    "  Nothing was updated. If that manager does own it, run:",
    `    ${display(owner.command, MANAGER_COMMANDS[owner.manager].install)}`,
  ].join("\n");
}

/**
 * Run one command with an argv array and collect its output. A command that
 * cannot be spawned resolves with its error message in `stderr` instead of
 * throwing, so every failure reaches the caller as a reportable result.
 * @type {Run}
 */
export async function execRun(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failure = /** @type {NodeJS.ErrnoException & { stdout?: string, stderr?: string }} */ (err);
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
    };
  }
}

/**
 * Run one command with the caller's stdio and resolve its exit code, so the
 * refreshed CLI's own output reaches the terminal. A command that cannot be
 * started at all resolves with the reason instead of a bare code: a spawn
 * failure the caller cannot name is a failure the user cannot act on.
 * @type {Spawn}
 */
export function spawnInherit(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (err) => resolve({ code: 1, error: err.message }));
    child.on("close", (code) => resolve({ code: code ?? 1 }));
  });
}

/**
 * Everything `self-update` needs to run.
 * @typedef {object} SelfUpdateOptions
 * @property {string} entryPoint Resolved real path of the running CLI script
 * @property {string} programName The command name the user typed
 * @property {boolean} [check] Report and stop, writing nothing
 * @property {Run} [run]
 * @property {Spawn} [spawn]
 * @property {(text: string) => void} [write] Stdout sink
 * @property {(text: string) => void} [writeError] Stderr sink
 */

/**
 * Report the install's versions and, unless it is told to stop, update it
 * through the confirmed owner and re-run the new binary's harness update.
 *
 * The order is the guarantee: nothing is spawned that writes until the owner is
 * confirmed and the published version is readable, and the re-run only happens
 * once the install has succeeded. Every failure path returns non-zero having
 * printed what failed and what to run instead. The re-run is skipped in three
 * cases — `check`, a failed install, and an install already at the published
 * version — and otherwise its exit code is this command's exit code.
 * @param {SelfUpdateOptions} options
 * @returns {Promise<number>} The exit code
 */
export async function runSelfUpdate({
  entryPoint,
  programName,
  check = false,
  run = execRun,
  spawn: spawnCommand = spawnInherit,
  write = writeLine,
  writeError = writeErrorLine,
}) {
  const manifestPath = join(dirname(entryPoint), "..", "package.json");
  /** @type {string} */
  let installedVersion;
  try {
    installedVersion = await readInstalledVersion(manifestPath);
  } catch (err) {
    writeError(`${/** @type {Error} */ (err).message}`);
    return 1;
  }

  const owner = inferOwner(entryPoint);
  if (owner === null) {
    writeError(formatUnknownOwner({ entryPoint }));
    return 1;
  }

  const confirmation = await confirmOwner({ owner, installedVersion, run });
  if (!confirmation.ok) {
    writeError(formatUnconfirmedOwner({ owner, reason: confirmation.reason ?? "the owner did not list this package." }));
    return 1;
  }

  /** @type {string} */
  let publishedVersion;
  try {
    publishedVersion = await readPublishedVersion({ owner, run });
  } catch (err) {
    // A registry error is its own failure: the installed copy is not known to be
    // out of date, so no update is offered and none is run.
    writeError(`Cannot read the published version of ${PACKAGE_NAME}.\n  ${/** @type {Error} */ (err).message}\n  Nothing was updated.`);
    return 1;
  }

  write(formatSelfUpdateReport({ programName, installedVersion, publishedVersion, owner, check }));
  if (check) return 0;

  // Already at the published version: there is nothing to install, and a
  // re-exec would hand over to the same version. The harness installs are still
  // refreshed on demand by `update -a`.
  if (installedVersion === publishedVersion) {
    write(`  ✓ ${PACKAGE_NAME} is already at ${publishedVersion}; nothing was installed.`);
    write(`  → refresh the harness installs with "${programName} update -a"`);
    return 0;
  }

  const installArgs = MANAGER_COMMANDS[owner.manager].install;
  const update = await run(owner.command, installArgs);
  if (update.code !== 0) {
    const detail = update.stderr.trim() || update.stdout.trim() || "no output";
    writeError(
      `The update failed: "${display(owner.command, installArgs)}" exited ${update.code}.\n  ${detail.split("\n").join("\n  ")}\nNothing was run after it.`,
    );
    return 1;
  }
  write(`  ✓ ${display(owner.command, installArgs)}`);

  // The running process is the old code, so the version now on disk comes from
  // the new binary, and the harness installs are refreshed by it.
  const bin = `${owner.prefix}/bin/${BIN_NAME}`;
  const refreshed = await probeBinaryVersion({ bin, run });
  if (refreshed === null) {
    writeError(
      `Cannot read the version the newly installed binary reports: "${display(bin, ["--version"])}" printed nothing usable.\n  The refresh below is unaffected.`,
    );
  } else {
    write(`  cli        ${installedVersion} → ${refreshed}`);
  }

  const refreshArgs = ["update", "-a"];
  write(`  → refreshing installed harnesses with ${display(bin, refreshArgs)}`);
  const refresh = await spawnCommand(bin, refreshArgs);
  if (refresh.error !== undefined) {
    // The install succeeded, so the refresh is a separate, repeatable step the
    // user can finish by hand. It must not look like a silent success.
    writeError(
      `Cannot run ${display(bin, refreshArgs)}: ${refresh.error}\n  The CLI was updated; the harness installs were not refreshed.\n  Run it yourself:\n    ${display(bin, refreshArgs)}`,
    );
  }
  return refresh.code;
}
