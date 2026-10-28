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
// The settings `packages` entry has to outlive the install (pi loads from it at
// runtime), so when the installer runs inside a linked git worktree — ralph's
// .agent-cortex/worktrees/<id> — that entry registers the main checkout instead
// of the gitignored worktree itself.
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
// Installing is also a reconciliation, not just a copy: every run prunes the
// owned copies the source no longer produces (a skill dropped upstream, a support
// file a skill dropped) and records what it owns in .agent-cortex-install.json so
// the next run — and the future `agent-cortex upgrade`, which calls this
// installer — can tell a stale copy from a user's own skill. See pruneStaleCopies.
//
// Zero dependencies so it runs on the CI Node and local Node alike.

import { readFile, writeFile, mkdir, copyFile, readdir, lstat, rename, rm, rmdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname, basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { composeAgent, loadTokenMap, substituteTokens, translateToolList } from "../../scripts/lib/compose-agent.mjs";
import { loadRequiredPackages, provisionPiPackages } from "../../lib/pi-packages.mjs";
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

// The trees below <output> this installer materialises — and therefore the only
// trees its prune may remove from.
const AGENTS_TREE = "agents";
const SKILLS_TREE = "skills";

// Ownership record of the paths the last install wrote. It lives beside the
// generated config files (not in either tree) and is what lets the prune tell a
// copy left behind by an older source from a skill or agent the user wrote.
const MANIFEST_FILE = ".agent-cortex-install.json";

// First frontmatter line of every agent file this installer generates, up to the
// agent name. A file carrying it was written by an install, which is the evidence
// the prune uses for agent files from installs that predate the ownership record.
// The provenance suffix that follows the name in the full line is what keeps that
// evidence pi-specific: the copilot installer generates agents with the same
// prefix, and one of its files under <output>/agents is not a stale pi copy.
const AGENT_MARKER = "# GENERATED from agents/";
const AGENT_PROVENANCE = " by bin/installers/pi.mjs — DO NOT EDIT.";

// pi parses settings.json / keybindings.json with a bare JSON.parse (see pi's
// SettingsManager / KeybindingsManager), so JSONC comments are not an option —
// a `//` line would make the file unreadable. The GENERATED marker therefore
// lives in a top-level "//" key, the conventional JSON comment stand-in, which
// pi ignores on load and preserves on write.
const GENERATED_KEY = "//";

const DEFAULT_WARN = (msg) => console.warn(`[pi-installer] ${msg}`);

const execFileAsync = promisify(execFile);

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
 *             settings: ManagedFileResult|null, keybindings: ManagedFileResult|null,
 *             pruned: {files:string[], dirs:string[]},
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
  const agentsDir = join(output, AGENTS_TREE);
  const skillsDir = join(output, SKILLS_TREE);

  // The settings `packages` entry registers a checkout with pi, and pi loads
  // from it at runtime — so it must survive this install. A linked git worktree
  // (ralph's .agent-cortex/worktrees/<id>) is gitignored and short-lived: it
  // registers the main checkout instead, while the copies above still come from
  // the invoked worktree.
  const mainRoot = await findMainWorkingTree(root);
  if (mainRoot) {
    warn(
      `${root} is a git worktree — registering the main checkout ${mainRoot} as the pi package source (a worktree disappears with its branch); run the installer from ${mainRoot} to install that checkout's agents and skills`,
    );
  }

  const agents = await installAgents({ root, agentsDir, dryRun, pluginRoot, tokenMap, warn });
  const skills = await installSkills({ root, skillsDir, dryRun, pluginRoot, tokenMap, warn });
  const owned = { [AGENTS_TREE]: agents.owned, [SKILLS_TREE]: skills.owned };

  // Reconcile after writing: a failed copy leaves the tree as it was rather than
  // half-pruned. The record follows the copies it describes — only the config and
  // package writes come after it — so an interrupted install never claims paths
  // it did not produce.
  const { report: pruned, record } = await pruneStaleCopies({
    output,
    owned,
    skillDirs: skills.skillDirs,
    dryRun,
    warn,
  });
  if (!dryRun) await writeInstallManifest(output, record);

  const config = await installConfig({ root, packageRoot: mainRoot ?? root, output, dryRun, warn });

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

  return { agents: agents.files, skills: skills.stats, packages, pruned, ...config, warnings, dryRun, agentsDir, skillsDir };
}

// ─── Agents ──────────────────────────────────────────────────────────────────

async function installAgents({ root, agentsDir, dryRun, pluginRoot, tokenMap, warn }) {
  const written = [];
  const owned = [];
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
    owned.push(`${entry.name}.agent.md`);
  }
  return { files: written, owned };
}

