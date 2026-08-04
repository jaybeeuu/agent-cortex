import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseArgs, buildHelpText, validateHarness } from "../lib/cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "bin", "agent-cortex.mjs");

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
  it("returns { command: 'help' } when no arguments given", () => {
    const result = parseArgs([]);
    assert.deepStrictEqual(result, { command: "help" });
  });

  it("returns { command: 'help' } for --help flag", () => {
    const result = parseArgs(["--help"]);
    assert.deepStrictEqual(result, { command: "help" });
  });

  it("returns { command: 'help' } for -h flag", () => {
    const result = parseArgs(["-h"]);
    assert.deepStrictEqual(result, { command: "help" });
  });

  it("returns { command: 'install', harness: 'copilot' } for install copilot", () => {
    const result = parseArgs(["install", "copilot"]);
    assert.deepStrictEqual(result, { command: "install", harness: "copilot" });
  });

  it("returns { command: 'install', harness: 'claude' } for install claude", () => {
    const result = parseArgs(["install", "claude"]);
    assert.deepStrictEqual(result, { command: "install", harness: "claude" });
  });

  it("returns { command: 'install', harness: 'pi' } for install pi", () => {
    const result = parseArgs(["install", "pi"]);
    assert.deepStrictEqual(result, { command: "install", harness: "pi" });
  });

  it("returns { command: 'install', harness: null } when install has no harness", () => {
    const result = parseArgs(["install"]);
    assert.deepStrictEqual(result, { command: "install", harness: null });
  });

  it("returns { command: 'unknown', name: 'foo' } for unknown command", () => {
    const result = parseArgs(["foo"]);
    assert.deepStrictEqual(result, { command: "unknown", name: "foo" });
  });
});

describe("buildHelpText", () => {
  it("returns a string containing usage info", () => {
    const text = buildHelpText();
    assert.ok(typeof text === "string");
    assert.ok(text.includes("agent-cortex"));
    assert.ok(text.includes("install"));
  });
});

describe("validateHarness", () => {
  it("returns ok for supported harnesses", () => {
    for (const h of ["copilot", "claude", "pi"]) {
      assert.deepStrictEqual(validateHarness(h), { ok: true });
    }
  });

  it("returns error when harness is null", () => {
    const result = validateHarness(null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Missing harness"));
  });

  it("returns error for unknown harness", () => {
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

  it("exits 0 for install claude", async () => {
    const { exitCode, stdout } = await runCli(["install", "claude"]);
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
