// Integration tests for `agent-cortex install claude`: the install-time
// generator that materialises the Claude Code plugin. The default target is a
// home-scoped directory (~/.agent-cortex/claude, overridable via HOME for
// tests); all tests install into mkdtemp dirs — the real ~/.agent-cortex and
// the repo's committed claude/ subtree are never touched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  lstatSync,
  readlinkSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { installClaude } from "../bin/installers/claude.mjs";
import { makeFakeClaude, registrationActions } from "./helpers/fake-claude.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PATH = join(ROOT, "bin", "agent-cortex.mjs");

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

function makeTmp() {
  return mkdtempSync(join(tmpdir(), "agent-cortex-installer-"));
}

/** Deterministic snapshot of a generated tree: kind, and for files/symlinks
 * their byte content / link target. */
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

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p).map((f) => join(entry.name, f)));
    else out.push(entry.name);
  }
  return out;
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

  it("copies skill dirs flat with substituted tokens, no symlinks, excluding ralph-coupled skills", async () => {
    const out = makeTmp();
    const { exitCode } = await runCli(["install", "claude", "--output", out]);
    assert.equal(exitCode, 0);

    const skills = join(out, "skills");
    const names = readdirSync(skills);
    assert.ok(names.includes("tdd"));
    assert.ok(names.includes("plan"));
    assert.ok(!names.includes("ralph"));
    assert.ok(!names.includes("run-pipeline-stage"));

    // skills are real directories (copies), not symlinks
    assert.ok(statSync(join(skills, "tdd")).isDirectory());
    assert.ok(existsSync(join(skills, "tdd", "SKILL.md")));
    assert.ok(!lstatSync(join(skills, "plan")).isSymbolicLink());

    // no symlinks anywhere in the materialised tree
    for (const e of snapshot(out)) {
      assert.notEqual(e[1], "link", `unexpected symlink in tree: ${e[0]}`);
    }

    // tokens substituted against the claude column
    const techDir = readFileSync(join(skills, "technical-direction", "SKILL.md"), "utf-8");
    assert.ok(techDir.includes("using Grep, Read, and Glob"), "rg/view/glob mapped to Grep/Read/Glob");
    assert.ok(techDir.includes("via WebFetch"), "web_fetch mapped to WebFetch");
    assert.doesNotMatch(techDir, /\{\{TOOL:/);

    // null-mapped tool dropped from prose (claude has no read_agent step)
    const design = readFileSync(join(skills, "design-an-interface", "SKILL.md"), "utf-8");
    assert.ok(design.includes("with Task,"), "task mapped to Task");
    assert.doesNotMatch(design, /\{\{TOOL:|read_agent/);
  });

  it("leaves no literal tokens in any installed skill markdown", async () => {
    const out = makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const files = listFiles(join(out, "skills")).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0);
    for (const f of files) {
      const content = readFileSync(join(out, "skills", f), "utf-8");
      assert.doesNotMatch(content, /\{\{TOOL:|\{\{PATH:/, `no literal tokens in skill ${f}`);
    }
  });

  it("copies hand-authored plugin extras (.mcp.json, scripts/) from the repo subtree", async () => {
    const out = makeTmp();
    await runCli(["install", "claude", "--output", out]);

    const mcp = readFileSync(join(ROOT, "claude", ".mcp.json"), "utf-8");
    assert.equal(readFileSync(join(out, ".mcp.json"), "utf-8"), mcp);

    const statusline = readFileSync(join(ROOT, "claude", "scripts", "statusline-command.sh"), "utf-8");
    assert.equal(readFileSync(join(out, "scripts", "statusline-command.sh"), "utf-8"), statusline);
  });

  it("preserves hand-authored extras when the output IS the canonical subtree (build:claude)", () => {
    // `pnpm build:claude` regenerates INTO root/claude — the canonical store
    // the extras are read from. The write-phase cleanup must not delete
    // .mcp.json/scripts/ before they are read back, or regeneration silently
    // destroys the committed extras at source.
    const root = makeTmp();
    const claude = join(root, "claude");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "agent-cortex", version: "1.2.3", license: "MIT" }),
    );
    writeFileSync(
      join(root, "token-map.json"),
      JSON.stringify({ tools: {}, paths: { plugin_root: { claude: "PLUGIN_ROOT" } } }),
    );
    mkdirSync(join(root, "agents"));
    mkdirSync(join(root, "skills"));
    mkdirSync(join(claude, "scripts"), { recursive: true });
    writeFileSync(join(claude, ".mcp.json"), JSON.stringify({ mcpServers: {} }, null, 2) + "\n");
    writeFileSync(join(claude, "scripts", "statusline-command.sh"), "#!/bin/sh\necho status\n");
    chmodSync(join(claude, "scripts", "statusline-command.sh"), 0o755);

    const result = installClaude({ root, output: claude });

    assert.deepEqual(result.handAuthored, [".mcp.json", "scripts/statusline-command.sh"]);
    assert.ok(existsSync(join(claude, ".mcp.json")), ".mcp.json survives regeneration of the canonical subtree");
    assert.ok(
      existsSync(join(claude, "scripts", "statusline-command.sh")),
      "scripts/statusline-command.sh survives regeneration of the canonical subtree",
    );
    assert.equal(
      statSync(join(claude, "scripts", "statusline-command.sh")).mode & 0o111,
      0o111,
      "executable bit survives regeneration of the canonical subtree",
    );
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

  it("matches the Notification hook only on documented notification types", async () => {
    // The Notification matcher is an exact-string list over `notification_type` —
    // there are no success/error types, so that matcher would never fire. Guard
    // against it recurring (see docs/claude-hooks.md for the documented type list).
    const out = makeTmp();
    await runCli(["install", "claude", "--output", out]);
    const installed = JSON.parse(readFileSync(join(out, "hooks.json"), "utf-8"));
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

  it("--dry-run reports the plan (copied skills, output target) without writing anything", async () => {
    const out = makeTmp();
    const { exitCode, stdout } = await runCli(["install", "claude", "--output", out, "--dry-run"]);
    assert.equal(exitCode, 0);
    assert.ok(/would/i.test(stdout));
    assert.ok(/copied/i.test(stdout), "dry-run should describe skills as copied, not symlinked");
    assert.ok(stdout.includes(out), "dry-run should name the output target");
    assert.equal(existsSync(join(out, "agents")), false);
    assert.equal(existsSync(join(out, "skills")), false);
    assert.equal(existsSync(join(out, ".claude-plugin")), false);
  });

  it("leaves the committed claude/ subtree and repo marketplace manifest untouched", async () => {
    const out = makeTmp();
    const beforeSkills = readdirSync(join(ROOT, "claude", "skills")).sort();
    const beforePlugin = readFileSync(join(ROOT, "claude", ".claude-plugin", "plugin.json"), "utf-8");
    const beforeMarket = readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf-8");
    await runCli(["install", "claude", "--output", out]);
    assert.deepStrictEqual(readdirSync(join(ROOT, "claude", "skills")).sort(), beforeSkills);
    assert.equal(readFileSync(join(ROOT, "claude", ".claude-plugin", "plugin.json"), "utf-8"), beforePlugin);
    assert.equal(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf-8"), beforeMarket);
  });

  it("plain install materialises into ~/.agent-cortex/claude with a marketplace manifest and drives the claude plugin CLI", async () => {
    const fakeHome = makeTmp();
    const fakeBin = makeTmp();
    const fake = makeFakeClaude(fakeBin);
    const env = { HOME: fakeHome, PATH: `${fakeBin}:${process.env.PATH}` };

    const { exitCode, stdout } = await runCli(["install", "claude"], env);
    assert.equal(exitCode, 0);

    const pluginDir = join(fakeHome, ".agent-cortex", "claude");
    // plugin materialised into the home install root
    assert.ok(existsSync(join(pluginDir, "skills", "tdd", "SKILL.md")), "skill copied into home plugin");
    assert.ok(statSync(join(pluginDir, "skills", "tdd")).isDirectory(), "home skills are copies, not symlinks");
    // hand-authored extras shipped into the home plugin
    assert.equal(
      readFileSync(join(pluginDir, ".mcp.json"), "utf-8"),
      readFileSync(join(ROOT, "claude", ".mcp.json"), "utf-8"),
    );

    // marketplace manifest at the home root exposes ./claude
    const marketPath = join(fakeHome, ".agent-cortex", ".claude-plugin", "marketplace.json");
    const market = JSON.parse(readFileSync(marketPath, "utf-8"));
    assert.equal(market.name, "jaybeeuu");
    assert.deepStrictEqual(market.plugins, [
      {
        name: "agent-cortex",
        source: "./claude",
        description: "Personal Claude Code plugin with custom agents and skills",
      },
    ]);

    // registration drove the claude plugin CLI against the home install root:
    // fresh state → marketplace add + plugin install (state queries and the
    // availability probe are not registration actions).
    const calls = readFileSync(fake.log, "utf-8").trim().split("\n");
    assert.deepEqual(registrationActions(calls), [
      `plugin marketplace add ${join(fakeHome, ".agent-cortex")}`,
      "plugin install agent-cortex@jaybeeuu -y",
    ]);
    assert.ok(stdout.includes("Registering plugin"), "CLI reports registration");
  });

  it("re-running a plain install is the update path: no marketplace re-add, no double-install", async () => {
    const fakeHome = makeTmp();
    const fakeBin = makeTmp();
    const fake = makeFakeClaude(fakeBin);
    const env = { HOME: fakeHome, PATH: `${fakeBin}:${process.env.PATH}` };
    const allCalls = () => readFileSync(fake.log, "utf-8").trim().split("\n").filter(Boolean);

    const first = await runCli(["install", "claude"], env);
    assert.equal(first.exitCode, 0);
    assert.deepEqual(registrationActions(allCalls()), [
      `plugin marketplace add ${join(fakeHome, ".agent-cortex")}`,
      "plugin install agent-cortex@jaybeeuu -y",
    ]);
    const run1End = allCalls().length;

    // Second run: marketplace registered, plugin at the materialised version →
    // marketplace update only — the documented no-op update path.
    const second = await runCli(["install", "claude"], env);
    assert.equal(second.exitCode, 0);
    assert.deepEqual(registrationActions(allCalls().slice(run1End)), [
      "plugin marketplace update jaybeeuu",
    ]);

    // Across both runs the marketplace was added exactly once and the plugin
    // installed exactly once (idempotent — no re-add, no double-install).
    const all = registrationActions(allCalls());
    assert.equal(all.filter((c) => c.startsWith("plugin marketplace add")).length, 1);
    assert.equal(all.filter((c) => c === "plugin install agent-cortex@jaybeeuu -y").length, 1);
  });

  it("warns with manual commands when the claude CLI is missing; --require-register fails the run", async () => {
    const fakeHome = makeTmp();
    const env = { HOME: fakeHome, PATH: "/nonexistent" };

    // Default: warn-only — the plugin is materialised, exit 0, manual
    // registration commands printed for the user to run.
    const warned = await runCli(["install", "claude"], env);
    assert.equal(warned.exitCode, 0, "missing claude CLI is warn-only by default");
    assert.match(warned.stderr, /NOT registered/);
    assert.match(warned.stderr, /claude plugin marketplace add /);
    assert.match(warned.stderr, /claude plugin install agent-cortex@jaybeeuu -y/);
    // The plugin itself is still materialised into the fake home.
    assert.ok(existsSync(join(fakeHome, ".agent-cortex", "claude", "skills", "tdd", "SKILL.md")));

    // --require-register escalates the same failure to a non-zero exit.
    const required = await runCli(["install", "claude", "--require-register"], env);
    assert.equal(required.exitCode, 1);
    assert.match(required.stderr, /require-register/);
  });

  it("plain --dry-run prints the home target and copied-skill plan without writing", async () => {
    const fakeHome = makeTmp();
    const fakeBin = makeTmp();
    makeFakeClaude(fakeBin);
    const env = { HOME: fakeHome, PATH: `${fakeBin}:${process.env.PATH}` };

    const { exitCode, stdout } = await runCli(["install", "claude", "--dry-run"], env);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes(join(fakeHome, ".agent-cortex", "claude")), "dry-run names the home target");
    assert.ok(/copied/i.test(stdout), "dry-run describes copied skills");
    assert.equal(existsSync(join(fakeHome, ".agent-cortex")), false, "nothing written in dry-run");
  });

  it("rejects token-map.json versions newer than the implemented contract", async () => {
    const fixture = makeTmp();
    try {
      mkdirSync(join(fixture, "agents"), { recursive: true });
      writeFileSync(
        join(fixture, "token-map.json"),
        JSON.stringify({ name: "fixture", version: 99, tools: {}, paths: {} }),
      );
      assert.throws(
        () => installClaude({ root: fixture, output: join(fixture, "out") }),
        /version 99/,
      );
      assert.equal(existsSync(join(fixture, "out")), false, "nothing written when the contract is rejected");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});