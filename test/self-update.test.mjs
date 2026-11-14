// `ctx self-update`: owner detection, the version report, and the update.
//
// The layouts, package names and versions here are synthetic — a fabricated
// global prefix with a copy of this CLI inside it, and a fake manager that only
// records its argv. Nothing in this file asserts a fact about the machine it
// runs on: detection must work on a machine that has neither of these managers,
// and this repo's own facts belong in the bead, not in a shipped test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PACKAGE_NAME,
  confirmOwner,
  inferOwner,
  parseGlobalListing,
  readPublishedVersion,
  runSelfUpdate,
} from "../lib/self-update.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const tempRoot = createTempRoot("agent-cortex-self-update-");
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const REPO_CLI = join(REPO_ROOT, "bin", "agent-cortex.mjs");

// A stateful fake manager. A child process is the only way to observe the argv
// the CLI really spawns, and the node:child_process surface the repo lints for
// (*Sync) is avoided here as everywhere else in test/.
const FAKE_MANAGER = `#!/usr/bin/env node
(async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const argv = process.argv.slice(2);
  const name = path.basename(process.argv[1]);
  await fs.appendFile(process.env.FAKE_CALLS, name + " " + argv.join(" ") + "\\n");
  const print = (text) => process.stdout.write(text + "\\n");
  const fail = (text) => {
    process.stderr.write(text + "\\n");
    process.exitCode = 1;
  };
  if (argv[0] === "ls") {
    if (process.env.FAKE_LIST_FAIL) return fail(process.env.FAKE_LIST_FAIL);
    print(process.env.FAKE_LIST);
    return;
  }
  if (argv[0] === "view") {
    if (process.env.FAKE_VIEW_FAIL) return fail(process.env.FAKE_VIEW_FAIL);
    print(process.env.FAKE_VIEW);
    return;
  }
  if (argv[0] === "add" || argv[0] === "install") {
    if (process.env.FAKE_INSTALL_FAIL) return fail(process.env.FAKE_INSTALL_FAIL);
    print("installed");
    return;
  }
  return fail("unexpected argv: " + argv.join(" "));
})();
`;

// The binary the update re-runs once the install succeeded.
const FAKE_REEXEC = `#!/usr/bin/env node
(async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  await fs.appendFile(process.env.FAKE_CALLS, path.basename(process.argv[1]) + " " + process.argv.slice(2).join(" ") + "\\n");
})();
`;

/**
 * Write a executable script.
 * @param {string} path
 * @param {string} content
 * @returns {Promise<void>}
 */
async function writeExecutable(path, content) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

/**
 * The directory a manager installs this package into, under its global prefix.
 * @param {"pnpm" | "npm"} manager
 * @param {string} prefix
 * @returns {string}
 */
function packageRootOf(manager, prefix) {
  return manager === "pnpm"
    ? join(prefix, "global", "v11", "0123-18e4f7d14ab4ce20-0", "node_modules", "@jaybeeuu", "agent-cortex")
    : join(prefix, "lib", "node_modules", "@jaybeeuu", "agent-cortex");
}

/**
 * A package manifest in the layout a manager creates. No CLI copy: enough for
 * the report, which reads the version from this manifest.
 * @param {{"manager": "pnpm" | "npm", "version": string}} options
 * @returns {Promise<{ prefix: string, entryPoint: string }>}
 */
async function stageManifest({ manager, version }) {
  const workspace = await tempRoot.createWorkspace();
  const prefix = join(workspace, `${manager}-home`);
  const packageRoot = packageRootOf(manager, prefix);
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await writeFile(join(packageRoot, "bin", "agent-cortex.mjs"), "#!/usr/bin/env node\n");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }, null, 2));
  return { prefix, entryPoint: join(packageRoot, "bin", "agent-cortex.mjs") };
}

const UNIT_PNPM = await stageManifest({ manager: "pnpm", version: "1.4.0" });
const UNIT_NPM = await stageManifest({ manager: "npm", version: "1.4.0" });

/**
 * Materialise a copy of this CLI inside the global layout a manager creates, so
 * the running entry point is the thing detection reads. The version is
 * synthetic: the point is that the report reads it from the manifest beside the
 * entry point, not from any running process.
 * @param {{ manager: "pnpm" | "npm", version: string, workspace: string }} options
 * @returns {Promise<{ prefix: string, entryPoint: string, calls: string }>}
 */
