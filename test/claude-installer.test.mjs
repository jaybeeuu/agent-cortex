// Tests for `agent-cortex install claude` runtime registration: after
// materialising the plugin into the home install root, the plain install
// registers the plugin with Claude Code by driving the `claude plugin` CLI.
// Registration is
// idempotent by STATE, not by exit code: `marketplace list --json` decides
// add-vs-update and `plugin list --json` decides install-vs-update against the
// materialised version. The real CLI is a genuine external system (and its
// home config must never be touched), so these tests drive the stateful fake
// from test/helpers/fake-claude.mjs; fixture manifests (makeMarketplaceRoot)
// stand in for the home install root's generated marketplace manifest.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerClaude } from "../bin/installers/claude.mjs";
import { makeFakeClaude, registrationActions } from "./helpers/fake-claude.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PATH = join(ROOT, "bin", "agent-cortex.mjs");

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr });
      },
    );
  });
}

function makeTmp() {
  return mkdtempSync(join(tmpdir(), "agent-cortex-claude-installer-"));
}

function callLines(log) {
  return readFileSync(log, "utf-8").trim().split("\n").filter(Boolean);
}

/** Registration actions logged at/after line `since` (0 = whole log). */
function actionsSince(log, since = 0) {
  return registrationActions(callLines(log).slice(since));
}

/** A minimal marketplace tree (as seen at the real install root): the
 * marketplace manifest exposing ./claude plus the materialised plugin.json the
 * fake reads for the installed version. */
function makeMarketplaceRoot({ name = "jaybeeuu", plugin = "agent-cortex", version = "1.0.0" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "agent-cortex-marketplace-"));
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name,
      owner: { name: "tester" },
      plugins: [{ name: plugin, source: "./claude", description: "test plugin" }],
    }),
  );
  mkdirSync(join(root, "claude", ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, "claude", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: plugin, version, description: "test plugin" }),
  );
  return root;
}

// ─── registerClaude ──────────────────────────────────────────────────────────

