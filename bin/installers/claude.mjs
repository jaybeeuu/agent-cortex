// Install-time generator + registrar for the Claude Code plugin. Producing
// claude/ from the canonical sources is the ONLY code path — there is no
// separate build-time generator: the package script `pnpm build:claude` runs
// the same command as the CLI with `--output` (`node bin/agent-cortex.mjs
// install claude --output claude`), so the committed subtree and installer
// output can never diverge:
//
//   node bin/agent-cortex.mjs install claude        regenerates claude/ in place
//                               AND registers the plugin with Claude Code via
//                               the `claude plugin` CLI (marketplace add →
//                               install → marketplace update → plugin update)
//   node bin/agent-cortex.mjs install claude --output <dir>
//                               generates only — no runtime registration
//   node bin/agent-cortex.mjs install claude --dry-run
//                               plans generation + registration without writing
//
// claude/ stays committed (not gitignored): registration points Claude Code's
// marketplace at this checkout (`.claude-plugin/marketplace.json` exposes
// ./claude), so the plugin content is the working tree and a fresh clone
// installs as-is with no generation step. CI regenerates claude/ via
// `--output` and runs `git diff --exit-code claude/...` — byte-for-byte
// validation that the committed output equals installer output, catching stale
// output and hand-edits to generated files alike.
//
// Generated from:
//   claude/agents/<slug>.md          agents/<name>/agent.md +
//                                    agents/<name>/claude/frontmatter.json +
//                                    agents/<name>/claude/<section>.md ({{SECTION:...}}),
//                                    with {{TOOL:...}}/{{PATH:...}} substituted against
//                                    the claude column of token-map.json. Agents in the
//                                    DEFER set ship instead from agents-native/<name>.md.
//   claude/skills/<name>             symlinks to the grouped skills/<group>/<name> dirs
//                                    (single source — Claude scans skills one level deep)
//   claude/.claude-plugin/plugin.json  name/version/description from package.json
//                                    (version tracks the package — never stale)
//   claude/hooks.json                copied from hooks/claude/hooks.json when present
//   claude/hooks/<scripts>           copied from hooks/claude/ (support files bundled
//                                    alongside hooks.json, referenced via ${CLAUDE_PLUGIN_ROOT})
//
// The claude/ subtree stays committed and CI drift-checks it (build:claude +
// git diff --exit-code), so a fresh clone remains installable as-is. Hand-authored
// support files under claude/ (claude/.mcp.json, claude/scripts/) are left untouched.
//
// Zero dependencies so it runs on the CI Node and local Node alike.

import { readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, statSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeAgent } from "../../scripts/lib/compose-agent.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(MODULE_DIR, "..", "..");

// Agents NOT transformed from the composable sources. `ralph` is authored natively for Claude
// instead (agents-native/ralph.md) — its event-driven orchestration can't be produced by
// section composition from the poll-loop sources.
const DEFER = new Set(["ralph"]);

// Ralph-coupled Copilot skills that don't apply to the lean Claude Ralph (and carry dead
// ~/.copilot orchestration paths). Not symlinked into the Claude plugin.
const SKILL_EXCLUDE = new Set(["ralph", "run-pipeline-stage"]);

const NAME_PREFIX = "agent-cortex:";

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function byName(a, b) {
  return a.localeCompare(b);
}

/** Compose agents from agents/<name>/; DEFERed agents come from agents-native/ instead. */
function buildAgents(root) {
  const files = [];
  const skipped = [];
  const entries = readdirSync(join(root, "agents"), { withFileTypes: true }).sort((a, b) => byName(a.name, b.name));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, "agents", entry.name);
    if (!isFile(join(dir, "agent.md")) || !isFile(join(dir, "claude", "frontmatter.json"))) continue;

    if (DEFER.has(entry.name)) {
      skipped.push(entry.name);
      continue;
    }

    const fm = composeAgent(root, entry.name, "claude");
    const slug = fm.name.startsWith(NAME_PREFIX) ? fm.name.slice(NAME_PREFIX.length) : fm.name;
    const header =
      `---\n` +
      `# GENERATED from agents/${entry.name}/ by bin/installers/claude.mjs — DO NOT EDIT.\n` +
      `name: ${slug}\n` +
      `description: ${JSON.stringify(fm.description)}\n` +
      `tools: ${fm.tools.join(", ")}\n` +
      `---\n`;
    files.push({ file: `${slug}.md`, content: `${header}\n${fm.body}\n` });
  }
  return { files, skipped };
}

