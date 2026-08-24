// Integration tests for `agent-cortex install claude`: the install-time
// generator for the Claude Code plugin subtree. All tests install into
// mkdtemp dirs so the real repo claude/ and ~/.claude are never touched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PATH = join(ROOT, "bin", "agent-cortex.mjs");

function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], (error, stdout, stderr) => {
      resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr });
    });
  });
}

function makeTmp() {
  return mkdtempSync(join(tmpdir(), "agent-cortex-installer-"));
}

/** Deterministic snapshot of a generated tree: relative paths, kind, and for
 * files/symlinks their byte content / link target. */
function snapshot(dir) {
  const entries = [];
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(p, e.name);
      const rel = relative(dir, full);
      if (e.isSymbolicLink()) entries.push([rel, "link", readlinkSync(full)]);
      else if (e.isDirectory()) {
        entries.push([rel, "dir"]);
        walk(full);
      } else entries.push([rel, "file", readFileSync(full, "utf-8")]);
    }
  };
  walk(dir);
  return entries;
}

describe("install claude", () => {
  it("composes agents from the composable sources (claude names, no tokens)", async () => {
    const out = makeTmp();
    const { exitCode } = await runCli(["install", "claude", "--output", out]);
    assert.equal(exitCode, 0);

    const plan = readFileSync(join(out, "agents", "plan.md"), "utf-8");
    assert.match(plan, /^---\n# GENERATED from agents\/plan\//);
    // provenance names the shared installer (no build-time script), so the
    // committed subtree can only come from the install-time generator.
    assert.match(plan, /bin\/installers\/claude\.mjs/);
    assert.doesNotMatch(plan, /build-claude-agents/);
    assert.match(plan, /\nname: plan\n/);
    assert.doesNotMatch(plan, /\{\{(TOOL|PATH|SECTION):/);

    const ralphPlan = readFileSync(join(out, "agents", "ralph-plan.md"), "utf-8");
    assert.match(ralphPlan, /^---\n# GENERATED from agents\/ralph-plan\//);
    assert.match(ralphPlan, /\nname: ralph-plan\n/);
  });

  it("copies native agents verbatim (ralph stays native, no composed counterpart)", async () => {
    const out = makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const native = readFileSync(join(ROOT, "agents-native", "ralph.md"), "utf-8");
    assert.equal(readFileSync(join(out, "agents", "ralph.md"), "utf-8"), native);
  });

  it("symlinks flattened skills and excludes ralph-coupled skills", async () => {
    const out = makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const skills = join(out, "skills");
    const names = readdirSync(skills);
    assert.ok(names.includes("tdd"));
    assert.ok(names.includes("plan"));
    assert.ok(!names.includes("ralph"));
    assert.ok(!names.includes("run-pipeline-stage"));
    assert.ok(lstatSync(join(skills, "tdd")).isSymbolicLink());
    assert.equal(realpathSync(join(skills, "tdd")), realpathSync(join(ROOT, "skills", "engineering", "tdd")));
  });

  it("generates plugin.json tracking the package version and referencing hooks.json", async () => {
    const out = makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")).version;
    const plugin = JSON.parse(readFileSync(join(out, ".claude-plugin", "plugin.json"), "utf-8"));
    assert.equal(plugin.name, "agent-cortex");
    assert.equal(plugin.version, pkgVersion);
    assert.equal(plugin.hooks, "./hooks.json");
  });

  it("generates hooks.json from the canonical hooks/claude/ source", async () => {
    const out = makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const source = JSON.parse(readFileSync(join(ROOT, "hooks", "claude", "hooks.json"), "utf-8"));
    const installed = JSON.parse(readFileSync(join(out, "hooks.json"), "utf-8"));
    assert.deepStrictEqual(installed, source);
    assert.ok(source.hooks.SessionStart);
  });

  it("bundles hook support scripts into claude/hooks/ and references them via the plugin root", async () => {
    const out = makeTmp();
    await runCli(["install", "claude", "--output", out]);

    const canonical = readFileSync(join(ROOT, "hooks", "claude", "scripts", "notify.mjs"), "utf-8");
    const bundled = readFileSync(join(out, "hooks", "scripts", "notify.mjs"), "utf-8");
    assert.equal(bundled, canonical);

    const installed = JSON.parse(readFileSync(join(out, "hooks.json"), "utf-8"));
    const notify = installed.hooks.Notification.flatMap((g) => g.hooks)
      .filter((h) => h.command?.includes("notify.mjs"));
    assert.ok(notify.length === 1, "hooks.json should reference the notification script");
    assert.match(notify[0].command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/scripts\/notify\.mjs"$/);
  });

  it("is deterministic across repeated installs into the same output", async () => {
    const out = makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const first = snapshot(out);
    await runCli(["install", "claude", "--output", out]);
    assert.deepStrictEqual(snapshot(out), first);
  });

  it("--dry-run reports the plan without writing anything", async () => {
    const out = makeTmp();
    const { exitCode, stdout } = await runCli(["install", "claude", "--output", out, "--dry-run"]);
    assert.equal(exitCode, 0);
    assert.ok(/would/i.test(stdout));
    assert.equal(existsSync(join(out, "agents")), false);
    assert.equal(existsSync(join(out, "skills")), false);
    assert.equal(existsSync(join(out, ".claude-plugin")), false);
  });

  it("leaves the committed claude/ subtree untouched when --output is given", async () => {
    const out = makeTmp();
    const beforeSkills = readdirSync(join(ROOT, "claude", "skills")).sort();
    const beforePlugin = readFileSync(join(ROOT, "claude", ".claude-plugin", "plugin.json"), "utf-8");
    await runCli(["install", "claude", "--output", out]);
    assert.deepStrictEqual(readdirSync(join(ROOT, "claude", "skills")).sort(), beforeSkills);
    assert.equal(readFileSync(join(ROOT, "claude", ".claude-plugin", "plugin.json"), "utf-8"), beforePlugin);
  });
});