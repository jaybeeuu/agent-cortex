// Pi harness installer: agent-cortex install pi
//
// Materialises the agent-cortex package into the pi runtime's user scope:
//
//   <output>/agents/<slug>.agent.md   composed agents (default ~/.pi/agent/agents)
//   <output>/skills/<group>/<name>/   token-substituted skill copies (default ~/.pi/agent/skills)
//   <output>/settings.json            merged pi settings — CLI owns `packages` (default ~/.pi/agent/settings.json)
//   <output>/keybindings.json         generated pi keybindings (default ~/.pi/agent/keybindings.json)
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
// the sole source of agent-cortex's own skills locally: the checkout's raw
// package skills are not loaded because pi/settings.json registers agent-cortex
// with an object-form packages filter { source, "skills": ["node_modules/**"] }
// (extensions stay enabled). The filter exists so pi never sees the raw,
// un-substituted package skills and reports a name collision per skill (pi warns
// on collisions, user dir wins), while the skills that ship inside a bundled pi
// package — referenced through node_modules in the package's pi manifest — still
// load. Required third-party pi packages (pi-questions, pi-web-access) are real
// dependencies bundled into the published tarball, so pi resolves their
// extensions from within the package; nothing is provisioned via the pi CLI.
// Consumers who install the npm package without that filter still rely on pi's
// shadowing order (user dir loads before package skills). Re-run this installer
// after any skill edit so the substituted copy in the user dir stays in sync.
//
// Zero dependencies so it runs on the CI Node and local Node alike.

