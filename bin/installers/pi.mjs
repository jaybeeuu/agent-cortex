// Pi harness installer: agent-cortex install pi
//
// Materialises the agent-cortex package into the pi runtime's user scope:
//
//   <output>/agents/<slug>.agent.md   composed agents (default ~/.pi/agent/agents)
//   <output>/skills/<group>/<name>/   token-substituted skill copies (default ~/.pi/agent/skills)
//
// Composition per the token-map.json contract:
//   1. {{SECTION:name}} is resolved from the agent's pi/<name>.md section file
//      (shared composer, scripts/lib/compose-agent.mjs).
//   2. {{TOOL:key}} is substituted with the pi column; a null mapping drops the
//      token from prose with a warning (pi has no ask_user/skill tool).
//   3. {{PATH:key}} named keys resolve through the paths table; bare relative
//      paths resolve against the plugin root (default: token-map.json's pi value,
//      overridable with --plugin-root for checkout/symlinked installs).
// Frontmatter tool lists are translated the same way agent-modes does at runtime:
// canonical → pi column, null → omitted, unknown (native pi tool) → pass through.
// Skill markdown files get the same TOOL/PATH substitution so pi never serves
// literal token syntax; other skill files are copied verbatim.
//
// Skills install into ~/.pi/agent/skills (pi's user-global skill dir), which pi
// loads before package skills, so the substituted copies shadow the raw package
// skills of the same name (pi dedupes by name, user wins).
//
// Zero dependencies so it runs on the CI Node and local Node alike.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { composeAgent, loadTokenMap, substituteTokens, translateToolList } from "../../scripts/lib/compose-agent.mjs";

const PI = "pi";

// The token-map contract version this installer implements (token-map.json
// "version" field). A higher map version is rejected: the contract must be
// extended before this installer can trust it.
const CONTRACT_VERSION = 1;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_OUTPUT = join(homedir(), ".pi", "agent");

const DEFAULT_WARN = (msg) => console.warn(`[pi-installer] ${msg}`);

function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Install the agent-cortex pi harness into the pi runtime.
 *
 * @param {object} options
 * @param {string} [options.root]        Package root (defaults to this file's repo)
 * @param {string} [options.output]      Pi user-scope dir; agents go to
 *                                       <output>/agents, skills to <output>/skills
 *                                       (default ~/.pi/agent)
 * @param {boolean} [options.dryRun]     Compute and report without writing anything
 * @param {string} [options.pluginRoot]  Override plugin_root used for {{PATH:...}}
 *                                       resolution (default: token-map pi value)
 * @param {(msg: string) => void} [options.warn] Warning sink, also collected in `warnings`
 * @returns {{ agents: {name:string, filePath:string}[], skills: {skills:number, md:number, files:number, dir:string},
 *             warnings: string[], dryRun: boolean, agentsDir: string, skillsDir: string }}
 */
export function installPi(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const output = options.output ?? DEFAULT_OUTPUT;
  const dryRun = options.dryRun ?? false;
  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    (options.warn ?? DEFAULT_WARN)(msg);
  };

  const tokenMap = loadTokenMap(root);
  if (typeof tokenMap.version === "number" && tokenMap.version > CONTRACT_VERSION) {
    throw new Error(
      `token-map.json version ${tokenMap.version} is newer than the contract version ${CONTRACT_VERSION} this installer implements — upgrade agent-cortex`,
    );
  }

  const pluginRoot = options.pluginRoot ?? tokenMap.paths.plugin_root?.[PI];
  const agentsDir = join(output, "agents");
  const skillsDir = join(output, "skills");

  const agents = installAgents({ root, agentsDir, dryRun, pluginRoot, tokenMap, warn });
  const skills = installSkills({ root, skillsDir, dryRun, pluginRoot, tokenMap, warn });

  return { agents, skills, warnings, dryRun, agentsDir, skillsDir };
}

// ─── Agents ──────────────────────────────────────────────────────────────────

function installAgents({ root, agentsDir, dryRun, pluginRoot, tokenMap, warn }) {
  const written = [];
  const agentsSrc = join(root, "agents");
  for (const entry of readdirSync(agentsSrc, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue; // skip generated *.agent.md flat files
    const dir = join(agentsSrc, entry.name);
    if (!isFile(join(dir, "agent.md"))) continue; // not a composable agent dir
    if (!isDirectory(join(dir, PI)) || !isFile(join(dir, PI, "frontmatter.json"))) {
      throw new Error(`agent "${entry.name}": composable directory without pi/frontmatter.json — define the pi harness or exclude the agent`);
    }

    const fm = composeAgent(root, entry.name, PI, {
      dropNullTools: true,
      pluginRoot,
      resolveRelativePaths: true,
      warn,
    });
    const tools = translateToolList(fm.tools, tokenMap, PI, { warn });
    const content = renderPiAgent(entry.name, fm, tools);
    const filePath = join(agentsDir, `${entry.name}.agent.md`);
    if (!dryRun) {
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(filePath, content);
    }
    written.push({ name: entry.name, filePath });
  }
  return written;
}

function renderPiAgent(name, fm, tools) {
  const lines = [
    "---",
    `# GENERATED from agents/${name}/ by bin/installers/pi.mjs — DO NOT EDIT.`,
    `name: ${JSON.stringify(fm.name)}`,
    `description: ${JSON.stringify(fm.description)}`,
    `tools: ${JSON.stringify(tools.join(" "))}`,
  ];
  if (fm.model) lines.push(`model: ${JSON.stringify(fm.model)}`);
  if (fm.argumentHint) lines.push(`argument-hint: ${JSON.stringify(fm.argumentHint)}`);
  lines.push("---");
  return `${lines.join("\n")}\n\n${fm.body}\n`;
}

// ─── Skills ──────────────────────────────────────────────────────────────────

function installSkills({ root, skillsDir, dryRun, pluginRoot, tokenMap, warn }) {
  const skillsSrc = join(root, "skills");
  if (!isDirectory(skillsSrc)) return { skills: 0, md: 0, files: 0, dir: skillsDir };

  const transform = (content) =>
    substituteTokens(content, PI, tokenMap, { dropNullTools: true, pluginRoot, resolveRelativePaths: true, warn });

  if (!dryRun) mkdirSync(skillsDir, { recursive: true });
  let skills = 0;
  let md = 0;
  let files = 0;
  for (const group of readdirSync(skillsSrc).sort()) {
    const groupDir = join(skillsSrc, group);
    if (!isDirectory(groupDir)) continue;
    for (const name of readdirSync(groupDir).sort()) {
      if (!isFile(join(groupDir, name, "SKILL.md"))) continue;
      skills += 1;
      const stats = copyTree(join(groupDir, name), join(skillsDir, group, name), transform, dryRun);
      md += stats.md;
      files += stats.files;
    }
  }
  return { skills, md, files, dir: skillsDir };
}

/** Recursively copy a tree; transform .md file contents, copy everything else verbatim. */
function copyTree(src, dest, transform, dryRun) {
  let md = 0;
  let files = 0;
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      const stats = copyTree(from, to, transform, dryRun);
      md += stats.md;
      files += stats.files;
    } else if (entry.isFile()) {
      files += 1;
      if (entry.name.endsWith(".md")) md += 1;
      if (dryRun) continue;
      mkdirSync(dest, { recursive: true });
      if (entry.name.endsWith(".md")) writeFileSync(to, transform(readFileSync(from, "utf-8")));
      else copyFileSync(from, to);
    }
  }
  return { md, files };
}