function renderPiAgent(name, fm, tools) {
  const lines = [
    "---",
    `${AGENT_MARKER}${name}/${AGENT_PROVENANCE}`,
    `name: ${JSON.stringify(fm.name)}`,
    `description: ${JSON.stringify(fm.description)}`,
    // pi's parseFrontmatter hands back the scalar as one string, so the tool
    // list must use the separator its consumers split on. The subagent extension
    // (extensions/subagent/agents.ts) turns this into `pi --tools`, whose
    // parser is comma-separated — a space-separated list collapsed to a single
    // bogus name and produced an allowlist matching no tool at all.
    `tools: ${JSON.stringify(tools.join(", "))}`,
  ];
  if (fm.model) lines.push(`model: ${JSON.stringify(fm.model)}`);
  if (fm.argumentHint) lines.push(`argument-hint: ${JSON.stringify(fm.argumentHint)}`);
  lines.push("---");
  return `${lines.join("\n")}\n\n${fm.body}\n`;
}

// ─── Skills ──────────────────────────────────────────────────────────────────

async function installSkills({ root, skillsDir, dryRun, pluginRoot, tokenMap, warn }) {
  const skillsSrc = join(root, "skills");
  if (!(await isDirectory(skillsSrc))) {
    return { stats: { skills: 0, md: 0, files: 0, dir: skillsDir }, owned: [], skillDirs: [] };
  }

  const transform = (content) =>
    substituteTokens(content, PI, tokenMap, { dropNullTools: true, pluginRoot, resolveRelativePaths: true, warn });

  if (!dryRun) await mkdir(skillsDir, { recursive: true });
  const owned = [];
  const skillDirs = [];
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
      const dir = `${group}/${name}`;
      skillDirs.push(dir);
      owned.push(...stats.paths.map((rel) => `${dir}/${rel}`));
    }
  }
  return { stats: { skills, md, files, dir: skillsDir }, owned, skillDirs };
}

/** Recursively copy a tree; transform .md file contents, copy everything else verbatim. */
async function copyTree(src, dest, transform, dryRun) {
  let md = 0;
  let files = 0;
  const paths = [];
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      const stats = await copyTree(from, to, transform, dryRun);
      md += stats.md;
      files += stats.files;
      paths.push(...stats.paths.map((rel) => `${entry.name}/${rel}`));
    } else if (entry.isFile()) {
      files += 1;
      if (entry.name.endsWith(".md")) md += 1;
      paths.push(entry.name);
      if (dryRun) continue;
      await mkdir(dest, { recursive: true });
      if (entry.name.endsWith(".md")) await writeFile(to, transform(await readFile(from, "utf-8")));
      else await copyFile(from, to);
    }
  }
  return { md, files, paths };
}

// ─── Pruning stale copies ──────────────────────────────────────────────────────

/**
 * Remove the copies of the two owned trees that this install no longer produces.
 *
 * The trees are shared: pi provisions third-party packages beside them and users
 * keep their own skills and agents in the very directories that get written, so
 * "everything the source lacks" would be too broad a rule. Ownership therefore
 * has to be evidenced:
 *
 *   - paths the previous install recorded in MANIFEST_FILE,
 *   - agent files carrying the provenance line this installer writes under the
 *     agent name — evidence that also predates the manifest, so a tree installed
 *     by an older agent-cortex still sheds the agents the source dropped, and
 *   - files inside a skill the source still ships: the installer writes that
 *     whole subtree, so a file it did not write is an orphan from an older
 *     source rather than something the user added.
 *
 * Anything else — an npm package under <output>/npm, pi's extensions, a skill or
 * hand-written agent the user added — stays. A directory is removed only once
 * this prune has emptied it, so one holding anything unowned stays, and so does
 * one that was already empty.
 *
 * One boundary follows from that: a whole skill directory dropped upstream is
 * only provable once a manifest exists, so the first run over a tree installed
 * before the record did keeps such a directory for one install — agent files can
 * still be judged on their marker, skill copies have no equivalent. That first
 * run records the manifest, and every run after it is complete; sweeping the
 * pre-existing tree is a separate, deliberate cleanup rather than something this
 * prune can do without deleting a user's own skills.
 *
 * Two inputs are refused rather than acted on. A recorded path that is not a
 * plain relative path inside its tree would resolve anywhere once joined, so it
 * is ignored with a warning — the record is hand-editable and is the one input
 * that authorises deletion. And a tree whose source resolves to nothing while
 * the record lists paths in it is kept whole with a warning: a degraded source
 * (sparse checkout, a rename mid-flight) proves no copy stale, while deleting on
 * its silence would turn a failed install into a destructive one.
 *
 * Returns the plan instead of deleting it under `dryRun`, plus the ownership
 * record to persist — a tree whose prune was skipped keeps its previous paths.
 *
 * @returns {Promise<{report: {files: string[], dirs: string[]}, record: {[tree: string]: string[]}}>}
 *          absolute paths in `report`
 */