/** Copy hand-authored Claude-native agents into claude/agents/ verbatim. */
function buildNatives(root, nativeSrc) {
  const files = [];
  if (!existsSync(nativeSrc)) return files;
  for (const file of readdirSync(nativeSrc).filter((f) => f.endsWith(".md")).sort(byName)) {
    files.push({ file, content: readFileSync(join(nativeSrc, file), "utf-8") });
  }
  return files;
}

/** Flatten grouped skills (skills/<group>/<name>/) into claude/skills/ as relative symlinks. */
function buildSkills(root) {
  const links = [];
  const seen = new Map();
  for (const group of readdirSync(join(root, "skills")).sort(byName)) {
    const groupDir = join(root, "skills", group);
    if (!statSync(groupDir).isDirectory()) continue;
    for (const name of readdirSync(groupDir).sort(byName)) {
      const skillDir = join(groupDir, name);
      if (!isFile(join(skillDir, "SKILL.md"))) continue;
      if (SKILL_EXCLUDE.has(name)) continue;
      if (seen.has(name)) {
        throw new Error(`duplicate skill name "${name}" (${seen.get(name)} and ${group}) — names must be unique when flattened`);
      }
      seen.set(name, group);
      links.push({ name, target: skillDir });
    }
  }
  return links;
}

/** plugin.json manifest; version tracks the package so it can never go stale. */
function buildPluginJson(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  return (
    JSON.stringify(
      {
        name: "agent-cortex",
        version: pkg.version,
        description: "Personal Claude Code plugin with custom agents and skills",
        author: { name: "jaybeeuu" },
        license: pkg.license ?? "MIT",
        repository: pkg.repository,
        hooks: "./hooks.json",
      },
      null,
      2,
    ) + "\n"
  );
}

/**
 * Hook support files (hooks/claude/ except hooks.json) bundled into
 * claude/hooks/ so hook commands can reference them via ${CLAUDE_PLUGIN_ROOT}.
 * hooks.json itself is special-cased to the plugin root (claude/hooks.json).
 */
function buildHookFiles(root) {
  const files = [];
  const srcDir = join(root, "hooks", "claude");
  if (!existsSync(srcDir)) return files;
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, join(rel, entry.name));
      else if (entry.name !== "hooks.json")
        files.push({ rel: join(rel, entry.name), content: readFileSync(full, "utf-8") });
    }
  };
  walk(srcDir, "");
  return files;
}

/**
 * Generate the Claude Code plugin subtree.
 *
 * @param {object} options
 * @param {string} [options.root]   Package root (contains agents/, skills/, token-map.json, …).
 *                                  Defaults to the repo containing this module.
 * @param {string} [options.output] Target directory (default: <root>/claude).
 * @param {boolean} [options.dryRun] Plan and report without writing anything.
 * @returns {{ output: string, agents: string[], natives: string[], skills: string[], hooks: boolean, dryRun: boolean }}
 */