async function stageInstall({ manager, version, workspace }) {
  const prefix = join(workspace, `${manager}-home`);
  const packageRoot = packageRootOf(manager, prefix);
  await mkdir(packageRoot, { recursive: true });
  // The CLI's static imports reach these three directories; copying them keeps
  // the staged entry point a working copy of the real one.
  for (const dir of ["bin", "lib", "scripts"]) {
    await cp(join(REPO_ROOT, dir), join(packageRoot, dir), { recursive: true });
  }
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: PACKAGE_NAME, version, bin: { "agent-cortex": "./bin/agent-cortex.mjs" } }, null, 2),
  );
  const calls = join(workspace, "calls.log");
  const binDir = join(prefix, "bin");
  await mkdir(binDir, { recursive: true });
  await writeExecutable(join(binDir, manager), FAKE_MANAGER);
  await writeExecutable(join(binDir, "agent-cortex"), FAKE_REEXEC);
  return { prefix, entryPoint: join(packageRoot, "bin", "agent-cortex.mjs"), calls };
}

/**
 * A directory of decoy managers to put on PATH. Every decoy records its use, so
 * a test can prove the CLI never fell back to a manager found on PATH.
 * @param {string} workspace
 * @returns {Promise<{ pathDir: string, used: string }>}
 */
async function stageDecoys(workspace) {
  const pathDir = join(workspace, "decoy-bin");
  const used = join(workspace, "path-used.log");
  await mkdir(pathDir, { recursive: true });
  for (const manager of ["pnpm", "npm"]) {
    await writeExecutable(
      join(pathDir, manager),
      `#!/usr/bin/env node
(async () => {
  const fs = require("node:fs/promises");
  await fs.appendFile(${JSON.stringify(used)}, ${JSON.stringify(manager)} + " " + process.argv.slice(2).join(" ") + "\\n");
  process.exitCode = 99;
})();
`,
    );
  }
  return { pathDir, used };
}

/**
 * Run one CLI invocation.
 * @param {string} cli
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
function runCli(cli, args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

/**
 * The manager calls a run recorded, one per line.
 * @param {string} calls
 * @returns {Promise<string[]>}
 */
async function readCalls(calls) {
  const text = await readFile(calls, "utf-8");
  return text.split("\n").filter((line) => line !== "");
}

/**
 * Assert a decoy manager on PATH was never executed.
 * @param {string} used
 * @returns {Promise<void>}
 */
async function assertPathUnused(used) {
  await assert.rejects(readFile(used, "utf-8"), "a manager on PATH was used");
}

/**
 * A pnpm `ls -g --depth 0 --json` listing carrying this package at `version`.
 * @param {string} version
 * @returns {string}
 */
function pnpmListing(version) {
  return JSON.stringify([
    {
      path: "/opt/pnpm-home/global/v11",
      private: true,
      dependencies: { [PACKAGE_NAME]: { from: PACKAGE_NAME, version } },
    },
  ]);
}

/**
 * An npm `ls -g --depth 0 --json` listing, which is keyed by global prefix.
 * @param {string} version
 * @returns {string}
 */
function npmListing(version) {
  return JSON.stringify({ "/opt/node/lib": { dependencies: { [PACKAGE_NAME]: { version } } } });
}

/**
 * A stubbed `run` that records every argv array it is given and answers by the
 * command word.
 * @param {{ list?: { code?: number, stdout?: string, stderr?: string }, view?: { code?: number, stdout?: string, stderr?: string }, install?: { code?: number, stdout?: string, stderr?: string } }} answers
 * @returns {{ run: (command: string, args: string[]) => Promise<{ code: number, stdout: string, stderr: string }>, calls: string[][] }}
 */
function stubRun(answers) {
  /** @type {string[][]} */
  const calls = [];
  return {
    calls,
    run: async (command, args) => {
      calls.push([command, ...args]);
      const word = args[0];
      const answer = word === "ls" ? answers.list : word === "view" ? answers.view : answers.install;
      return { code: answer?.code ?? 0, stdout: answer?.stdout ?? "", stderr: answer?.stderr ?? "" };
    },
  };
}

