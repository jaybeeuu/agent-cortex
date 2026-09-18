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
//   2. {{TOOL:key}} is substituted with the pi column (pi maps ask_user →
//      ask_questions and skill → read); any (future) null pi mapping drops the
//      token from prose with a warning.
//   3. {{PATH:key}} named keys resolve through the paths table; bare relative
//      paths resolve against the plugin root (default: token-map.json's pi value,
//      overridable with --plugin-root for checkout/symlinked installs).
// Frontmatter tool lists are translated the same way agent-modes does at runtime:
// canonical → pi column, null → omitted, unknown (native pi tool) → pass through.
// Skill markdown files get the same TOOL/PATH substitution so pi never serves
// literal token syntax; other skill files are copied verbatim.
//
// Skills install into ~/.pi/agent/skills (pi's user-global skill dir), which is
// the sole pi skill source: the checkout's raw package skills are not loaded
// locally because pi/settings.json registers agent-cortex with an object-form
// packages filter { source, "skills": [] } (extensions stay enabled). The
// filter exists so pi never sees the raw, un-substituted package skills and
// reports a name collision per skill (pi warns on collisions, user dir wins).
// Consumers who install the npm package without that filter still rely on pi's
// shadowing order (user dir loads before package skills). Re-run this installer
// after any skill edit so the substituted copy in the user dir stays in sync.
//
// Zero dependencies so it runs on the CI Node and local Node alike.

import { readFile, writeFile, mkdir, copyFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { composeAgent, loadTokenMap, substituteTokens, translateToolList } from "../../scripts/lib/compose-agent.mjs";
import { loadRequiredPackages, provisionPiPackages } from "../../lib/pi-packages.mjs";

const PI = "pi";

// The token-map contract version this installer implements (token-map.json
// "version" field). A higher map version is rejected: the contract must be
// extended before this installer can trust it.
const CONTRACT_VERSION = 1;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_OUTPUT = join(homedir(), ".pi", "agent");

const DEFAULT_WARN = (msg) => console.warn(`[pi-installer] ${msg}`);

async function isDirectory(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
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
 * @param {boolean} [options.provisionPackages]  Install the third-party pi packages
 *                                       declared in the package manifest (package.json
 *                                       pi.packages) into the pi user scope — e.g.
 *                                       pi-questions (ask_questions) and pi-web-access
 *                                       (fetch_content). Off by default; `agent-cortex
 *                                       install pi` turns it on for a real install.
 * @param {(source: string) => Promise<{ok: boolean, error: string | null}>} [options.runInstall]
 *                                       Installer for one package source (default: pi install)
 * @param {(msg: string) => void} [options.warn] Warning sink, also collected in `warnings`
 * @returns {{ agents: {name:string, filePath:string}[], skills: {skills:number, md:number, files:number, dir:string},
 *             packages: {planned:string[], installed:string[], failed:{source:string, error:string}[]} | null,
 *             warnings: string[], dryRun: boolean, agentsDir: string, skillsDir: string }}
 */
export async function installPi(options = {}) {
  const root = options.root ?? PACKAGE_ROOT;
  const output = options.output ?? DEFAULT_OUTPUT;
  const dryRun = options.dryRun ?? false;
  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    (options.warn ?? DEFAULT_WARN)(msg);
  };

  const tokenMap = await loadTokenMap(root);
  if (typeof tokenMap.version === "number" && tokenMap.version > CONTRACT_VERSION) {
    throw new Error(
      `token-map.json version ${tokenMap.version} is newer than the contract version ${CONTRACT_VERSION} this installer implements — upgrade agent-cortex`,
    );
  }

  const pluginRoot = options.pluginRoot ?? tokenMap.paths.plugin_root?.[PI];
  const agentsDir = join(output, "agents");
  const skillsDir = join(output, "skills");

  const agents = await installAgents({ root, agentsDir, dryRun, pluginRoot, tokenMap, warn });
  const skills = await installSkills({ root, skillsDir, dryRun, pluginRoot, tokenMap, warn });

  // Third-party packages give the composed agents their pi tools (ask_questions
  // from pi-questions, fetch_content from pi-web-access). They are declared in
  // the package manifest and only provisioned on a real install.
  const packages = options.provisionPackages
    ? await provisionPiPackages({
        required: await loadRequiredPackages(root),
        piRoot: output,
        dryRun,
        runInstall: options.runInstall,
        warn,
      })
    : null;

  return { agents, skills, packages, warnings, dryRun, agentsDir, skillsDir };
}

// ─── Agents ──────────────────────────────────────────────────────────────────

async function installAgents({ root, agentsDir, dryRun, pluginRoot, tokenMap, warn }) {
  const written = [];
  const agentsSrc = join(root, "agents");
  for (const entry of (await readdir(agentsSrc, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue; // skip generated *.agent.md flat files
    const dir = join(agentsSrc, entry.name);
    if (!(await isFile(join(dir, "agent.md")))) continue; // not a composable agent dir
    if (!(await isDirectory(join(dir, PI))) || !(await isFile(join(dir, PI, "frontmatter.json")))) {
      throw new Error(`agent "${entry.name}": composable directory without pi/frontmatter.json — define the pi harness or exclude the agent`);
    }

    const fm = await composeAgent(root, entry.name, PI, {
      dropNullTools: true,
      pluginRoot,
      resolveRelativePaths: true,
      warn,
    });
    const tools = translateToolList(fm.tools, tokenMap, PI, { warn });
    const content = renderPiAgent(entry.name, fm, tools);
    const filePath = join(agentsDir, `${entry.name}.agent.md`);
    if (!dryRun) {
      await mkdir(agentsDir, { recursive: true });
      await writeFile(filePath, content);
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

async function installSkills({ root, skillsDir, dryRun, pluginRoot, tokenMap, warn }) {
  const skillsSrc = join(root, "skills");
  if (!(await isDirectory(skillsSrc))) return { skills: 0, md: 0, files: 0, dir: skillsDir };

  const transform = (content) =>
    substituteTokens(content, PI, tokenMap, { dropNullTools: true, pluginRoot, resolveRelativePaths: true, warn });

  if (!dryRun) await mkdir(skillsDir, { recursive: true });
  let skills = 0;
  let md = 0;
  let files = 0;
  for (const group of (await readdir(skillsSrc)).sort()) {
    const groupDir = join(skillsSrc, group);
    if (!(await isDirectory(groupDir))) continue;
    for (const name of (await readdir(groupDir)).sort()) {
      if (!(await isFile(join(groupDir, name, "SKILL.md")))) continue;
      skills += 1;
      const stats = await copyTree(join(groupDir, name), join(skillsDir, group, name), transform, dryRun);
      md += stats.md;
      files += stats.files;
    }
  }
  return { skills, md, files, dir: skillsDir };
}

/** Recursively copy a tree; transform .md file contents, copy everything else verbatim. */
async function copyTree(src, dest, transform, dryRun) {
  let md = 0;
  let files = 0;
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      const stats = await copyTree(from, to, transform, dryRun);
      md += stats.md;
      files += stats.files;
    } else if (entry.isFile()) {
      files += 1;
      if (entry.name.endsWith(".md")) md += 1;
      if (dryRun) continue;
      await mkdir(dest, { recursive: true });
      if (entry.name.endsWith(".md")) await writeFile(to, transform(await readFile(from, "utf-8")));
      else await copyFile(from, to);
    }
  }
  return { md, files };
}