async function pruneStaleCopies({ output, owned, skillDirs, dryRun, warn }) {
  const previous = await readInstallManifest(output, warn);
  const report = { files: [], dirs: [] };
  const record = { [AGENTS_TREE]: owned[AGENTS_TREE] ?? [], [SKILLS_TREE]: owned[SKILLS_TREE] ?? [] };
  for (const tree of [AGENTS_TREE, SKILLS_TREE]) {
    const expected = owned[tree] ?? [];
    const recorded = previous[tree];
    // A degraded source — sparse checkout, a rename mid-flight — resolves to
    // nothing for a tree it used to populate, which would make every recorded
    // path look dropped. Nothing proves it better than the copies on disk do.
    if (expected.length === 0 && recorded.length > 0) {
      warn(
        `the source ships no ${tree} while ${recorded.length} installed ${tree} path(s) are recorded — keeping them and skipping the ${tree} prune`,
      );
      // The record is ownership evidence, not an install log: a skipped prune
      // proves nothing about what the tree still owns, so carrying the previous
      // paths forward is what lets the next healthy run prune what this one
      // could not judge. Overwriting them with this run's empty set would
      // silently orphan every installed copy in the tree.
      record[tree] = recorded;
      continue;
    }
    const treeDir = join(output, tree);
    if (!(await isDirectory(treeDir))) continue;
    const stale = await findStaleCopies({ tree, treeDir, previous: recorded, owned: expected, skillDirs });
    if (stale.length === 0) continue;

    // Computed before deleting, so the dry-run plan and the real run agree.
    const emptied = await dirsEmptiedBy(treeDir, stale);
    if (!dryRun) {
      for (const rel of stale) await rm(fromRel(treeDir, rel), { force: true });
      for (const rel of emptied) await removeEmptyDir(fromRel(treeDir, rel));
    }
    report.files.push(...stale.map((rel) => fromRel(treeDir, rel)));
    report.dirs.push(...emptied.map((rel) => fromRel(treeDir, rel)));
  }
  return { report, record };
}

/** Paths under one tree that exist on disk and are not part of this install. */
async function findStaleCopies({ tree, treeDir, previous, owned, skillDirs }) {
  const keep = new Set(owned);
  const candidates = new Set((previous ?? []).filter((rel) => !keep.has(rel)));
  for (const rel of await listFilesDeep(treeDir)) {
    if (keep.has(rel) || candidates.has(rel)) continue;
    if (await isAbandonedCopy({ tree, rel, abs: fromRel(treeDir, rel), skillDirs })) candidates.add(rel);
  }
  const stale = [];
  for (const rel of [...candidates].sort()) {
    // A recorded path can be gone (the user cleaned it) or have become a
    // directory; only a file is a copy to remove.
    if (await isFile(fromRel(treeDir, rel))) stale.push(rel);
  }
  return stale;
}

/** Whether a file under an install tree is provably a copy an earlier install wrote. */
async function isAbandonedCopy({ tree, rel, abs, skillDirs }) {
  if (tree === AGENTS_TREE) {
    const [opening, marker] = ((await readFileMaybe(abs)) ?? "").split("\n", 2);
    return opening === "---" && marker.startsWith(AGENT_MARKER) && marker.endsWith(AGENT_PROVENANCE);
  }
  return skillDirs.some((dir) => rel.startsWith(`${dir}/`));
}

/**
 * Directories that hold no file surviving this prune, deepest first.
 *
 * Only directories on the path to a removed file are candidates: one that was
 * empty before the prune ran, or that holds something the prune keeps, was not
 * emptied by this run and is not the installer's to remove. The set is computed
 * from the plan, so a dry run reports exactly what a real run would delete.
 *
 * The tree root is never included: this returns what may be removed, and the
 * caller only removes directories that are genuinely empty.
 */
async function dirsEmptiedBy(treeDir, stale) {
  const removing = new Set(stale);
  const candidates = ancestorDirs(stale);
  const emptied = [];
  const walk = async (dir, prefix) => {
    let empty = true;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (candidates.has(rel) && (await walk(join(dir, entry.name), rel))) emptied.push(rel);
        else empty = false;
      } else if (!removing.has(rel)) {
        empty = false;
      }
    }
    return empty;
  };
  await walk(treeDir, "");
  return emptied;
}

/** Every directory a set of "/"-joined paths sits under, the tree root excluded. */
function ancestorDirs(rels) {
  const dirs = new Set();
  for (const rel of rels) {
    const parts = rel.split("/").slice(0, -1);
    for (let depth = 1; depth <= parts.length; depth += 1) dirs.add(parts.slice(0, depth).join("/"));
  }
  return dirs;
}

