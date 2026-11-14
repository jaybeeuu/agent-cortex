import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs, buildHelpText, resolveProgramName, validateHarness } from "../lib/cli.mjs";
import { writeFingerprint } from "./helpers/harness-fingerprint.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "bin", "agent-cortex.mjs");
const tempRoot = createTempRoot("agent-cortex-cli-");

/** Run the CLI; optionally pass a custom env (e.g. a fake HOME), a working
 * directory for the invocation, or a different CLI path.
 * @param {string[]} args
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, cli?: string }} [options]
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>} */
function runCli(args, { env = {}, cwd = process.cwd(), cli = CLI_PATH } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, ...args],
      { env: { ...process.env, ...env }, cwd },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: stdout,
          stderr: stderr,
        });
      },
    );
  });
}

/** List the files `npm pack --dry-run` would ship, without running lifecycle scripts.
 * @returns {Promise<string[]>} */
function packedFiles() {
  return new Promise((resolve, reject) => {
    execFile(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: join(__dirname, "..") },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        /** @type {{ files: { path: string }[] }[]} */
        const report = JSON.parse(stdout);
        resolve(report[0].files.map((file) => file.path));
      },
    );
  });
}

describe("parseArgs", () => {
  it("returns { command: 'help' } when no arguments given", async () => {
    const result = parseArgs([]);
    assert.deepStrictEqual(result, { command: "help" });
  });

  it("returns { command: 'help' } for --help flag", async () => {
    const result = parseArgs(["--help"]);
    assert.deepStrictEqual(result, { command: "help" });
  });

  it("returns { command: 'help' } for -h flag", async () => {
    const result = parseArgs(["-h"]);
    assert.deepStrictEqual(result, { command: "help" });
  });

  it("returns { command: 'version' } for --version", async () => {
    assert.deepStrictEqual(parseArgs(["--version"]), { command: "version" });
  });

  it("returns { command: 'version' } for -V", async () => {
    assert.deepStrictEqual(parseArgs(["-V"]), { command: "version" });
  });

  it("returns a harness report flag for the version subcommand", async () => {
    assert.deepStrictEqual(parseArgs(["version"]), { command: "version", report: true });
  });

  it("returns json for version --json", async () => {
    assert.deepStrictEqual(parseArgs(["version", "--json"]), { command: "version", report: true, json: true });
  });

  it("returns an optionError for an unknown version option", async () => {
    const result = parseArgs(["version", "--bogus"]);
    assert.equal(result.command, "version");
    assert.ok(result.optionError);
    assert.match(result.optionError, /--bogus/);
  });

  it("only honours --version as the first argument", async () => {
    const result = parseArgs(["install", "pi", "--version"]);
    assert.equal(result.command, "install");
    assert.equal(result.harness, "pi");
    assert.ok(result.optionError);
    assert.match(result.optionError, /--version/);
  });

  it("returns { command: 'install', harness: 'claude' } for install claude", async () => {
    const result = parseArgs(["install", "claude"]);
    assert.deepStrictEqual(result, { command: "install", harness: "claude" });
  });

  it("returns { command: 'install', harness: 'pi' } for install pi", async () => {
    const result = parseArgs(["install", "pi"]);
    assert.deepStrictEqual(result, { command: "install", harness: "pi" });
  });

  it("returns { command: 'install', harness: null } when install has no harness", async () => {
    const result = parseArgs(["install"]);
    assert.deepStrictEqual(result, { command: "install", harness: null });
  });

  it("returns output for install claude --output <dir>", async () => {
    const result = parseArgs(["install", "claude", "--output", "/tmp/x"]);
    assert.deepStrictEqual(result, { command: "install", harness: "claude", output: "/tmp/x" });
  });

  it("returns output for install claude --output=<dir>", async () => {
    const result = parseArgs(["install", "claude", "--output=/tmp/x"]);
    assert.deepStrictEqual(result, { command: "install", harness: "claude", output: "/tmp/x" });
  });

  it("returns dryRun for install claude --dry-run", async () => {
    const result = parseArgs(["install", "claude", "--dry-run"]);
    assert.deepStrictEqual(result, { command: "install", harness: "claude", dryRun: true });
  });

  it("combines --dry-run with --output", async () => {
    const result = parseArgs(["install", "claude", "--output", "/tmp/x", "--dry-run"]);
    assert.deepStrictEqual(result, { command: "install", harness: "claude", output: "/tmp/x", dryRun: true });
  });

  it("reports an unknown option for claude", async () => {
    const result = parseArgs(["install", "claude", "--bogus"]);
    assert.equal(result.command, "install");
    assert.equal(result.harness, "claude");
    assert.ok(result.optionError?.includes("--bogus"));
  });

  it("reports a missing value for --output for claude", async () => {
    const result = parseArgs(["install", "claude", "--output"]);
    assert.equal(result.command, "install");
    assert.equal(result.harness, "claude");
    assert.ok(result.optionError?.includes("--output"));
  });

  it("parses --dry-run for install", async () => {
    const result = parseArgs(["install", "pi", "--dry-run"]);
    assert.deepStrictEqual(result, { command: "install", harness: "pi", dryRun: true });
  });

  it("parses --output <dir> for install", async () => {
    const result = parseArgs(["install", "pi", "--output", "/tmp/out"]);
    assert.deepStrictEqual(result, { command: "install", harness: "pi", output: "/tmp/out" });
  });

  it("parses --plugin-root <dir> for install", async () => {
    const result = parseArgs(["install", "pi", "--plugin-root", "/tmp/plugin"]);
    assert.deepStrictEqual(result, { command: "install", harness: "pi", pluginRoot: "/tmp/plugin" });
  });

  it("combines multiple install options", async () => {
    const result = parseArgs(["install", "pi", "--dry-run", "--output", "/tmp/out", "--plugin-root", "/tmp/plugin"]);
    assert.deepStrictEqual(result, {
      command: "install",
      harness: "pi",
      dryRun: true,
      output: "/tmp/out",
      pluginRoot: "/tmp/plugin",
    });
  });

  it("reports a missing value for --output", async () => {
    const result = parseArgs(["install", "pi", "--output"]);
    assert.equal(result.command, "install");
    assert.equal(result.harness, "pi");
    assert.ok(result.optionError?.includes("--output"));
  });

  it("reports an unknown option", async () => {
    const result = parseArgs(["install", "pi", "--bogus"]);
    assert.equal(result.command, "install");
    assert.equal(result.harness, "pi");
    assert.ok(result.optionError?.includes("--bogus"));
  });

  it("keeps the old shape when no options are given", async () => {
    assert.deepStrictEqual(parseArgs(["install", "pi"]), { command: "install", harness: "pi" });
  });

  it("defaults self-update to acting", async () => {
    assert.deepStrictEqual(parseArgs(["self-update"]), { command: "self-update", check: false });
  });

  it("parses --check for self-update", async () => {
    assert.deepStrictEqual(parseArgs(["self-update", "--check"]), { command: "self-update", check: true });
  });

  it("reports an unknown option for self-update", async () => {
    const result = parseArgs(["self-update", "--bogus"]);
    assert.equal(result.command, "self-update");
    assert.ok(result.optionError?.includes("--bogus"));
  });

  it("defaults migrate to a dry run", async () => {
    assert.deepStrictEqual(parseArgs(["migrate"]), { command: "migrate", apply: false });
  });

  it("parses --apply for migrate", async () => {
    assert.deepStrictEqual(parseArgs(["migrate", "--apply"]), { command: "migrate", apply: true });
  });

  it("parses an explicit --dry-run for migrate", async () => {
    assert.deepStrictEqual(parseArgs(["migrate", "--dry-run"]), { command: "migrate", apply: false });
  });

  it("rejects --apply combined with --dry-run", async () => {
    const result = parseArgs(["migrate", "--apply", "--dry-run"]);
    assert.equal(result.command, "migrate");
    assert.ok(result.optionError?.includes("--apply"));
  });

  it("reports an unknown option for migrate", async () => {
    const result = parseArgs(["migrate", "--bogus"]);
    assert.equal(result.command, "migrate");
    assert.ok(result.optionError?.includes("--bogus"));
  });

  it("parses an idea directory override for migrate", async () => {
    assert.deepStrictEqual(parseArgs(["migrate", "--dir", "docs/notes"]), {
      command: "migrate",
      apply: false,
      dir: "docs/notes",
    });
    assert.deepStrictEqual(parseArgs(["migrate", "--dir=docs/notes", "--apply"]), {
      command: "migrate",
      apply: true,
      dir: "docs/notes",
    });
  });

  it("rejects a --dir without a path for migrate", async () => {
    for (const argv of [["migrate", "--dir"], ["migrate", "--dir", "--apply"], ["migrate", "--dir="]]) {
      const result = parseArgs(argv);
      assert.equal(result.command, "migrate");
      assert.ok(result.optionError?.includes("--dir"), `no --dir error for ${argv.join(" ")}`);
    }
  });

  it("returns { command: 'update' } with no selection for bare update", async () => {
    assert.deepStrictEqual(parseArgs(["update"]), { command: "update", harnesses: [], all: false, force: false });
  });

  it("collects the harnesses named after update", async () => {
    assert.deepStrictEqual(parseArgs(["update", "pi", "claude"]), {
      command: "update",
      harnesses: ["pi", "claude"],
      all: false,
      force: false,
    });
  });

  it("parses -a and --all for update", async () => {
    for (const flag of ["-a", "--all"]) {
      assert.deepStrictEqual(parseArgs(["update", flag]), { command: "update", harnesses: [], all: true, force: false });
    }
  });

  it("parses -f and --force beside -a for update", async () => {
    for (const flag of ["-f", "--force"]) {
      assert.deepStrictEqual(parseArgs(["update", "-a", flag]), {
        command: "update",
        harnesses: [],
        all: true,
        force: true,
      });
    }
  });

  it("rejects -f without -a for update", async () => {
    const result = parseArgs(["update", "-f"]);
    assert.equal(result.command, "update");
    assert.ok(result.optionError?.includes("--force"), "--force names the flag it needs");
  });

  it("reports an unknown option for update", async () => {
    const result = parseArgs(["update", "--bogus"]);
    assert.equal(result.command, "update");
    assert.ok(result.optionError?.includes("--bogus"));
  });

  it("returns { command: 'unknown', name: 'foo' } for unknown command", async () => {
    const result = parseArgs(["foo"]);
    assert.deepStrictEqual(result, { command: "unknown", name: "foo" });
  });

  it("names the invoked command in the usage hint of an option error", async () => {
    for (const argv of [["install", "pi", "--bogus"], ["migrate", "--bogus"]]) {
      const result = parseArgs(argv, "ctx");
      assert.match(result.optionError ?? "", /Run "ctx --help" for usage\./, `hint for ${argv.join(" ")}`);
    }
  });
});

