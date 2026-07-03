// Builds the self-contained Claude Code plugin subtree at claude/ from the canonical
// Copilot sources. The Copilot files (agents/*.agent.md) and the grouped skills/ tree
// stay the single source of truth; the claude/ subtree is generated and committed.
// CI runs this and checks `git diff --exit-code claude/` to guarantee it is never stale.
//
//   claude/agents/*.md   generated from agents/*.agent.md (frontmatter + tools converted)
//   claude/skills/<name> symlinks to the grouped skills/<group>/<name> dirs (single source)
//
// Claude only loads agents from the default ./agents/ dir of the plugin root (custom
// `agents` manifest paths are ignored), so the plugin root is claude/ — isolating it
// from the Copilot .agent.md files, which would otherwise load as broken agents.
//
// Run: pnpm build:claude   (node scripts/build-claude-agents.mjs)
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_SRC = join(ROOT, "agents");
const SKILL_SRC = join(ROOT, "skills");
const AGENT_OUT = join(ROOT, "claude", "agents");
const SKILL_OUT = join(ROOT, "claude", "skills");

// Copilot tool name -> Claude tool name. `null` = drop (no Claude equivalent).
const TOOL_MAP = {
  bash: "Bash",
  view: "Read",
  edit: "Edit",
  create: "Write",
  grep: "Grep",
  rg: "Grep",
  glob: "Glob",
  ask_user: "AskUserQuestion",
  web_fetch: "WebFetch",
  skill: "Skill",
  task: "Task",
  read_agent: null, // Claude's Task returns results inline; no separate read step.
};

// Agents whose orchestration model has no Claude equivalent yet (background task
// polling via task+read_agent). Skipped until redesigned for Claude's Task model.
const DEFER = new Set(["ralph"]);

const COPILOT_PLUGIN_ROOT = "~/.copilot/installed-plugins/_direct/agent-cortex";
const CLAUDE_PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";
const NAME_PREFIX = "agent-cortex:";

function parseFrontmatter(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) throw new Error(`${file}: no YAML frontmatter found`);
  return { fm: m[1], body: text.slice(m[0].length) };
}

function scalarLine(fm, key) {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"));
  return m ? m[1] : undefined;
}

function stripQuotes(s) {
  return s === undefined ? undefined : s.replace(/^["']([\s\S]*)["']$/, "$1");
}

function mapTools(fm, file) {
  const raw = scalarLine(fm, "tools");
  if (!raw) throw new Error(`${file}: no tools field`);
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new Error(`${file}: tools is not a JSON array: ${raw}`);
  }
  const out = [];
  for (const t of list) {
    if (!(t in TOOL_MAP)) throw new Error(`${file}: unknown tool "${t}" — extend TOOL_MAP`);
    const mapped = TOOL_MAP[t];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

// Rewrite harness-specific tokens in the prose body: exact backticked tool names and
// the hardcoded Copilot plugin path. Only touches `\`token\`` so shell snippets like
// `bd create` inside code fences are untouched.
function transformBody(body) {
  let out = body;
  for (const [copilot, claude] of Object.entries(TOOL_MAP)) {
    if (claude) out = out.split("`" + copilot + "`").join("`" + claude + "`");
  }
  return out.split(COPILOT_PLUGIN_ROOT).join(CLAUDE_PLUGIN_ROOT);
}

function buildAgents() {
  rmSync(AGENT_OUT, { recursive: true, force: true });
  mkdirSync(AGENT_OUT, { recursive: true });

  const written = [];
  const skipped = [];
  for (const file of readdirSync(AGENT_SRC).filter((f) => f.endsWith(".agent.md")).sort()) {
    const { fm, body } = parseFrontmatter(readFileSync(join(AGENT_SRC, file), "utf8"), file);

    const rawName = stripQuotes(scalarLine(fm, "name"));
    if (!rawName) throw new Error(`${file}: no name field`);
    const slug = rawName.startsWith(NAME_PREFIX) ? rawName.slice(NAME_PREFIX.length) : rawName;
    if (DEFER.has(slug)) {
      skipped.push(slug);
      continue;
    }

    const description = scalarLine(fm, "description");
    if (!description) throw new Error(`${file}: no description field`);

    const header =
      `---\n` +
      `# GENERATED from agents/${file} by scripts/build-claude-agents.mjs — DO NOT EDIT.\n` +
      `name: ${slug}\n` +
      `description: ${description}\n` +
      `tools: ${mapTools(fm, file).join(", ")}\n` +
      `---\n`;
    const out = `${header}\n${transformBody(body).replace(/^\r?\n+/, "").replace(/\s*$/, "")}\n`;
    writeFileSync(join(AGENT_OUT, `${slug}.md`), out);
    written.push(slug);
  }
  console.log(`Generated ${written.length} Claude agent(s): ${written.join(", ")}`);
  if (skipped.length) console.log(`Deferred agent(s): ${skipped.join(", ")}`);
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
buildSkills();