/** Remove a directory this prune emptied; one a concurrent writer refilled stays. */
async function removeEmptyDir(dir) {
  try {
    await rmdir(dir);
  } catch (err) {
    if (err.code !== "ENOTEMPTY" && err.code !== "ENOENT") throw err;
  }
}

/** Every file under `dir`, as "/"-joined paths relative to it. */
async function listFilesDeep(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFilesDeep(join(dir, entry.name), rel)));
    else files.push(rel);
  }
  return files;
}

/** Resolve a "/"-joined path recorded relative to a tree root. */
function fromRel(treeDir, rel) {
  return join(treeDir, ...rel.split("/"));
}

/**
 * The ownership record of the previous install, or no owned paths when there is
 * none — pruning then falls back to the evidence rules rather than treating the
 * whole tree as ours.
 */
async function readInstallManifest(output, warn) {
  const target = join(output, MANIFEST_FILE);
  const raw = await readFileMaybe(target);
  const none = { [AGENTS_TREE]: [], [SKILLS_TREE]: [] };
  if (raw === null) return none;
  const parsed = tryParseJsonObject(raw);
  if (parsed === null) {
    warn(`${target} is not a JSON object — pruning only what it can prove is stale`);
    return none;
  }
  const rejected = [];
  const trustedPaths = (tree) =>
    stringList(parsed[tree]).filter((rel) => {
      if (isPlainTreePath(rel)) return true;
      rejected.push(`${tree}/${rel}`);
      return false;
    });
  const manifest = { [AGENTS_TREE]: trustedPaths(AGENTS_TREE), [SKILLS_TREE]: trustedPaths(SKILLS_TREE) };
  if (rejected.length > 0) {
    // The record is hand-editable and is the one input that authorises a
    // deletion, so a path that could resolve outside its tree is not trusted.
    warn(`${target} records paths that leave the trees this installer owns — ignoring them: ${rejected.join(", ")}`);
  }
  return manifest;
}

/**
 * Whether a recorded path is a plain relative path inside its tree.
 *
 * `fromRel` joins the segments, which normalises `..`, `.`, `//` and a trailing
 * slash, so an entry carrying any of those could delete a path the record does
 * not name — including the copy this very run wrote. Only the shapes the
 * installer itself records pass.
 */
function isPlainTreePath(rel) {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\") || /^[a-zA-Z]:/.test(rel)) return false;
  const segments = rel.split("/").filter((segment) => segment !== "" && segment !== ".");
  return segments.length > 0 && !segments.includes("..") && segments.join("/") === rel;
}

/** Record the paths this install owns, so the next one can prune what the source drops. */
async function writeInstallManifest(output, owned) {
  const target = join(output, MANIFEST_FILE);
  const content = `${JSON.stringify(
    {
      [GENERATED_KEY]:
        "GENERATED by `agent-cortex install pi` — the installed paths a later install may prune. DO NOT EDIT.",
      ...owned,
    },
    null,
    2,
  )}\n`;
  // Nothing else is guaranteed to have created <output> yet: a source with no
  // agents and no skills writes no copies, so the record is the first write.
  await mkdir(output, { recursive: true });
  await writeFile(target, content);
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
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
async function installConfig({ root, packageRoot, output, dryRun, warn }) {
  return {
    settings: await installSettings({ root, packageRoot, output, dryRun, warn }),
    keybindings: await installKeybindings({ root, output, dryRun, warn }),
  };
}

async function installSettings({ root, packageRoot, output, dryRun, warn }) {
  const template = await readTemplateJson(join(root, SETTINGS_TEMPLATE), warn);
  if (template === null) return null;

  const target = join(output, "settings.json");
  const merged = mergeSettings(template, await readJsonObject(target, warn));
  merged.packages = resolvePackages(template.packages, packageRoot, dirname(target));
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
 * The main working tree `root` belongs to when it is a linked git worktree, or
 * null when it is the repo's main checkout — or not inside a repo at all.
 *
 * A linked worktree is the only git checkout whose `.git` is a file rather than
 * a directory, so every other case is settled without spawning git. git itself
 * then distinguishes a worktree from a submodule, which shares one git dir.
 */
async function findMainWorkingTree(root) {
  if (!(await isFile(join(root, ".git")))) return null;

  let stdout;
  try {
    ({ stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "--git-dir", "--git-common-dir"]));
  } catch (err) {
    throw new Error(
      `cannot determine the main working tree of ${root} (${err.message}) — run "agent-cortex install pi" from the main checkout`,
    );
  }
  // Both paths are reported relative to the same directory, so comparing them as
  // text is sound; an unchanged git dir means root owns its repo (main checkout).
  const [gitDir, commonDir] = stdout.trim().split("\n");
  if (!commonDir || commonDir === gitDir) return null;
  return dirname(resolve(root, commonDir));
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
  if (!resolved) out.unshift({ source: repoSource, skills: [] });
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
