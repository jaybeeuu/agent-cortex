import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], (error, stdout, stderr) => {
      resolve({
        exitCode: error ? error.code ?? 1 : 0,
        stdout: stdout,
        stderr: stderr,
      });
    });
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

  it("returns { command: 'install', harness: 'copilot' } for install copilot", async () => {
    const result = parseArgs(["install", "copilot"]);
    assert.deepStrictEqual(result, { command: "install", harness: "copilot" });
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
  });
});

describe("validateHarness", () => {
  it("returns ok for supported harnesses", async () => {
    for (const h of ["copilot", "claude", "pi"]) {
      assert.deepStrictEqual(validateHarness(h), { ok: true });
    }
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

  it("exits 0 for install copilot", async () => {
    const { exitCode, stdout } = await runCli(["install", "copilot"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("copilot"));
  });

  it("exits 0 for install claude (into a temp output dir)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-cortex-cli-"));
    const { exitCode, stdout } = await runCli(["install", "claude", "--output", dir]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("claude"));
  });

  it("exits 0 for install pi", async () => {
    const { exitCode, stdout } = await runCli(["install", "pi"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("pi"));
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

  it("exits 1 and prints error for install with a missing option value", async () => {
    const { exitCode, stderr } = await runCli(["install", "pi", "--output"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("--output"));
  });

  it("exits 0 for install pi --dry-run and writes nothing", async () => {
    const { exitCode, stdout } = await runCli(["install", "pi", "--dry-run"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("ralph.agent.md"));
    assert.ok(stdout.includes("dry-run"));
  });

  it("exits 0 for install pi --output <tmp> and writes agent files", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "cli-pi-install-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "pi", "--output", outDir]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes("ralph.agent.md"));
      const ralph = await readFile(join(outDir, "agents", "ralph.agent.md"), "utf-8");
      assert.ok(ralph.includes("agent-cortex:ralph"));
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
