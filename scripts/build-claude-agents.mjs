// Builds the self-contained Claude Code plugin subtree at claude/ from the
// canonical composable agent sources (agents/<name>/) and the grouped skills/
// tree. Those stay the single source of truth; the claude/ subtree is generated
// and committed. CI runs this and checks `git diff --exit-code claude/` to
// guarantee it is never stale.
//
//   claude/agents/<slug>.md  composed from agents/<name>/agent.md +
//                            agents/<name>/claude/frontmatter.json +
//                            agents/<name>/claude/<section>.md ({{SECTION:...}}),
//                            with {{TOOL:...}}/{{PATH:...}} substituted against
//                            the claude column of token-map.json. Agents in the
//                            DEFER set ship instead from agents-native/<name>.md.
//   claude/skills/<name> symlinks to the grouped skills/<group>/<name> dirs (single source)
//
// Claude only loads agents from the default ./agents/ dir of the plugin root (custom
// `agents` manifest paths are ignored), so the plugin root is claude/ — isolating it
// from the Copilot .agent.md files, which would otherwise load as broken agents.
//
// Run: pnpm build:claude   (node scripts/build-claude-agents.mjs)
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { readdirSync, writeFileSync, mkdirSync, rmSync, symlinkSync, statSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { composeAgent } from "./lib/compose-agent.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_SRC = join(ROOT, "agents");
const NATIVE_SRC = join(ROOT, "agents-native");
const SKILL_SRC = join(ROOT, "skills");
const AGENT_OUT = join(ROOT, "claude", "agents");
const SKILL_OUT = join(ROOT, "claude", "skills");

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

function buildAgents() {
  rmSync(AGENT_OUT, { recursive: true, force: true });
  mkdirSync(AGENT_OUT, { recursive: true });

  const written = [];
  const skipped = [];
  const entries = readdirSync(AGENT_SRC, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(AGENT_SRC, entry.name);
    if (!isFile(join(dir, "agent.md")) || !isFile(join(dir, "claude", "frontmatter.json"))) continue;

    if (DEFER.has(entry.name)) {
      skipped.push(entry.name);
      continue;
    }

    const fm = composeAgent(ROOT, entry.name, "claude");
    const slug = fm.name.startsWith(NAME_PREFIX) ? fm.name.slice(NAME_PREFIX.length) : fm.name;
    const header =
      `---\n` +
      `# GENERATED from agents/${entry.name}/ by scripts/build-claude-agents.mjs — DO NOT EDIT.\n` +
      `name: ${slug}\n` +
      `description: ${JSON.stringify(fm.description)}\n` +
      `tools: ${fm.tools.join(", ")}\n` +
      `---\n`;
    writeFileSync(join(AGENT_OUT, `${slug}.md`), `${header}\n${fm.body}\n`);
    written.push(slug);
  }
  console.log(`Generated ${written.length} Claude agent(s): ${written.join(", ")}`);
  if (skipped.length) console.log(`Skipped composable source(s): ${skipped.join(", ")}`);
}

// Copy hand-authored Claude-native agents into claude/agents/ verbatim, alongside the
// generated ones. These have no composable body (their bodies differ structurally per harness).
function copyNativeAgents() {
  if (!existsSync(NATIVE_SRC)) return;
  const copied = [];
  for (const file of readdirSync(NATIVE_SRC).filter((f) => f.endsWith(".md")).sort()) {
    copyFileSync(join(NATIVE_SRC, file), join(AGENT_OUT, file));
    copied.push(file.replace(/\.md$/, ""));
  }
  if (copied.length) console.log(`Copied ${copied.length} native Claude agent(s): ${copied.join(", ")}`);
}

// Symlink each grouped skill (skills/<group>/<name>/) into the flat claude/skills/ dir
// so Claude's one-level-deep skill scan discovers them without duplicating content.
function buildSkills() {
  rmSync(SKILL_OUT, { recursive: true, force: true });
  mkdirSync(SKILL_OUT, { recursive: true });

  const byName = new Map();
  for (const group of readdirSync(SKILL_SRC).sort()) {
    const groupDir = join(SKILL_SRC, group);
    if (!statSync(groupDir).isDirectory()) continue;
    for (const name of readdirSync(groupDir).sort()) {
      const skillDir = join(groupDir, name);
      let hasSkill;
      try {
        hasSkill = statSync(join(skillDir, "SKILL.md")).isFile();
      } catch {
        hasSkill = false;
      }
      if (!hasSkill) continue;
      if (SKILL_EXCLUDE.has(name)) continue;
      if (byName.has(name)) {
        throw new Error(`duplicate skill name "${name}" (${byName.get(name)} and ${group}) — names must be unique when flattened`);
      }
      byName.set(name, group);
      symlinkSync(relative(SKILL_OUT, skillDir), join(SKILL_OUT, name));
    }
  }
  console.log(`Linked ${byName.size} skill(s) into claude/skills/`);
}

buildAgents();
copyNativeAgents();
buildSkills();