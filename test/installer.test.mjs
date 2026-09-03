// Integration tests for `agent-cortex install claude`: the install-time
// generator that materialises the Claude Code plugin. The default target is a
// home-scoped directory (~/.agent-cortex/claude, overridable via HOME for
// tests); all tests install into mkdtemp dirs — the real ~/.agent-cortex and
// the repo's committed claude/ subtree are never touched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  chmod,
  rm,
  readFile,
  readdir,
  stat,
  lstat,
  readlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { installClaude } from "../bin/installers/claude.mjs";

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

/** Run the CLI; optionally pass a custom env (e.g. a fake HOME). */
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

async function makeTmp() {
  return await mkdtemp(join(tmpdir(), "agent-cortex-installer-"));
}

/** A fake `claude` binary that records every argv line to log. */
async function makeFakeClaude(dir) {
  const bin = join(dir, "claude");
  const log = join(dir, "calls.log");
  await writeFile(
    bin,
    ["#!/bin/sh", `echo "$*" >> "${log}"`, "exit 0"].join("\n") + "\n",
  );
  await chmod(bin, 0o755);
  return { bin, log };
}

/** Deterministic snapshot of a generated tree: kind, and for files/symlinks
 * their byte content / link target. */
async function snapshot(dir) {
  const entries = [];
  const walk = async (p) => {
    for (const e of (await readdir(p, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(p, e.name);
      const rel = relative(dir, full);
      if (e.isSymbolicLink()) entries.push([rel, "link", await readlink(full)]);
      else if (e.isDirectory()) {
        entries.push([rel, "dir"]);
        await walk(full);
      } else entries.push([rel, "file", await readFile(full, "utf-8")]);
    }
  };
  await walk(dir);
  return entries;
}

async function listFiles(dir) {
  if (!(await pathExists(dir))) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(p)).map((f) => join(entry.name, f)));
    else out.push(entry.name);
  }
  return out;
}

