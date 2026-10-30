import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs, buildHelpText, validateHarness } from "../lib/cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "bin", "agent-cortex.mjs");

/** True when a path exists (stat succeeds). */
async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Run the CLI; optionally pass a custom env (e.g. a fake HOME) or cwd. */
function runCli(args, { env = {}, cwd = process.cwd(), cli = CLI_PATH } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, ...args],
      { env: { ...process.env, ...env }, cwd },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? error.code ?? 1 : 0,
          stdout: stdout,
          stderr: stderr,
        });
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

  it("only honours --version as the first argument", async () => {
    const result = parseArgs(["install", "pi", "--version"]);
    assert.equal(result.command, "install");
    assert.equal(result.harness, "pi");
    assert.ok(result.optionError.includes("--version"));
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
    assert.ok(result.optionError.includes("--bogus"));
  });

  it("reports a missing value for --output for claude", async () => {
    const result = parseArgs(["install", "claude", "--output"]);
    assert.equal(result.command, "install");
    assert.equal(result.harness, "claude");
    assert.ok(result.optionError.includes("--output"));
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
    assert.ok(result.optionError.includes("--output"));
  });

  it("reports an unknown option", async () => {
    const result = parseArgs(["install", "pi", "--bogus"]);
    assert.equal(result.command, "install");
    assert.equal(result.harness, "pi");
    assert.ok(result.optionError.includes("--bogus"));
  });

  it("keeps the old shape when no options are given", async () => {
    assert.deepStrictEqual(parseArgs(["install", "pi"]), { command: "install", harness: "pi" });
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
    assert.ok(result.optionError.includes("--apply"));
  });

  it("reports an unknown option for migrate", async () => {
    const result = parseArgs(["migrate", "--bogus"]);
    assert.equal(result.command, "migrate");
    assert.ok(result.optionError.includes("--bogus"));
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
      assert.ok(result.optionError.includes("--dir"), `no --dir error for ${argv.join(" ")}`);
    }
  });

  it("returns { command: 'unknown', name: 'foo' } for unknown command", async () => {
    const result = parseArgs(["foo"]);
    assert.deepStrictEqual(result, { command: "unknown", name: "foo" });
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
    const { exitCode, stdout } = await runCli(["install", "claude", "--output", dir]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("claude"));
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
});