describe("resolveProgramName", () => {
  it("keeps the three published command names", async () => {
    for (const name of ["agent-cortex", "cortex", "ctx"]) {
      assert.equal(resolveProgramName(name), name);
    }
  });

  it("reads the name from the invoked script path", async () => {
    assert.equal(resolveProgramName("/usr/local/bin/ctx"), "ctx");
  });

  it("falls back to agent-cortex for any other name", async () => {
    for (const name of ["agent-cortex.mjs", "node", "", undefined]) {
      assert.equal(resolveProgramName(name), "agent-cortex", `fallback for ${JSON.stringify(name)}`);
    }
  });
});

describe("buildHelpText", () => {
  it("returns a string containing usage info", async () => {
    const text = buildHelpText();
    assert.ok(typeof text === "string");
    assert.ok(text.includes("agent-cortex"));
    assert.ok(text.includes("install"));
    assert.ok(text.includes("migrate"));
  });

  it("documents the version flags", async () => {
    const text = buildHelpText();
    assert.ok(text.includes("--version, -V"), "--version is listed beside --help");
  });

  it("documents the update command and its flags", async () => {
    const text = buildHelpText();
    for (const expected of ["update [<harness>...]", "-a, --all", "-f, --force"]) {
      assert.ok(text.includes(expected), `help lists ${expected}`);
    }
  });

  it("defaults to the agent-cortex help text", async () => {
    assert.equal(buildHelpText(), buildHelpText("agent-cortex"));
  });

  it("names the invoked command in the usage line", async () => {
    assert.match(buildHelpText("ctx"), /^Usage: ctx <command> \[options\]/);
    assert.match(buildHelpText("cortex"), /^Usage: cortex <command> \[options\]/);
  });

  it("changes only the usage line when the program name changes", async () => {
    const fallback = buildHelpText("agent-cortex").split("\n");
    const aliased = buildHelpText("ctx").split("\n");
    assert.deepEqual(aliased.filter((line, index) => line !== fallback[index]), ["Usage: ctx <command> [options]"]);
  });
});

