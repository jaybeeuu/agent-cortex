// Tests for `agent-cortex install claude` runtime registration: after
// regenerating the claude/ subtree, the plain install registers the plugin
// with Claude Code by driving the `claude plugin` CLI (marketplace add →
// install → marketplace update → plugin update). The real CLI is a genuine
// external system, so these tests drive a fake `claudeBin` script that records
// every invocation; the real repo's marketplace.json supplies the manifest.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerClaude } from "../bin/installers/claude.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PATH = join(ROOT, "bin", "agent-cortex.mjs");

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
      resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr });
    });
  });
}

// ─── Fake claude CLI ─────────────────────────────────────────────────────────

/**
 * A fake `claude` binary recording every argv line to `log` (one line per
 * invocation, space-joined). Set `failWhen` to a substring: any invocation
 * whose argv contains it exits 1. Exits 0 otherwise.
 */
async function makeFakeClaude(dir, { failWhen = null } = {}) {
  const bin = join(dir, "claude");
  const log = join(dir, "calls.log");
  const script = [
    "#!/bin/sh",
    `echo "$*" >> "${log}"`,
    ...(failWhen
      ? [`if printf '%s' "$*" | grep -q -- "${failWhen}"; then exit 1; fi`]
      : []),
    "exit 0",
  ].join("\n");
  await writeFile(bin, `${script}\n`);
  await chmod(bin, 0o755);
  return { bin, log };
}

async function makeTmp() {
  return await mkdtemp(join(tmpdir(), "agent-cortex-claude-installer-"));
}

/** A minimal marketplace tree (as seen in the real repo) at a scratch path. */
async function makeMarketplaceRoot({ name = "jaybeeuu", plugin = "agent-cortex" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent-cortex-marketplace-"));
  await mkdir(join(root, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name,
      owner: { name: "tester" },
      plugins: [{ name: plugin, source: "./claude", description: "test plugin" }],
    }),
  );
  return root;
}

// ─── registerClaude ──────────────────────────────────────────────────────────

describe("registerClaude", () => {
  it("drives claude plugin marketplace add → install → marketplace update → plugin update", async () => {
    const tmp = await makeTmp();
    const root = await makeMarketplaceRoot();
    const fake = await makeFakeClaude(tmp);
    try {
      const result = await registerClaude({ root, claudeBin: fake.bin });
      assert.equal(result.marketplace, "jaybeeuu");
      assert.equal(result.plugin, "agent-cortex");
      assert.equal(result.dryRun, false);

      const calls = (await readFile(fake.log, "utf-8")).trim().split("\n");
      // The availability probe (`plugin --help`) is a spawn, but the registration
      // surface is the four commands below — assert those, in order.
      const registration = calls.filter((c) => !c.startsWith("plugin --help"));
      assert.deepEqual(registration, [
        `plugin marketplace add ${root}`,
        "plugin install agent-cortex@jaybeeuu -y",
        "plugin marketplace update jaybeeuu",
        "plugin update agent-cortex -y",
      ]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("derives marketplace and plugin names from the manifest", async () => {
    const tmp = await makeTmp();
    const root = await makeMarketplaceRoot({ name: "scratchmkt", plugin: "scratchplug" });
    const fake = await makeFakeClaude(tmp);
    try {
      const result = await registerClaude({ root, claudeBin: fake.bin });
      assert.equal(result.marketplace, "scratchmkt");
      assert.equal(result.plugin, "scratchplug");
      const calls = (await readFile(fake.log, "utf-8")).trim().split("\n");
      const registration = calls.filter((c) => !c.startsWith("plugin --help"));
      assert.ok(registration.some((c) => c === "plugin install scratchplug@scratchmkt -y"));
      assert.ok(registration.some((c) => c === "plugin update scratchplug -y"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("--dry-run plans the commands without spawning claude at all", async () => {
    const tmp = await makeTmp();
    const root = await makeMarketplaceRoot();
    const fake = await makeFakeClaude(tmp);
    try {
      const result = await registerClaude({ root, claudeBin: fake.bin, dryRun: true });
      assert.equal(result.dryRun, true);
      assert.deepEqual(
        result.commands,
        [
          ["plugin", "marketplace", "add", root],
          ["plugin", "install", "agent-cortex@jaybeeuu", "-y"],
          ["plugin", "marketplace", "update", "jaybeeuu"],
          ["plugin", "update", "agent-cortex", "-y"],
        ],
      );
      // No registration spawns happened at all in dry-run mode.
      assert.equal(await pathExists(fake.log), false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defaults the claude binary to `claude` from PATH (dry-run only — no spawn)", async () => {
    const root = await makeMarketplaceRoot();
    try {
      const result = await registerClaude({ root, dryRun: true });
      assert.equal(result.commands.length, 4);
      assert.ok(result.commands[0][0] === "plugin");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails with upgrade guidance when the claude binary lacks the plugin subcommand", async () => {
    const tmp = await makeTmp();
    const root = await makeMarketplaceRoot();
    const fake = await makeFakeClaude(tmp, { failWhen: "plugin --help" });
    try {
      await assert.rejects(
        registerClaude({ root, claudeBin: fake.bin }),
        /plugin.*subcommand.*update/i,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails, naming the failing command, when a claude plugin command errors", async () => {
    const tmp = await makeTmp();
    const root = await makeMarketplaceRoot();
    const fake = await makeFakeClaude(tmp, { failWhen: "plugin install" });
    try {
      await assert.rejects(
        registerClaude({ root, claudeBin: fake.bin }),
        /claude plugin install agent-cortex@jaybeeuu -y/,
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the checkout has no marketplace manifest", async () => {
    const tmp = await makeTmp();
    const root = await mkdtemp(join(tmpdir(), "agent-cortex-no-market-"));
    const fake = await makeFakeClaude(tmp);
    try {
      await assert.rejects(
        registerClaude({ root, claudeBin: fake.bin }),
        /marketplace\.json/,
      );
      // The failed manifest read happens before any claude invocation.
      assert.equal(await pathExists(fake.log), false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("works against the real repo checkout and its marketplace manifest", async () => {
    const tmp = await makeTmp();
    const fake = await makeFakeClaude(tmp);
    try {
      const result = await registerClaude({ root: ROOT, claudeBin: fake.bin });
      assert.equal(result.marketplace, "jaybeeuu");
      assert.equal(result.plugin, "agent-cortex");
      const calls = (await readFile(fake.log, "utf-8")).trim().split("\n");
      const registration = calls.filter((c) => !c.startsWith("plugin --help"));
      assert.equal(registration.length, 4);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ─── CLI wiring ───────────────────────────────────────────────────────────────

describe("install claude CLI: registration", () => {
  it("--dry-run without --output prints the registration plan and writes nothing", async () => {
    const { exitCode, stdout } = await runCli(["install", "claude", "--dry-run"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("would run: claude plugin marketplace add"));
    assert.ok(stdout.includes("claude plugin install agent-cortex@jaybeeuu"));
    assert.ok(stdout.includes("claude plugin marketplace update jaybeeuu"));
    assert.ok(stdout.includes("claude plugin update agent-cortex"));
    assert.ok(/dry-run/i.test(stdout));
  });

  it("--output <dir> generates only — no registration plan is printed", async () => {
    const out = await mkdtemp(join(tmpdir(), "agent-cortex-cli-out-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "claude", "--output", out]);
      assert.equal(exitCode, 0);
      assert.doesNotMatch(stdout, /claude plugin/);
      assert.ok(stdout.includes("Generated"));
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});