describe("inferOwner", () => {
  it("reads pnpm's global layout, where the entry point the bin shim execs sits", () => {
    const owner = inferOwner("/opt/pnpm-home/global/v11/3ac8-18e4f7d14ab4ce20-0/node_modules/@jaybeeuu/agent-cortex/bin/agent-cortex.mjs");
    assert.deepEqual(owner, { manager: "pnpm", prefix: "/opt/pnpm-home", command: "/opt/pnpm-home/bin/pnpm" });
  });

  it("reads pnpm's store layout, which the global tree's link resolves into", () => {
    const owner = inferOwner(
      "/opt/pnpm-home/store/v11/links/@jaybeeuu/agent-cortex/1.4.0/abc123/node_modules/@jaybeeuu/agent-cortex/bin/agent-cortex.mjs",
    );
    assert.deepEqual(owner, { manager: "pnpm", prefix: "/opt/pnpm-home", command: "/opt/pnpm-home/bin/pnpm" });
  });

  it("reads npm's lib layout", () => {
    const owner = inferOwner("/opt/node/lib/node_modules/@jaybeeuu/agent-cortex/bin/agent-cortex.mjs");
    assert.deepEqual(owner, { manager: "npm", prefix: "/opt/node", command: "/opt/node/bin/npm" });
  });

  it("keeps a Windows drive prefix intact", () => {
    const owner = inferOwner(
      "C:\\Users\\me\\AppData\\Local\\pnpm\\global\\v11\\abc-18e4f7d14ab4ce20-0\\node_modules\\@jaybeeuu\\agent-cortex\\bin\\agent-cortex.mjs",
    );
    assert.deepEqual(owner, {
      manager: "pnpm",
      prefix: "C:/Users/me/AppData/Local/pnpm",
      command: "C:/Users/me/AppData/Local/pnpm/bin/pnpm",
    });
  });

  it("returns null for a checkout, which no manager owns", () => {
    assert.equal(inferOwner("/home/me/src/agent-cortex/bin/agent-cortex.mjs"), null);
  });

  it("returns null for a path inside a project's node_modules", () => {
    assert.equal(inferOwner("/home/me/src/project/node_modules/@jaybeeuu/agent-cortex/bin/agent-cortex.mjs"), null);
  });

  it("returns null for a relative path", () => {
    assert.equal(inferOwner("bin/agent-cortex.mjs"), null);
  });
});

describe("parseGlobalListing", () => {
  it("reads pnpm's array of install trees", () => {
    const versions = parseGlobalListing(
      JSON.stringify([{ path: "/x", dependencies: { [PACKAGE_NAME]: { version: "1.4.0" } } }]),
    );
    assert.equal(versions[PACKAGE_NAME], "1.4.0");
  });

  it("reads npm's object keyed by global prefix", () => {
    const versions = parseGlobalListing(JSON.stringify({ "/x/lib": { dependencies: { [PACKAGE_NAME]: { version: "2.0.0" } } } }));
    assert.equal(versions[PACKAGE_NAME], "2.0.0");
  });

  it("ignores entries without a version string", () => {
    const versions = parseGlobalListing(JSON.stringify([{ dependencies: { other: { from: "other" } } }]));
    assert.deepEqual(versions, {});
  });
});

describe("confirmOwner", () => {
  const owner = { manager: /** @type {const} */ ("pnpm"), prefix: "/opt/pnpm-home", command: "/opt/pnpm-home/bin/pnpm" };

  it("confirms an owner whose listing carries this package at the installed version", async () => {
    const { run } = stubRun({ list: { stdout: pnpmListing("1.4.0") } });
    assert.deepEqual(await confirmOwner({ owner, installedVersion: "1.4.0", run }), { ok: true });
  });

  it("refuses an owner whose listing omits this package", async () => {
    const { run } = stubRun({ list: { stdout: JSON.stringify([{ dependencies: {} }]) } });
    const result = await confirmOwner({ owner, installedVersion: "1.4.0", run });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /does not list @jaybeeuu\/agent-cortex/);
  });

  it("refuses an owner that lists a different version, which owns another copy", async () => {
    const { run } = stubRun({ list: { stdout: pnpmListing("1.3.0") } });
    const result = await confirmOwner({ owner, installedVersion: "1.4.0", run });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /lists @jaybeeuu\/agent-cortex at 1\.3\.0, but this copy is 1\.4\.0/);
  });

  it("refuses an owner whose listing command fails", async () => {
    const { run } = stubRun({ list: { code: 1, stderr: "ERR_PNPM_NO_GLOBAL_BIN_DIR" } });
    const result = await confirmOwner({ owner, installedVersion: "1.4.0", run });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /exited 1: ERR_PNPM_NO_GLOBAL_BIN_DIR/);
  });

  it("refuses an owner whose listing is not JSON", async () => {
    const { run } = stubRun({ list: { stdout: "not json" } });
    const result = await confirmOwner({ owner, installedVersion: "1.4.0", run });
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /not JSON/);
  });
});