describe("validateHarness", () => {
  it("returns ok for supported harnesses", async () => {
    for (const h of ["claude", "pi"]) {
      assert.deepStrictEqual(validateHarness(h), { ok: true });
    }
  });

  it("returns error for copilot, which is no longer a deploy target", async () => {
    const result = validateHarness("copilot");
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Unknown harness"));
  });

  it("returns error when harness is null", async () => {
    const result = validateHarness(null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Missing harness"));
  });

  it("returns error for unknown harness", async () => {
    const result = validateHarness("docker");
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Unknown harness"));
  });
});

describe("CLI integration", () => {
  it("exits 0 and prints help when run with no arguments", async () => {
    const { exitCode, stdout } = await runCli([]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("agent-cortex"));
    assert.ok(stdout.includes("install"));
  });

  it("exits 0 and prints help for --help", async () => {
    const { exitCode, stdout } = await runCli(["--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Usage:"));
  });

  it("exits 0 and prints help for -h", async () => {
    const { exitCode, stdout } = await runCli(["-h"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("Usage:"));
  });

  it("exits 0 and prints the package version, bare and alone, for --version", async () => {
    const manifest = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf-8"));
    const { exitCode, stdout } = await runCli(["--version"]);
    assert.equal(exitCode, 0);
    assert.equal(stdout, `${manifest.version}\n`);
    assert.match(stdout, /^\d+\.\d+\.\d+\n$/, "bare semver, no prefix and no trailing prose");
  });

  it("prints the same version for -V as for --version", async () => {
    const long = await runCli(["--version"]);
    const short = await runCli(["-V"]);
    assert.equal(short.exitCode, 0);
    assert.equal(short.stdout, long.stdout);
  });

  it("reports its own package version when run from another directory", async () => {
    const manifest = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf-8"));
    const elsewhere = await mkdtemp(join(tmpdir(), "agent-cortex-version-"));
    try {
      // A decoy manifest in the cwd must never win: the version comes from the
      // package the binary lives in, not from wherever it was invoked.
      await writeFile(join(elsewhere, "package.json"), JSON.stringify({ version: "9.9.9" }));
      const { exitCode, stdout } = await runCli(["--version"], { cwd: elsewhere });
      assert.equal(exitCode, 0);
      assert.equal(stdout, `${manifest.version}\n`);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("exits 1 without printing a version when the manifest beside the binary is broken", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-cortex-broken-install-"));
    try {
      for (const dir of ["bin", "lib", "scripts"]) {
        await cp(join(__dirname, "..", dir), join(root, dir), { recursive: true });
      }
      const cli = join(root, "bin", "agent-cortex.mjs");
      const manifestPath = join(root, "package.json");
      const cases = [
        { name: "missing", setup: () => rm(manifestPath, { force: true }) },
        { name: "malformed", setup: () => writeFile(manifestPath, "{ not json") },
        { name: "version-less", setup: () => writeFile(manifestPath, "{}") },
      ];
      for (const { name, setup } of cases) {
        await setup();
        const { exitCode, stdout, stderr } = await runCli(["--version"], { cli });
        assert.equal(exitCode, 1, `exit 1 for a ${name} manifest`);
        assert.equal(stdout, "", `no version on stdout for a ${name} manifest`);
        assert.match(stderr, /Cannot read the package version from .*package\.json/, `diagnostic for a ${name} manifest`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exits 1 for install copilot, which is no longer a deploy target", async () => {
    const { exitCode, stderr } = await runCli(["install", "copilot"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Unknown harness"));
  });

  it("exits 0 for install claude (into a temp output dir)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-cortex-cli-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "claude", "--output", dir]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes("claude"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 for install pi (into a temp output dir)", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "cli-pi-default-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "pi", "--output", outDir]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes("pi"));
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("exits 1 and prints error for install with no harness", async () => {
    const { exitCode, stderr } = await runCli(["install"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Missing harness"));
  });

  it("exits 1 and prints error for install with an unknown option", async () => {
    const { exitCode, stderr } = await runCli(["install", "pi", "--bogus"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("--bogus"));
  });

  it("exits 1 for the removed --no-provision flag", async () => {
    const { exitCode, stderr } = await runCli(["install", "pi", "--no-provision"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("--no-provision"), "the removed flag is named in the error");
  });

  it("exits 1 and prints error for install with a missing option value", async () => {
    const { exitCode, stderr } = await runCli(["install", "pi", "--output"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("--output"));
  });

  it("exits 0 for install pi --dry-run and writes nothing", async () => {
    // A throwaway HOME keeps the registration plan (which reads pi's settings)
    // off the developer's real ~/.pi/agent.
    const fakeHome = await mkdtemp(join(tmpdir(), "cli-pi-dry-run-home-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "pi", "--dry-run"], { env: { HOME: fakeHome } });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes("ralph.agent.md"));
      assert.ok(stdout.includes("dry-run"));
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("install pi --dry-run reports the bundled pi packages it would stage", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "cli-pi-home-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "pi", "--dry-run"], { env: { HOME: fakeHome } });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes("Bundled pi package pi-questions"), "pi-questions staged");
      assert.ok(stdout.includes("Bundled pi package pi-web-access"), "pi-web-access staged");
      assert.ok(stdout.includes(join(fakeHome, ".agent-cortex", "pi")), "default output is the home staging dir");
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("exits 0 for install pi --output <tmp> and stages a loadable pi package", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "cli-pi-install-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "pi", "--output", outDir]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes("ralph.agent.md"));
      const ralph = await readFile(join(outDir, "agents", "ralph.agent.md"), "utf-8");
      assert.ok(ralph.includes("agent-cortex:ralph"));
      const manifest = JSON.parse(await readFile(join(outDir, "package.json"), "utf-8"));
      assert.deepEqual(manifest.keywords, ["pi-package"]);
      assert.ok(manifest.pi.extensions.includes("./extensions"));
      assert.ok(manifest.pi.skills.includes("./skills"));
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("exits 1 and prints error for install with unknown harness", async () => {
    const { exitCode, stderr } = await runCli(["install", "docker"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Unknown harness"));
  });

  it("exits 1 and prints error for unknown command", async () => {
    const { exitCode, stderr } = await runCli(["bogus"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Unknown command"));
  });

  it("prints exactly the default help text when the invoked name is not a known command", async () => {
    // `node bin/agent-cortex.mjs` passes "agent-cortex.mjs" as argv[1], so this
    // also pins the fallback: the help text stays what agent-cortex printed.
    const { exitCode, stdout } = await runCli(["--help"]);
    assert.equal(exitCode, 0);
    assert.equal(stdout, `${buildHelpText("agent-cortex")}\n`);
  });

  it("names the resolved command in the unknown-command hint", async () => {
    const { stderr } = await runCli(["bogus"]);
    assert.match(stderr, /Run "agent-cortex --help" for usage\./);
  });
});

describe("version command", () => {
  /** A fake HOME holding the harness artifact roots the case asks for.
   * @param {{ harness: "pi" | "claude", content: string }[]} fingerprints
   * @returns {Promise<string>}
   */
  async function createHome(fingerprints) {
    const home = join(await tempRoot.createWorkspace(), "home");
    await mkdir(home, { recursive: true });
    for (const { harness, content } of fingerprints) {
      await writeFingerprint(home, harness, content);
    }
    return home;
  }

  /** @returns {Promise<string>} */
  async function cliVersion() {
    /** @type {{ version: string }} */
    const manifest = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf-8"));
    return manifest.version;
  }

  it("prints the CLI version first, then each installed harness with a stale marker", async () => {
    const home = await createHome([
      { harness: "pi", content: JSON.stringify({ version: "0.0.1" }) },
      { harness: "claude", content: JSON.stringify({ version: "0.0.2" }) },
    ]);

    const { exitCode, stdout } = await runCli(["version"], { env: { HOME: home } });

    assert.equal(exitCode, 0);
    assert.deepEqual(stdout.trimEnd().split("\n"), [
      await cliVersion(),
      "claude 0.0.2 stale",
      "pi 0.0.1 stale",
    ]);
  });

  it("prints the CLI version alone when no harness is installed", async () => {
    const home = await createHome([]);

    const { exitCode, stdout } = await runCli(["version"], { env: { HOME: home } });

    assert.equal(exitCode, 0);
    assert.equal(stdout, `${await cliVersion()}\n`);
  });

  it("reports unknown for a harness root whose fingerprint is broken", async () => {
    const home = await createHome([{ harness: "claude", content: "{ not json" }]);

    const { exitCode, stdout } = await runCli(["version"], { env: { HOME: home } });

    assert.equal(exitCode, 0);
    assert.equal(stdout.trimEnd().split("\n").at(-1), "claude unknown unknown");
  });

  it("prints one JSON record per installed harness for version --json", async () => {
    const home = await createHome([{ harness: "pi", content: JSON.stringify({ version: "0.0.1" }) }]);

    const { exitCode, stdout } = await runCli(["version", "--json"], { env: { HOME: home } });

    assert.equal(exitCode, 0);
    assert.deepStrictEqual(JSON.parse(stdout), {
      cli: await cliVersion(),
      harnesses: [{ harness: "pi", installed: "0.0.1", cli: await cliVersion(), staleness: "stale" }],
    });
  });

  it("writes nothing to the home directory", async () => {
    const home = await createHome([{ harness: "pi", content: JSON.stringify({ version: "0.0.1" }) }]);
    const snapshot = async () => {
      const entries = (await readdir(home, { recursive: true })).sort();
      return Promise.all(
        entries.map(async (entry) => `${entry} ${(await stat(join(home, entry))).mtimeMs}`),
      );
    };
    const before = await snapshot();

    const { exitCode } = await runCli(["version"], { env: { HOME: home } });

    assert.equal(exitCode, 0);
    assert.deepEqual(await snapshot(), before, "the report path is read-only");
  });

  it("exits 1 and prints error for an unknown version option", async () => {
    const { exitCode, stderr } = await runCli(["version", "--bogus"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("--bogus"));
  });
});

describe("update command", () => {
  /** @returns {Promise<string>} A fake HOME holding no install root yet. */
  async function createHome() {
    const home = join(await tempRoot.createWorkspace(), "home");
    await mkdir(home, { recursive: true });
    return home;
  }

  /** @returns {Promise<string>} */
  async function cliVersion() {
    /** @type {{ version: string }} */
    const manifest = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf-8"));
    return manifest.version;
  }

  it("exits 1 for an unknown harness name and runs no installer", async () => {
    const home = await createHome();

    const { exitCode, stderr } = await runCli(["update", "docker"], { env: { HOME: home } });

    assert.equal(exitCode, 1);
    assert.match(stderr, /Unknown harness "docker"/);
    assert.deepEqual(await readdir(home), [], "no install root was written");
  });

  it("prints the harness table and the available flags, then exits 1 when update is not on a terminal", async () => {
    const home = await createHome();
    await writeFingerprint(home, "pi", JSON.stringify({ version: "0.0.1" }));

    const { exitCode, stdout, stderr } = await runCli(["update"], { env: { HOME: home } });

    assert.equal(exitCode, 1, "a non-interactive update fails instead of blocking");
    assert.match(stdout, /^harness\s+installed\s+cli\s+status$/m, "the table header is printed");
    assert.match(stdout, /^claude\s+not installed\s+\d+\.\d+\.\d+\s+missing$/m, "the uninstalled harness has a row");
    assert.match(stdout, /^pi\s+0\.0\.1\s+\d+\.\d+\.\d+\s+stale$/m, "the stale harness has its two versions");
    assert.match(stdout, /agent-cortex update -a -f/, "the flags are listed so the next run is not a guess");
    assert.equal(stderr, "");
  });

  it("refreshes the named harness only and leaves the other install root untouched", async () => {
    const home = await createHome();
    // An empty PATH keeps registration from spawning a real Claude Code CLI:
    // the installer warns and prints the manual commands instead.
    const emptyPath = join(await tempRoot.createWorkspace(), "empty-path");
    await mkdir(emptyPath, { recursive: true });

    const { exitCode, stdout } = await runCli(["update", "claude"], { env: { HOME: home, PATH: emptyPath } });

    assert.equal(exitCode, 0);
    /** @type {{ version: string }} */
    const plugin = JSON.parse(await readFile(join(home, ".agent-cortex", "claude", ".claude-plugin", "plugin.json"), "utf-8"));
    assert.equal(plugin.version, await cliVersion());
    assert.match(stdout, /claude not installed → \d+\.\d+\.\d+/, "the report shows the version it reached");
    await assert.rejects(
      readFile(join(home, ".agent-cortex", "pi", "package.json"), "utf-8"),
      /ENOENT/,
      "the pi staging root is never created",
    );
  });

  it("reports nothing to update for -a when every harness is already at the CLI version", async () => {
    const home = await createHome();
    const version = await cliVersion();
    await writeFingerprint(home, "pi", JSON.stringify({ version }));
    await writeFingerprint(home, "claude", JSON.stringify({ version }));

    const { exitCode, stdout } = await runCli(["update", "-a"], { env: { HOME: home } });

    assert.equal(exitCode, 0);
    assert.equal(stdout.trimEnd(), `Nothing to update — every harness is at ${version}.`);
  });
});

describe("published command names", () => {
  it("declares cortex and ctx beside agent-cortex, and packs the script they run", async () => {
    /** @type {{ bin: Record<string, string> }} */
    const manifest = JSON.parse(await readFile(join(__dirname, "..", "package.json"), "utf-8"));
    for (const name of ["agent-cortex", "cortex", "ctx"]) {
      assert.equal(manifest.bin[name], "./bin/agent-cortex.mjs", `${name} shim`);
    }
    const shipped = new Set(await packedFiles());
    for (const target of new Set(Object.values(manifest.bin))) {
      assert.ok(shipped.has(target.replace(/^\.\//, "")), `${target} is missing from the packed tarball`);
    }
  });
});