import { readFile, writeFile, mkdir, copyFile, readdir, lstat, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { composeAgent, loadTokenMap, substituteTokens, translateToolList } from "../../scripts/lib/compose-agent.mjs";
import { isDirectory, isFile } from "../../scripts/lib/fs.mjs";

const PI = "pi";

// The token-map contract version this installer implements (token-map.json
// "version" field). A higher map version is rejected: the contract must be
// extended before this installer can trust it.
const CONTRACT_VERSION = 1;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_OUTPUT = join(homedir(), ".pi", "agent");

const SETTINGS_TEMPLATE = "pi/settings.json";
const KEYBINDINGS_TEMPLATE = "pi/keybindings.json";

// pi parses settings.json / keybindings.json with a bare JSON.parse (see pi's
// SettingsManager / KeybindingsManager), so JSONC comments are not an option —
// a `//` line would make the file unreadable. The GENERATED marker therefore
// lives in a top-level "//" key, the conventional JSON comment stand-in, which
// pi ignores on load and preserves on write.
const GENERATED_KEY = "//";

const DEFAULT_WARN = (msg) => console.warn(`[pi-installer] ${msg}`);

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
 *             settings: ManagedFileResult|null, keybindings: ManagedFileResult|null,
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
  const config = await installConfig({ root, output, dryRun, warn });

  return { agents, skills, ...config, warnings, dryRun, agentsDir, skillsDir };
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
// ─── Pi config files ─────────────────────────────────────────────────────────

/**
 * Materialise the pi config files into the agent dir.
 *
 * `settings.json` is merged: the committed template supplies defaults for keys
 * the live file lacks, while every value already present in the live file wins,
 * so personal config (and anything pi itself wrote) survives re-install. The
 * one key the CLI owns outright is `packages`: it is rewritten from the
 * template with the repo path entry resolved against the target settings file.
 *
 * `keybindings.json` follows a checksum rule: a missing file or a legacy
 * symlink is materialised from the template, an unmodified install is refreshed
 * when the template changes, and a file edited after install is left untouched.
 */
async function installConfig({ root, output, dryRun, warn }) {
  return {
    settings: await installSettings({ root, output, dryRun, warn }),
    keybindings: await installKeybindings({ root, output, dryRun, warn }),
  };
}

async function installSettings({ root, output, dryRun, warn }) {
  const template = await readTemplateJson(join(root, SETTINGS_TEMPLATE), warn);
  if (template === null) return null;

  const target = join(output, "settings.json");
  const merged = mergeSettings(template, await readJsonObject(target, warn));
  merged.packages = resolvePackages(template.packages, root, dirname(target));
  delete merged[GENERATED_KEY];

  const content = `${JSON.stringify(
    { [GENERATED_KEY]: generatedMarker(SETTINGS_TEMPLATE), ...merged },
    null,
    2,
  )}\n`;
  return writeManagedJson({ target, content, dryRun });
}

async function installKeybindings({ root, output, dryRun, warn }) {
  const template = await readTemplateJson(join(root, KEYBINDINGS_TEMPLATE), warn);
  if (template === null) return null;

  const target = join(output, "keybindings.json");
  const content = `${JSON.stringify(
    { [GENERATED_KEY]: generatedMarker(KEYBINDINGS_TEMPLATE, checksum(template)), ...template },
    null,
    2,
  )}\n`;

  const current = await readFileMaybe(target);
  if (current !== null && !(await isSymlink(target)) && current !== content) {
    const parsed = tryParseJsonObject(current);
    // An install we wrote carries the checksum it recorded; a body that no
    // longer matches was edited by hand and must not be clobbered. A body
    // byte-identical to the template is a legacy copy and safe to refresh.
    const recorded = parsed === null ? null : readRecordedChecksum(parsed[GENERATED_KEY]);
    const unmodified = parsed !== null && (checksum(parsed) === checksum(template) || recorded === checksum(parsed));
    if (!unmodified) {
      warn(`${target} was modified after install — leaving it untouched (delete it to re-adopt the template)`);
      return { path: target, action: "skipped", removedSymlink: false };
    }
  }
  return writeManagedJson({ target, content, dryRun });
}

/** Human-readable marker written as the `//` key of every generated config file. */
function generatedMarker(from, templateChecksum) {
  const base = `GENERATED from ${from} by \`agent-cortex install pi\` — DO NOT EDIT; re-run the installer to update.`;
  return templateChecksum ? `${base} template-checksum:${templateChecksum}` : base;
}

/** SHA-256 of a config body with the generated marker stripped, so it is stable across writes. */
function checksum(obj) {
  const { [GENERATED_KEY]: _marker, ...body } = obj;
  return createHash("sha256").update(JSON.stringify(body, null, 2)).digest("hex");
}

function readRecordedChecksum(marker) {
  if (typeof marker !== "string") return null;
  const match = /template-checksum:([0-9a-f]{64})/.exec(marker);
  return match ? match[1] : null;
}

/**
 * Merge the committed template over the live file. Template keys fill in
 * defaults, live values win (deeply), and keys the template does not know about
 * are preserved — re-installing never discards personal or pi-written config.
 */
function mergeSettings(template, existing) {
  const merged = {};
  for (const key of Object.keys(template)) {
    const templateValue = template[key];
    const existingValue = existing[key];
    if (isPlainObject(templateValue) && isPlainObject(existingValue)) {
      merged[key] = mergeSettings(templateValue, existingValue);
    } else {
      merged[key] = key in existing ? existingValue : templateValue;
    }
  }
  for (const key of Object.keys(existing)) {
    if (!(key in merged)) merged[key] = existing[key];
  }
  return merged;
}

/**
 * Build the CLI-managed packages list: the template entries with the repo path
 * package resolved relative to the target settings file. pi resolves user-scope
 * local package paths against its agent dir, so this keeps the checkout (or npm
 * install) registered wherever the settings file lands.
 */
function resolvePackages(packages, root, settingsDir) {
  if (!Array.isArray(packages)) return packages;
  const repoSource = relative(settingsDir, root) || ".";
  let resolved = false;
  const out = packages.map((entry) => {
    const source = typeof entry === "string" ? entry : entry?.source;
    if (resolved || typeof source !== "string" || source.startsWith("npm:")) return entry;
    resolved = true;
    return typeof entry === "string" ? repoSource : { ...entry, source: repoSource };
  });
  if (!resolved) out.unshift({ source: repoSource, skills: ["node_modules/**"] });
  return out;
}

/**
 * Write a managed config file. A legacy symlink is replaced with a real file by
 * writing a sibling temp file and renaming it over the target — rename replaces
 * the link itself, so the repo template is never written through. Returns the
 * action taken so the CLI can report the plan (dry-run included).
 */
async function writeManagedJson({ target, content, dryRun }) {
  const symlink = await isSymlink(target);
  const current = await readFileMaybe(target);

  if (dryRun) {
    return {
      path: target,
      action: symlink ? "would-remove-symlink" : current === content ? "unchanged" : "would-write",
      removedSymlink: symlink,
    };
  }
  if (!symlink && current === content) {
    return { path: target, action: "unchanged", removedSymlink: false };
  }

  await mkdir(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, content);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  return { path: target, action: symlink ? "removed-symlink" : "written", removedSymlink: symlink };
}

async function readTemplateJson(filePath, warn) {
  const raw = await readFileMaybe(filePath);
  if (raw === null) {
    warn(`no ${filePath} template in the package — skipping`);
    return null;
  }
  const parsed = tryParseJsonObject(raw);
  if (parsed === null) throw new Error(`${filePath} is not a JSON object`);
  return parsed;
}

async function readJsonObject(filePath, warn) {
  const raw = await readFileMaybe(filePath);
  if (raw === null) return {};
  const parsed = tryParseJsonObject(raw);
  if (parsed === null) {
    warn(`${filePath} is not a JSON object — ignoring its contents`);
    return {};
  }
  return parsed;
}

function tryParseJsonObject(raw) {
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readFileMaybe(filePath) {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function isSymlink(filePath) {
  try {
    return (await lstat(filePath)).isSymbolicLink();
  } catch {
    return false;
  }
}