export function installClaude({ root = DEFAULT_ROOT, output, dryRun = false } = {}) {
  const out = output ?? join(root, "claude");

  const agents = buildAgents(root);
  const natives = buildNatives(root, join(root, "agents-native"));
  const skills = buildSkills(root);
  const pluginJson = buildPluginJson(root);
  const hooksSrc = join(root, "hooks", "claude", "hooks.json");
  const hooksJson = isFile(hooksSrc) ? readFileSync(hooksSrc, "utf-8") : null;
  const hookFiles = buildHookFiles(root);

  const summary = {
    output: out,
    agents: agents.files.map((f) => f.file.replace(/\.md$/, "")),
    natives: natives.map((f) => f.file.replace(/\.md$/, "")),
    skills: skills.map((l) => l.name),
    hooks: hooksJson !== null,
    hookFiles: hookFiles.map((f) => f.rel),
    dryRun,
  };

  if (agents.skipped.length) console.log(`Skipped composable source(s): ${agents.skipped.join(", ")}`);

  if (dryRun) {
    console.log(`DRY-RUN — would generate into ${out}, no files written:`);
    console.log(`  agents: ${summary.agents.join(", ")}`);
    if (summary.natives.length) console.log(`  native agents: ${summary.natives.join(", ")}`);
    console.log(`  skills: ${summary.skills.length} symlink(s)`);
    console.log(`  .claude-plugin/plugin.json (version ${JSON.parse(pluginJson).version})`);
    if (summary.hooks) console.log("  hooks.json (from hooks/claude/hooks.json)");
    if (summary.hookFiles.length)
      console.log(`  hook scripts: ${summary.hookFiles.join(", ")} (bundled into claude/hooks/)`);
    return summary;
  }

  // Generated subsets only — hand-authored support files (.mcp.json, scripts/)
  // under output are left untouched.
  const agentOut = join(out, "agents");
  rmSync(agentOut, { recursive: true, force: true });
  mkdirSync(agentOut, { recursive: true });
  for (const { file, content } of [...agents.files, ...natives]) {
    writeFileSync(join(agentOut, file), content);
  }
  console.log(`Generated ${summary.agents.length} Claude agent(s): ${summary.agents.join(", ")}`);
  if (summary.natives.length) console.log(`Copied ${summary.natives.length} native Claude agent(s): ${summary.natives.join(", ")}`);

  const skillOut = join(out, "skills");
  rmSync(skillOut, { recursive: true, force: true });
  mkdirSync(skillOut, { recursive: true });
  for (const { name, target } of skills) {
    symlinkSync(relative(skillOut, target), join(skillOut, name));
  }
  console.log(`Linked ${summary.skills.length} skill(s) into ${skillOut}`);

  mkdirSync(join(out, ".claude-plugin"), { recursive: true });
  writeFileSync(join(out, ".claude-plugin", "plugin.json"), pluginJson);
  console.log(`Wrote ${join(out, ".claude-plugin", "plugin.json")}`);

  if (summary.hooks) {
    writeFileSync(join(out, "hooks.json"), hooksJson);
    console.log(`Wrote ${join(out, "hooks.json")} (from ${hooksSrc})`);

    if (hookFiles.length > 0) {
      const hookOut = join(out, "hooks");
      rmSync(hookOut, { recursive: true, force: true });
      mkdirSync(hookOut, { recursive: true });
      for (const { rel, content } of hookFiles) {
        const dest = join(hookOut, rel);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, content);
      }
      console.log(`Bundled ${hookFiles.length} hook support file(s) into ${hookOut}`);
    }
  } else {
    console.log(`Skipped hooks.json — ${hooksSrc} not found (existing file left untouched)`);
  }

  return summary;
}

// ─── Claude Code registration ────────────────────────────────────────────────

// The `claude` CLI on PATH. Overridable in tests via the claudeBin option.
const DEFAULT_CLAUDE_BIN = "claude";

/**
 * Read the marketplace manifest that exposes this checkout's claude/ subtree
 * (`.claude-plugin/marketplace.json`); returns the marketplace and plugin
 * names that `claude plugin` commands address. Registration is only possible
 * from a checkout carrying the manifest.
 */