describe("readPublishedVersion", () => {
  const owner = { manager: /** @type {const} */ ("npm"), prefix: "/opt/node", command: "/opt/node/bin/npm" };

  it("reads the version the manager's view prints", async () => {
    const { run } = stubRun({ view: { stdout: "9.9.9\n" } });
    assert.equal(await readPublishedVersion({ owner, run }), "9.9.9");
  });

  it("throws on a registry error", async () => {
    const { run } = stubRun({ view: { code: 1, stderr: "E404 Not Found" } });
    await assert.rejects(readPublishedVersion({ owner, run }), /E404 Not Found/);
  });

  it("throws when view prints no version", async () => {
    const { run } = stubRun({ view: { stdout: "\n" } });
    await assert.rejects(readPublishedVersion({ owner, run }), /printed no version/);
  });
});

describe("runSelfUpdate", () => {
  const entryPoint = UNIT_PNPM.entryPoint;
  const pnpmPrefix = UNIT_PNPM.prefix;

  /**
   * Collect the text a run wrote to each stream.
   * @returns {{ out: string[], err: string[], write: (text: string) => void, writeError: (text: string) => void }}
   */
  function sink() {
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const err = [];
    return {
      out,
      err,
      write: (text) => {
        out.push(text);
      },
      writeError: (text) => {
        err.push(text);
      },
    };
  }

  it("reports both versions and the owner, and spawns nothing else, on --check", async () => {
    const { run, calls } = stubRun({ list: { stdout: pnpmListing("1.4.0") }, view: { stdout: "9.9.9" } });
    const output = sink();
    /** @type {string[][]} */
    const spawned = [];
    const code = await runSelfUpdate({
      entryPoint,
      programName: "ctx",
      check: true,
      run,
      spawn: async (command, args) => {
        spawned.push([command, ...args]);
        return 0;
      },
      write: output.write,
      writeError: output.writeError,
    });
    assert.equal(code, 0);
    assert.deepEqual(calls, [
      [`${pnpmPrefix}/bin/pnpm`, "ls", "-g", "--depth", "0", "--json"],
      [`${pnpmPrefix}/bin/pnpm`, "view", PACKAGE_NAME, "version"],
    ]);
    assert.deepEqual(spawned, []);
    const report = output.out.join("\n");
    assert.match(report, /^ctx self-update$/m);
    assert.match(report, /^ {2}installed {2}1\.4\.0$/m);
    assert.match(report, /^ {2}published {2}9\.9\.9$/m);
    assert.match(report, new RegExp(`^ {2}owner {6}pnpm \\(${pnpmPrefix}/bin/pnpm\\)$`, "m"));
    assert.match(report, new RegExp(`^ {2}command {4}${pnpmPrefix}/bin/pnpm add -g @jaybeeuu/agent-cortex@latest$`, "m"));
    assert.match(report, /Check only/);
    assert.deepEqual(output.err, []);
  });

  it("updates through pnpm with an argv array, then re-runs the new binary", async () => {
    const { run, calls } = stubRun({ list: { stdout: pnpmListing("1.4.0") }, view: { stdout: "9.9.9" }, install: {} });
    const output = sink();
    /** @type {string[][]} */
    const spawned = [];
    const code = await runSelfUpdate({
      entryPoint,
      programName: "agent-cortex",
      run,
      spawn: async (command, args) => {
        spawned.push([command, ...args]);
        return 7;
      },
      write: output.write,
      writeError: output.writeError,
    });
    // The re-run's exit code is the command's exit code.
    assert.equal(code, 7);
    assert.deepEqual(calls[2], [`${pnpmPrefix}/bin/pnpm`, "add", "-g", `${PACKAGE_NAME}@latest`]);
    assert.deepEqual(spawned, [[`${pnpmPrefix}/bin/agent-cortex`, "update", "-a"]]);
    assert.match(output.out.join("\n"), new RegExp(`^ {2}✓ ${pnpmPrefix}/bin/pnpm add -g @jaybeeuu/agent-cortex@latest$`, "m"));
  });

  it("updates through npm with npm's own install invocation", async () => {
    const { run, calls } = stubRun({ list: { stdout: npmListing("1.4.0") }, view: { stdout: "9.9.9" }, install: {} });
    const output = sink();
    const code = await runSelfUpdate({
      entryPoint: UNIT_NPM.entryPoint,
      programName: "ctx",
      run,
      spawn: async () => 0,
      write: output.write,
      writeError: output.writeError,
    });
    assert.equal(code, 0);
    assert.deepEqual(calls[2], [`${UNIT_NPM.prefix}/bin/npm`, "install", "-g", `${PACKAGE_NAME}@latest`]);
  });

  it("reports an unidentified owner, prints both exact commands, and runs nothing", async () => {
    const { run, calls } = stubRun({});
    const output = sink();
    const code = await runSelfUpdate({
      entryPoint: join(REPO_ROOT, "bin", "agent-cortex.mjs"),
      programName: "ctx",
      run,
      spawn: async () => 0,
      write: output.write,
      writeError: output.writeError,
    });
    assert.equal(code, 1);
    assert.deepEqual(calls, []);
    const message = output.err.join("\n");
    assert.match(message, /Cannot identify the package manager that owns this install/);
    assert.match(message, /pnpm add -g @jaybeeuu\/agent-cortex@latest/);
    assert.match(message, /npm install -g @jaybeeuu\/agent-cortex@latest/);
  });

  it("reports an unconfirmed owner with the exact command, and updates nothing", async () => {
    const { run, calls } = stubRun({ list: { stdout: pnpmListing("1.3.0") }, view: { stdout: "9.9.9" } });
    const output = sink();
    const code = await runSelfUpdate({
      entryPoint,
      programName: "ctx",
      run,
      spawn: async () => 0,
      write: output.write,
      writeError: output.writeError,
    });
    assert.equal(code, 1);
    assert.equal(calls.length, 1);
    const message = output.err.join("\n");
    assert.match(message, /Cannot confirm that pnpm owns this install/);
    assert.match(message, new RegExp(`${pnpmPrefix}/bin/pnpm add -g @jaybeeuu/agent-cortex@latest`));
  });

  it("treats a registry error as its own failure, and offers no update", async () => {
    const { run, calls } = stubRun({ list: { stdout: pnpmListing("1.4.0") }, view: { code: 1, stderr: "EAI_AGAIN registry unreachable" } });
    const output = sink();
    const code = await runSelfUpdate({
      entryPoint,
      programName: "ctx",
      run,
      spawn: async () => 0,
      write: output.write,
      writeError: output.writeError,
    });
    assert.equal(code, 1);
    assert.equal(calls.length, 2);
    const message = output.err.join("\n");
    assert.match(message, /Cannot read the published version of @jaybeeuu\/agent-cortex/);
    assert.match(message, /EAI_AGAIN registry unreachable/);
    assert.doesNotMatch(message, /add -g/);
    assert.deepEqual(output.out, []);
  });

  it("reports the manager's stderr when the update fails, and runs nothing after it", async () => {
    const { run } = stubRun({
      list: { stdout: pnpmListing("1.4.0") },
      view: { stdout: "9.9.9" },
      install: { code: 1, stderr: "ERR_PNPM_FETCH_404 @jaybeeuu/agent-cortex@latest" },
    });
    const output = sink();
    /** @type {string[][]} */
    const spawned = [];
    const code = await runSelfUpdate({
      entryPoint,
      programName: "ctx",
      run,
      spawn: async (command, args) => {
        spawned.push([command, ...args]);
        return 0;
      },
      write: output.write,
      writeError: output.writeError,
    });
    assert.equal(code, 1);
    assert.deepEqual(spawned, []);
    const message = output.err.join("\n");
    assert.match(message, /The update failed/);
    assert.match(message, /ERR_PNPM_FETCH_404 @jaybeeuu\/agent-cortex@latest/);
    assert.match(message, /Nothing was run after it/);
  });

  it("fails when the manifest beside the entry point is unreadable", async () => {
    const { run, calls } = stubRun({});
    const output = sink();
    const code = await runSelfUpdate({
      entryPoint: "/opt/pnpm-home/store/v11/links/@jaybeeuu/agent-cortex/9.9.9/abc/node_modules/@jaybeeuu/agent-cortex/bin/agent-cortex.mjs",
      programName: "ctx",
      run,
      spawn: async () => 0,
      write: output.write,
      writeError: output.writeError,
    });
    assert.equal(code, 1);
    assert.deepEqual(calls, []);
    assert.match(output.err.join("\n"), /Cannot read the installed version from/);
  });
});