describe("install claude", () => {
  it("composes agents from the composable sources (claude names, no tokens)", async () => {
    const out = await makeTmp();
    const { exitCode } = await runCli(["install", "claude", "--output", out]);
    assert.equal(exitCode, 0);

    const plan = await readFile(join(out, "agents", "plan.md"), "utf-8");
    assert.match(plan, /^---\n# GENERATED from agents\/plan\//);
    // provenance names the shared installer (no build-time script), so the
    // committed subtree can only come from the install-time generator.
    assert.match(plan, /bin\/installers\/claude\.mjs/);
    assert.doesNotMatch(plan, /build-claude-agents/);
    assert.match(plan, /\nname: plan\n/);
    assert.doesNotMatch(plan, /\{\{(TOOL|PATH|SECTION):/);

    const ralphPlan = await readFile(join(out, "agents", "ralph-plan.md"), "utf-8");
    assert.match(ralphPlan, /^---\n# GENERATED from agents\/ralph-plan\//);
    assert.match(ralphPlan, /\nname: ralph-plan\n/);
  });

  it("copies native agents verbatim (ralph stays native, no composed counterpart)", async () => {
    const out = await makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const native = await readFile(join(ROOT, "agents-native", "ralph.md"), "utf-8");
    assert.equal(await readFile(join(out, "agents", "ralph.md"), "utf-8"), native);
  });

  it("copies skill dirs flat with substituted tokens, no symlinks, excluding ralph-coupled skills", async () => {
    const out = await makeTmp();
    const { exitCode } = await runCli(["install", "claude", "--output", out]);
    assert.equal(exitCode, 0);

    const skills = join(out, "skills");
    const names = await readdir(skills);
    assert.ok(names.includes("tdd"));
    assert.ok(names.includes("plan"));
    assert.ok(!names.includes("ralph"));
    assert.ok(!names.includes("run-pipeline-stage"));

    // skills are real directories (copies), not symlinks
    assert.ok((await stat(join(skills, "tdd"))).isDirectory());
    assert.ok(await pathExists(join(skills, "tdd", "SKILL.md")));
    assert.ok(!(await lstat(join(skills, "plan"))).isSymbolicLink());

    // no symlinks anywhere in the materialised tree
    for (const e of await snapshot(out)) {
      assert.notEqual(e[1], "link", `unexpected symlink in tree: ${e[0]}`);
    }

    // tokens substituted against the claude column
    const techDir = await readFile(join(skills, "technical-direction", "SKILL.md"), "utf-8");
    assert.ok(techDir.includes("using Grep, Read, and Glob"), "rg/view/glob mapped to Grep/Read/Glob");
    assert.ok(techDir.includes("via WebFetch"), "web_fetch mapped to WebFetch");
    assert.doesNotMatch(techDir, /\{\{TOOL:/);

    // null-mapped tool dropped from prose (claude has no read_agent step)
    const design = await readFile(join(skills, "design-an-interface", "SKILL.md"), "utf-8");
    assert.ok(design.includes("with Task,"), "task mapped to Task");
    assert.doesNotMatch(design, /\{\{TOOL:|read_agent/);
  });

  it("leaves no literal tokens in any installed skill markdown", async () => {
    const out = await makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const files = (await listFiles(join(out, "skills"))).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0);
    for (const f of files) {
      const content = await readFile(join(out, "skills", f), "utf-8");
      assert.doesNotMatch(content, /\{\{TOOL:|\{\{PATH:/, `no literal tokens in skill ${f}`);
    }
  });

  it("copies hand-authored plugin extras (.mcp.json, scripts/) from the repo subtree", async () => {
    const out = await makeTmp();
    await runCli(["install", "claude", "--output", out]);

    const mcp = await readFile(join(ROOT, "claude", ".mcp.json"), "utf-8");
    assert.equal(await readFile(join(out, ".mcp.json"), "utf-8"), mcp);

    const statusline = await readFile(join(ROOT, "claude", "scripts", "statusline-command.sh"), "utf-8");
    assert.equal(await readFile(join(out, "scripts", "statusline-command.sh"), "utf-8"), statusline);
  });

  it("generates plugin.json tracking the package version and referencing hooks.json", async () => {
    const out = await makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const pkgVersion = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8")).version;
    const plugin = JSON.parse(await readFile(join(out, ".claude-plugin", "plugin.json"), "utf-8"));
    assert.equal(plugin.name, "agent-cortex");
    assert.equal(plugin.version, pkgVersion);
    assert.equal(plugin.hooks, "./hooks.json");
  });

  it("generates hooks.json from the canonical hooks/claude/ source", async () => {
    const out = await makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const source = JSON.parse(await readFile(join(ROOT, "hooks", "claude", "hooks.json"), "utf-8"));
    const installed = JSON.parse(await readFile(join(out, "hooks.json"), "utf-8"));
    assert.deepStrictEqual(installed, source);
    assert.ok(source.hooks.SessionStart);
  });

  it("matches the Notification hook only on documented notification types", async () => {
    // The Notification matcher is an exact-string list over `notification_type` —
    // there are no success/error types, so that matcher would never fire. Guard
    // against it recurring (see docs/claude-hooks.md for the documented type list).
    const out = await makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const installed = JSON.parse(await readFile(join(out, "hooks.json"), "utf-8"));
    const matcher = installed.hooks.Notification.flatMap((g) => g.hooks).length
      ? installed.hooks.Notification[0].matcher
      : "";
    const documented = new Set([
      "permission_prompt",
      "idle_prompt",
      "auth_success",
      "elicitation_dialog",
      "elicitation_url_dialog",
      "elicitation_complete",
      "elicitation_response",
      "agent_needs_input",
      "agent_completed",
      "quota_auto_resume_fired",
      "quota_auto_resume_stale",
      "quota_auto_resume_disabled",
    ]);
    const types = matcher ? matcher.split("|") : [];
    assert.ok(types.length > 0, "Notification hook should list at least one matcher type");
    for (const t of types) {
      assert.ok(documented.has(t), `Notification matcher references unknown type "${t}"`);
    }
  });

  it("bundles hook support scripts into hooks/ and references them via the plugin root", async () => {
    const out = await makeTmp();
    await runCli(["install", "claude", "--output", out]);

    const canonical = await readFile(join(ROOT, "hooks", "claude", "scripts", "notify.mjs"), "utf-8");
    const bundled = await readFile(join(out, "hooks", "scripts", "notify.mjs"), "utf-8");
    assert.equal(bundled, canonical);

    const installed = JSON.parse(await readFile(join(out, "hooks.json"), "utf-8"));
    const notify = installed.hooks.Notification.flatMap((g) => g.hooks)
      .filter((h) => h.command?.includes("notify.mjs"));
    assert.ok(notify.length === 1, "hooks.json should reference the notification script");
    assert.match(notify[0].command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/scripts\/notify\.mjs"$/);
  });

  it("is deterministic across repeated installs into the same output", async () => {
    const out = await makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const first = await snapshot(out);
    await runCli(["install", "claude", "--output", out]);
    assert.deepStrictEqual(await snapshot(out), first);
  });

  it("--dry-run reports the plan (copied skills, output target) without writing anything", async () => {
    const out = await makeTmp();
    const { exitCode, stdout } = await runCli(["install", "claude", "--output", out, "--dry-run"]);
    assert.equal(exitCode, 0);
    assert.ok(/would/i.test(stdout));
    assert.ok(/copied/i.test(stdout), "dry-run should describe skills as copied, not symlinked");
    assert.ok(stdout.includes(out), "dry-run should name the output target");
    assert.equal(await pathExists(join(out, "agents")), false);
    assert.equal(await pathExists(join(out, "skills")), false);
    assert.equal(await pathExists(join(out, ".claude-plugin")), false);
  });

  it("leaves the committed claude/ subtree and repo marketplace manifest untouched", async () => {
    const out = await makeTmp();
    const beforeSkills = (await readdir(join(ROOT, "claude", "skills"))).sort();
    const beforePlugin = await readFile(join(ROOT, "claude", ".claude-plugin", "plugin.json"), "utf-8");
    const beforeMarket = await readFile(join(ROOT, ".claude-plugin", "marketplace.json"), "utf-8");
    await runCli(["install", "claude", "--output", out]);
    assert.deepStrictEqual((await readdir(join(ROOT, "claude", "skills"))).sort(), beforeSkills);
    assert.equal(await readFile(join(ROOT, "claude", ".claude-plugin", "plugin.json"), "utf-8"), beforePlugin);
    assert.equal(await readFile(join(ROOT, ".claude-plugin", "marketplace.json"), "utf-8"), beforeMarket);
  });

  it("plain install materialises into ~/.agent-cortex/claude with a marketplace manifest and drives the claude plugin CLI", async () => {
    const fakeHome = await makeTmp();
    const fakeBin = await makeTmp();
    const fake = await makeFakeClaude(fakeBin);
    const env = { HOME: fakeHome, PATH: `${fakeBin}:${process.env.PATH}` };

    const { exitCode, stdout } = await runCli(["install", "claude"], env);
    assert.equal(exitCode, 0);

    const pluginDir = join(fakeHome, ".agent-cortex", "claude");
    // plugin materialised into the home install root
    assert.ok(await pathExists(join(pluginDir, "skills", "tdd", "SKILL.md")), "skill copied into home plugin");
    assert.ok((await stat(join(pluginDir, "skills", "tdd"))).isDirectory(), "home skills are copies, not symlinks");
    // hand-authored extras shipped into the home plugin
    assert.equal(
      await readFile(join(pluginDir, ".mcp.json"), "utf-8"),
      await readFile(join(ROOT, "claude", ".mcp.json"), "utf-8"),
    );

    // marketplace manifest at the home root exposes ./claude
    const marketPath = join(fakeHome, ".agent-cortex", ".claude-plugin", "marketplace.json");
    const market = JSON.parse(await readFile(marketPath, "utf-8"));
    assert.equal(market.name, "jaybeeuu");
    assert.deepStrictEqual(market.plugins, [
      {
        name: "agent-cortex",
        source: "./claude",
        description: "Personal Claude Code plugin with custom agents and skills",
      },
    ]);

    // registration drove the claude plugin CLI against the home install root
    const calls = (await readFile(fake.log, "utf-8")).trim().split("\n");
    const registration = calls.filter((c) => !c.startsWith("plugin --help"));
    assert.deepEqual(registration, [
      `plugin marketplace add ${join(fakeHome, ".agent-cortex")}`,
      "plugin install agent-cortex@jaybeeuu -y",
      "plugin marketplace update jaybeeuu",
      "plugin update agent-cortex -y",
    ]);
    assert.ok(stdout.includes("Registering plugin"), "CLI reports registration");
  });

  it("plain --dry-run prints the home target and copied-skill plan without writing", async () => {
    const fakeHome = await makeTmp();
    const fakeBin = await makeTmp();
    await makeFakeClaude(fakeBin);
    const env = { HOME: fakeHome, PATH: `${fakeBin}:${process.env.PATH}` };

    const { exitCode, stdout } = await runCli(["install", "claude", "--dry-run"], env);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes(join(fakeHome, ".agent-cortex", "claude")), "dry-run names the home target");
    assert.ok(/copied/i.test(stdout), "dry-run describes copied skills");
    assert.equal(await pathExists(join(fakeHome, ".agent-cortex")), false, "nothing written in dry-run");
  });

  it("rejects token-map.json versions newer than the implemented contract", async () => {
    const fixture = await makeTmp();
    try {
      await mkdir(join(fixture, "agents"), { recursive: true });
      await writeFile(
        join(fixture, "token-map.json"),
        JSON.stringify({ name: "fixture", version: 99, tools: {}, paths: {} }),
      );
      await assert.rejects(
        installClaude({ root: fixture, output: join(fixture, "out") }),
        /version 99/,
      );
      assert.equal(await pathExists(join(fixture, "out")), false, "nothing written when the contract is rejected");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});