describe("registerClaude", () => {
  it("drives marketplace add → install on a fresh registration, skipping the market update/plugin update no-ops", () => {
    const tmp = makeTmp();
    const root = makeMarketplaceRoot();
    const fake = makeFakeClaude(tmp);
    try {
      const result = registerClaude({ root, claudeBin: fake.bin });
      assert.equal(result.marketplace, "jaybeeuu");
      assert.equal(result.plugin, "agent-cortex");
      assert.equal(result.dryRun, false);
      assert.equal(result.registered, true);
      assert.deepEqual(result.commands, [
        ["plugin", "marketplace", "add", root],
        ["plugin", "install", "agent-cortex@jaybeeuu", "-y"],
      ]);
      // The availability probe (`plugin --help`) and the state queries
      // (`marketplace list --json`, `plugin list --json`) are not actions.
      assert.deepEqual(actionsSince(fake.log), [
        `plugin marketplace add ${root}`,
        "plugin install agent-cortex@jaybeeuu -y",
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives marketplace and plugin names from the manifest", () => {
    const tmp = makeTmp();
    const root = makeMarketplaceRoot({ name: "scratchmkt", plugin: "scratchplug" });
    const fake = makeFakeClaude(tmp);
    try {
      const result = registerClaude({ root, claudeBin: fake.bin });
      assert.equal(result.marketplace, "scratchmkt");
      assert.equal(result.plugin, "scratchplug");
      const actions = actionsSince(fake.log);
      assert.ok(actions.some((c) => c === "plugin install scratchplug@scratchmkt -y"));
      // Fresh registration has no update commands.
      assert.ok(!actions.some((c) => c.startsWith("plugin update")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("re-running at the same materialised version is the update path: marketplace update only, no re-add or double-install", () => {
    const tmp = makeTmp();
    const root = makeMarketplaceRoot();
    const fake = makeFakeClaude(tmp);
    try {
      registerClaude({ root, claudeBin: fake.bin });
      assert.deepEqual(actionsSince(fake.log), [
        `plugin marketplace add ${root}`,
        "plugin install agent-cortex@jaybeeuu -y",
      ]);
      const run1End = callLines(fake.log).length;

      const second = registerClaude({ root, claudeBin: fake.bin });
      assert.equal(second.registered, true);
      // Second run: the marketplace is present so only the update path runs;
      // the plugin is already at the materialised version so nothing installs.
      assert.deepEqual(actionsSince(fake.log, run1End), ["plugin marketplace update jaybeeuu"]);
      assert.ok(second.skipped.some((s) => s.includes("already installed")));

      // Across both runs the marketplace was added exactly once and the
      // plugin installed exactly once.
      const all = actionsSince(fake.log);
      assert.equal(all.filter((c) => c.startsWith("plugin marketplace add")).length, 1);
      assert.equal(all.filter((c) => c === "plugin install agent-cortex@jaybeeuu -y").length, 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs plugin update when a newer version is materialised, refreshing the installed version", () => {
    const tmp = makeTmp();
    const root = makeMarketplaceRoot({ version: "1.0.0" });
    const fake = makeFakeClaude(tmp);
    try {
      registerClaude({ root, claudeBin: fake.bin });
      assert.deepEqual(actionsSince(fake.log), [
        `plugin marketplace add ${root}`,
        "plugin install agent-cortex@jaybeeuu -y",
      ]);
      const run1End = callLines(fake.log).length;

      // A new version is materialised into the source the marketplace exposes.
      writeFileSync(
        join(root, "claude", ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "agent-cortex", version: "2.0.0", description: "test plugin" }),
      );

      const updated = registerClaude({ root, claudeBin: fake.bin });
      assert.deepEqual(actionsSince(fake.log, run1End), [
        "plugin marketplace update jaybeeuu",
        "plugin update agent-cortex -y",
      ]);
      assert.ok(updated.skipped.some((s) => s.includes("already installed")));
      const state = JSON.parse(readFileSync(fake.state, "utf-8"));
      assert.equal(state.installed[0].version, "2.0.0", "plugin update refreshed the installed version");

      // At the new version another run is back to update-path-only.
      const run2End = callLines(fake.log).length;
      registerClaude({ root, claudeBin: fake.bin });
      assert.deepEqual(actionsSince(fake.log, run2End), ["plugin marketplace update jaybeeuu"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("--dry-run plans the commands without spawning claude at all", () => {
    const tmp = makeTmp();
    const root = makeMarketplaceRoot();
    const fake = makeFakeClaude(tmp);
    try {
      const result = registerClaude({ root, claudeBin: fake.bin, dryRun: true });
      assert.equal(result.dryRun, true);
      assert.equal(result.registered, true);
      // Dry-run cannot know live state without spawning — no commands decided.
      assert.deepEqual(result.commands, []);
      // No registration spawns happened at all in dry-run mode.
      assert.equal(existsSync(fake.log), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("defaults the claude binary to `claude` from PATH (dry-run only — no spawn)", () => {
    const root = makeMarketplaceRoot();
    try {
      const result = registerClaude({ root, dryRun: true });
      assert.equal(result.marketplace, "jaybeeuu");
      assert.equal(result.plugin, "agent-cortex");
      assert.equal(result.dryRun, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("warns with manual commands when the claude binary lacks the plugin subcommand; --require-register fails the run", () => {
    const tmp = makeTmp();
    const root = makeMarketplaceRoot();
    const fake = makeFakeClaude(tmp, { failWhen: "plugin --help" });
    try {
      const warnings = [];
      const result = registerClaude({ root, claudeBin: fake.bin, warn: (m) => warnings.push(m) });
      assert.equal(result.registered, false);
      const manual = warnings.join("\n");
      assert.match(manual, /NOT registered/);
      assert.match(manual, new RegExp(`claude plugin marketplace add ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(manual, /claude plugin install agent-cortex@jaybeeuu -y/);

      assert.throws(
        () => registerClaude({ root, claudeBin: fake.bin, requireRegister: true }),
        /require-register/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails, naming the failing command, when a claude plugin command errors", () => {
    const tmp = makeTmp();
    const root = makeMarketplaceRoot();
    const fake = makeFakeClaude(tmp, { failWhen: "plugin install" });
    try {
      assert.throws(
        () => registerClaude({ root, claudeBin: fake.bin }),
        /claude plugin install agent-cortex@jaybeeuu -y/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the checkout has no marketplace manifest", () => {
    const tmp = makeTmp();
    const root = mkdtempSync(join(tmpdir(), "agent-cortex-no-market-"));
    const fake = makeFakeClaude(tmp);
    try {
      assert.throws(
        () => registerClaude({ root, claudeBin: fake.bin }),
        /marketplace\.json/,
      );
      // The failed manifest read happens before any claude invocation.
      assert.equal(existsSync(fake.log), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
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
    assert.ok(stdout.includes("plugin marketplace update"));
    assert.ok(stdout.includes("plugin update agent-cortex"));
    assert.ok(/dry-run/i.test(stdout));
  });

  it("--output <dir> generates only — no registration plan is printed", async () => {
    const out = mkdtempSync(join(tmpdir(), "agent-cortex-cli-out-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "claude", "--output", out]);
      assert.equal(exitCode, 0);
      assert.doesNotMatch(stdout, /claude plugin/);
      assert.ok(stdout.includes("Generated"));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});