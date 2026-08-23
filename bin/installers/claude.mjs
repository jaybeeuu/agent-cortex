// Install-time generator for the Claude Code plugin subtree. This is the single
// code path for producing claude/ from the canonical sources — both entry points
// below call installClaude() with different defaults, so install-time and
// build-time output can never diverge:
//
//   - bin/agent-cortex.mjs     `agent-cortex install claude` (install-time;
//                              `--output <dir>` overrides the target,
//                              `--dry-run` plans without writing)
//   - scripts/build-claude-agents.mjs  `pnpm build:claude` (dev/CI: regenerates
//                              the committed claude/ subtree in place)
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
//
// The claude/ subtree stays committed and CI drift-checks it (build:claude +
// git diff --exit-code), so a fresh clone remains installable as-is. Hand-authored
// support files under claude/ (claude/.mcp.json, claude/scripts/) are left untouched.
//
// Zero dependencies so it runs on the CI Node and local Node alike.

import { readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, statSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
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
      `# GENERATED from agents/${entry.name}/ by scripts/build-claude-agents.mjs — DO NOT EDIT.\n` +
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

  const summary = {
    output: out,
    agents: agents.files.map((f) => f.file.replace(/\.md$/, "")),
    natives: natives.map((f) => f.file.replace(/\.md$/, "")),
    skills: skills.map((l) => l.name),
    hooks: hooksJson !== null,
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
  } else {
    console.log(`Skipped hooks.json — ${hooksSrc} not found (existing file left untouched)`);
  }

  return summary;
}