describe("self-update through the CLI", () => {
  it("reports the install and writes nothing on --check", async () => {
    const workspace = await tempRoot.createWorkspace();
    const install = await stageInstall({ manager: "pnpm", version: "1.4.0", workspace });
    const decoys = await stageDecoys(workspace);
    const result = await runCli(install.entryPoint, ["self-update", "--check"], {
      FAKE_CALLS: install.calls,
      FAKE_LIST: pnpmListing("1.4.0"),
      FAKE_VIEW: "9.9.9",
      PATH: `${decoys.pathDir}:${process.env.PATH ?? ""}`,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^agent-cortex self-update$/m);
    assert.match(result.stdout, /^ {2}installed {2}1\.4\.0$/m);
    assert.match(result.stdout, /^ {2}published {2}9\.9\.9$/m);
    assert.match(result.stdout, new RegExp(`^ {2}owner {6}pnpm \\(${install.prefix}/bin/pnpm\\)$`, "m"));
    assert.match(result.stdout, new RegExp(`^ {2}command {4}${install.prefix}/bin/pnpm add -g @jaybeeuu/agent-cortex@latest$`, "m"));
    // Only the two read-only calls ran: the report wrote nothing.
    assert.deepEqual(await readCalls(install.calls), ["pnpm ls -g --depth 0 --json", "pnpm view @jaybeeuu/agent-cortex version"]);
    await assertPathUnused(decoys.used);
  });

  it("acts on a bare run: install, then a harness refresh with the new binary", async () => {
    const workspace = await tempRoot.createWorkspace();
    const install = await stageInstall({ manager: "npm", version: "1.4.0", workspace });
    const decoys = await stageDecoys(workspace);
    const result = await runCli(install.entryPoint, ["self-update"], {
      FAKE_CALLS: install.calls,
      FAKE_LIST: npmListing("1.4.0"),
      FAKE_VIEW: "9.9.9",
      PATH: `${decoys.pathDir}:${process.env.PATH ?? ""}`,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await readCalls(install.calls), [
      "npm ls -g --depth 0 --json",
      "npm view @jaybeeuu/agent-cortex version",
      "npm install -g @jaybeeuu/agent-cortex@latest",
      "agent-cortex update -a",
    ]);
    await assertPathUnused(decoys.used);
  });

  it("exits non-zero on a registry error without installing", async () => {
    const workspace = await tempRoot.createWorkspace();
    const install = await stageInstall({ manager: "pnpm", version: "1.4.0", workspace });
    const decoys = await stageDecoys(workspace);
    const result = await runCli(install.entryPoint, ["self-update"], {
      FAKE_CALLS: install.calls,
      FAKE_LIST: pnpmListing("1.4.0"),
      FAKE_VIEW_FAIL: "E404 @jaybeeuu/agent-cortex is not in this registry",
      PATH: `${decoys.pathDir}:${process.env.PATH ?? ""}`,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Cannot read the published version of @jaybeeuu\/agent-cortex/);
    assert.match(result.stderr, /E404 @jaybeeuu\/agent-cortex is not in this registry/);
    assert.deepEqual(await readCalls(install.calls), ["pnpm ls -g --depth 0 --json", "pnpm view @jaybeeuu/agent-cortex version"]);
    await assertPathUnused(decoys.used);
  });

  it("exits non-zero with the exact command when the owner is unconfirmed", async () => {
    const workspace = await tempRoot.createWorkspace();
    const install = await stageInstall({ manager: "pnpm", version: "1.4.0", workspace });
    const decoys = await stageDecoys(workspace);
    const result = await runCli(install.entryPoint, ["self-update", "--check"], {
      FAKE_CALLS: install.calls,
      FAKE_LIST: pnpmListing("1.3.0"),
      FAKE_VIEW: "9.9.9",
      PATH: `${decoys.pathDir}:${process.env.PATH ?? ""}`,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Cannot confirm that pnpm owns this install/);
    assert.match(result.stderr, new RegExp(`${install.prefix}/bin/pnpm add -g @jaybeeuu/agent-cortex@latest`));
    await assertPathUnused(decoys.used);
  });

  it("exits non-zero with both commands when the layout is unknown", async () => {
    const workspace = await tempRoot.createWorkspace();
    const decoys = await stageDecoys(workspace);
    const result = await runCli(REPO_CLI, ["self-update", "--check"], {
      PATH: `${decoys.pathDir}:${process.env.PATH ?? ""}`,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Cannot identify the package manager that owns this install/);
    assert.match(result.stderr, /pnpm add -g @jaybeeuu\/agent-cortex@latest/);
    assert.match(result.stderr, /npm install -g @jaybeeuu\/agent-cortex@latest/);
    await assertPathUnused(decoys.used);
  });
});