function readMarketplaceManifest(root) {
  const manifestPath = join(root, ".claude-plugin", "marketplace.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `no Claude marketplace manifest at ${manifestPath} (${err.message}) — ` +
        `"agent-cortex install claude" registers the plugin by pointing Claude Code at this checkout`,
    );
  }
  const marketplace = manifest.name;
  const plugin = manifest.plugins?.[0]?.name;
  if (typeof marketplace !== "string" || typeof plugin !== "string") {
    throw new Error(
      `unparsable marketplace manifest at ${manifestPath}: expected { name, plugins: [{ name }] }`,
    );
  }
  return { marketplace, plugin };
}

/** Run one claude plugin command, inheriting its output; throws on failure. */
function runClaudeCommand(claudeBin, args) {
  const label = `${claudeBin} ${args.join(" ")}`;
  const result = spawnSync(claudeBin, args, { stdio: "inherit" });
  if (result.error) {
    throw new Error(`failed to run "${label}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`"${label}" exited ${result.status}`);
  }
}

/**
 * Register the freshly generated claude/ subtree with Claude Code by driving
 * the `claude plugin` CLI against this checkout as the marketplace source:
 *
 *   1. `claude plugin marketplace add <root>`        (idempotent: already on disk)
 *   2. `claude plugin install <plugin>@<market> -y`  (idempotent: already installed)
 *   3. `claude plugin marketplace update <market>`   (re-validate the directory source)
 *   4. `claude plugin update <plugin> -y`            (refresh the cache on version bumps)
 *
 * Requires a Claude Code binary whose `plugin` subcommand exists (v2+); older
 * CLIs treat the args as a chat prompt, so support is probed first. In
 * --dry-run mode nothing is spawned — the commands are reported as a plan.
 *
 * @param {object} options
 * @param {string} [options.root]      Checkout root carrying .claude-plugin/marketplace.json
 *                                     (defaults to the repo containing this module)
 * @param {string} [options.claudeBin] The `claude` executable (default: `claude` from PATH)
 * @param {boolean} [options.dryRun]   Plan and report without running or writing
 * @returns {{ marketplace: string, plugin: string, commands: string[][], dryRun: boolean }}
 */
export function registerClaude({ root = DEFAULT_ROOT, claudeBin = DEFAULT_CLAUDE_BIN, dryRun = false } = {}) {
  const { marketplace, plugin } = readMarketplaceManifest(root);
  const pluginId = `${plugin}@${marketplace}`;
  const commands = [
    ["plugin", "marketplace", "add", resolve(root)],
    ["plugin", "install", pluginId, "-y"],
    ["plugin", "marketplace", "update", marketplace],
    ["plugin", "update", plugin, "-y"],
  ];

  const summary = { marketplace, plugin, commands, dryRun };
  console.log(`Registering plugin "${pluginId}" with Claude Code (via ${claudeBin})…`);

  if (dryRun) {
    for (const args of commands) console.log(`  would run: ${claudeBin} ${args.join(" ")}`);
    console.log("(dry-run — no Claude Code state written)");
    return summary;
  }

  // Older Claude Code builds treat `claude plugin …` as a chat prompt; reject
  // them up-front instead of letting the registration appear to succeed.
  const probe = spawnSync(claudeBin, ["plugin", "--help"], { stdio: "ignore" });
  if (probe.error) {
    throw new Error(
      `cannot run "${claudeBin}" (${probe.error.message}) — is Claude Code installed and on PATH?`,
    );
  }
  if (probe.status !== 0) {
    throw new Error(
      `"${claudeBin}" lacks the "plugin" subcommand — its Claude Code build predates plugin support; ` +
        `update to a build with the plugin CLI (v2+), e.g. "pnpm add -g @anthropic-ai/claude-code@latest", and re-run`,
    );
  }

  for (const args of commands) {
    console.log(`  ${claudeBin} ${args.join(" ")}`);
    runClaudeCommand(claudeBin, args);
  }
  console.log(
    `Installed — verify with "claude plugin list" / "claude plugin details ${plugin}" (restart Claude Code to apply).`,
  );
  return summary;
}