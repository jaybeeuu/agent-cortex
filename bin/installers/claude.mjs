// Install-time generator + registrar for the Claude Code plugin. A plain
// `agent-cortex install claude` MATERIALISES the plugin into a home-scoped
// directory instead of regenerating the repo's committed claude/ subtree:
//
//   <output>/.claude-plugin/plugin.json     plugin manifest (version tracks the
//                                           package — never stale)
//   <output>/agents/<slug>.md               composed agents (agents/<name>/
//                                           agent.md + claude/ harness dirs,
//                                           {{TOOL:...}}/{{PATH:...}}
//                                           substituted against token-map.json's
//                                           claude column) plus agents-native
//                                           (ralph verbatim)
//   <output>/skills/<name>/                 skill dirs COPIED flat (one dir per
//                                           skill, as Claude's <name>/SKILL.md
//                                           plugin scan expects) with .md files
//                                           token-substituted — no symlinks, so
//                                           literal {{TOOL:...}}/{{PATH:...}}
//                                           never reaches Claude
//   <output>/hooks.json + hooks/<scripts>   from hooks/claude/ (support files
//                                           referenced via ${CLAUDE_PLUGIN_ROOT})
//   <output>/.mcp.json + scripts/           hand-authored extras copied from the
//                                           repo claude/ subtree (kept committed
//                                           there as the canonical store)
//
// Default output is ~/.agent-cortex/claude (the home install root
// ~/.agent-cortex doubles as the marketplace root — the installer writes
// ~/.agent-cortex/.claude-plugin/marketplace.json exposing ./claude, so
// `claude plugin marketplace add ~/.agent-cortex` works). `--output <dir>`
// generates the plugin subtree only — no marketplace manifest, no runtime
// registration (tests/CI). `--dry-run` plans without writing or spawning.
//
//   node bin/agent-cortex.mjs install claude
//                               materialises into ~/.agent-cortex/claude +
//                               marketplace manifest, AND registers the plugin
//                               with Claude Code via the `claude plugin` CLI
//                               (marketplace add → install → marketplace
//                               update → plugin update)
//   node bin/agent-cortex.mjs install claude --output <dir>
//                               generates only — no manifest, no registration
//   node bin/agent-cortex.mjs install claude --dry-run
//                               plans generation + registration without writing
//
// `pnpm build:claude` runs the CLI with `--output claude` (generate-only), so
// the committed subtree can still be regenerated for CI drift checks; the
// release pipeline owns retiring the committed subtree (see docs/release).
//
// Registration is idempotent by state, not by exit code: `claude plugin
// marketplace list --json` decides add-vs-update and `claude plugin list
// --json` decides install-vs-update against the materialised version — a
// re-run is the update path, and a repeat install at the same version is a
// true no-op. If the `claude` CLI is missing or predates the plugin subcommand
// (v2+), the installer warns and prints the manual registration commands,
// exiting non-zero only with --require-register.
//
// Zero dependencies so it runs on the CI Node and local Node alike.

import { readFile, writeFile, mkdir, rm, copyFile, stat, readdir, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { composeAgent, loadTokenMap, substituteTokens } from "../../scripts/lib/compose-agent.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(MODULE_DIR, "..", "..");

// Home-scoped plugin install root. The parent dir (~/.agent-cortex) is the
// marketplace root: it carries .claude-plugin/marketplace.json exposing
// ./claude, so `claude plugin marketplace add ~/.agent-cortex` points Claude
// Code at the materialised plugin. Overridable in tests via HOME (node's
// os.homedir() honours $HOME on POSIX).
const DEFAULT_OUTPUT = join(homedir(), ".agent-cortex", "claude");

// The token-map contract version this installer implements (token-map.json
// "version" field). A higher map version is rejected: the contract must be
// extended before this installer can trust it.
const CONTRACT_VERSION = 1;

const CLAUDE = "claude";

const DEFAULT_WARN = (msg) => console.warn(`[claude-installer] ${msg}`);

// Agents NOT transformed from the composable sources. `ralph` is authored natively for Claude
// instead (agents-native/ralph.md) — its event-driven orchestration can't be produced by
// section composition from the poll-loop sources.
const DEFER = new Set(["ralph"]);

// Ralph-coupled Copilot skills that don't apply to the lean Claude Ralph (and carry dead
// ~/.copilot orchestration paths). Not copied into the Claude plugin.
const SKILL_EXCLUDE = new Set(["ralph", "run-pipeline-stage"]);

const NAME_PREFIX = "agent-cortex:";

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function byName(a, b) {
  return a.localeCompare(b);
}

/** Compose agents from agents/<name>/; DEFERed agents come from agents-native/ instead. */
async function buildAgents(root) {
  const files = [];
  const skipped = [];
  const entries = (await readdir(join(root, "agents"), { withFileTypes: true })).sort((a, b) =>
    byName(a.name, b.name),
  );

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, "agents", entry.name);
    if (!(await isFile(join(dir, "agent.md"))) || !(await isFile(join(dir, "claude", "frontmatter.json")))) continue;

    if (DEFER.has(entry.name)) {
      skipped.push(entry.name);
      continue;
    }

    const fm = await composeAgent(root, entry.name, CLAUDE);
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

/** Copy hand-authored Claude-native agents into agents/ verbatim. */
async function buildNatives(root, nativeSrc) {
  const files = [];
  if (!(await isDirectory(nativeSrc))) return files;
  const names = (await readdir(nativeSrc)).filter((f) => f.endsWith(".md")).sort(byName);
  for (const file of names) {
    files.push({ file, content: await readFile(join(nativeSrc, file), "utf-8") });
  }
  return files;
}

/**
 * Copy the grouped source skills (skills/<group>/<name>/) into the plugin FLAT
 * (skills/<name>/ — Claude's plugin scan expects <name>/SKILL.md directly
 * under skills/), token-substituting .md files against token-map.json's claude
 * column (the same materialisation as bin/installers/pi.mjs: no symlinks, so
 * literal {{TOOL:...}}/{{PATH:...}} never survives; non-.md files verbatim).
 */
async function buildSkills(root, skillOut, { dryRun, pluginRoot, tokenMap, warn }) {
  const seen = new Map();
  const transform = (content) =>
    substituteTokens(content, CLAUDE, tokenMap, { dropNullTools: true, pluginRoot, resolveRelativePaths: true, warn });

  const names = [];
  let md = 0;
  let files = 0;
  for (const group of (await readdir(join(root, "skills"))).sort(byName)) {
    const groupDir = join(root, "skills", group);
    if (!(await isDirectory(groupDir))) continue;
    for (const name of (await readdir(groupDir)).sort(byName)) {
      const skillDir = join(groupDir, name);
      if (!(await isFile(join(skillDir, "SKILL.md")))) continue;
      if (SKILL_EXCLUDE.has(name)) continue;
      if (seen.has(name)) {
        throw new Error(`duplicate skill name "${name}" (${seen.get(name)} and ${group}) — names must be unique when flattened`);
      }
      seen.set(name, group);
      names.push(name);
      const stats = await copyTree(skillDir, join(skillOut, name), transform, dryRun);
      md += stats.md;
      files += stats.files;
    }
  }
  return { names, md, files, dir: skillOut };
}

/** Recursively copy a tree; transform .md file contents, copy everything else verbatim. */
async function copyTree(src, dest, transform, dryRun) {
  let md = 0;
  let files = 0;
  for (const entry of await readdir(src, { withFileTypes: true })) {
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

/** plugin.json manifest; version tracks the package so it can never go stale. */
async function buildPluginJson(root, pkg) {
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
 * Marketplace manifest exposing the plugin at <marketplaceRoot>/<basename>.
 * Lives at `<marketplaceRoot>/.claude-plugin/marketplace.json`, mirroring the
 * repo's own committed marketplace layout, so `claude plugin marketplace add
 * ~/.agent-cortex` resolves ./claude relative to the manifest's directory.
 * The default shape matches the committed repo manifest byte-for-byte.
 */
async function buildMarketplaceManifest(root, pkg, outputName) {
  return {
    name: "jaybeeuu",
    owner: { name: "jaybeeuu" },
    metadata: { description: "jaybeeuu's personal Claude Code plugins." },
    plugins: [
      {
        name: pkg.name.replace(/^@[^/]+\//, ""),
        source: `./${outputName}`,
        description: "Personal Claude Code plugin with custom agents and skills",
      },
    ],
  };
}

/**
 * Hook support files (hooks/claude/ except hooks.json) bundled into
 * hooks/ so hook commands can reference them via ${CLAUDE_PLUGIN_ROOT}.
 * hooks.json itself is special-cased to the plugin root (hooks.json).
 */
async function buildHookFiles(root) {
  const files = [];
  const srcDir = join(root, "hooks", "claude");
  if (!(await isDirectory(srcDir))) return files;
  const walk = async (dir, rel) => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => byName(a.name, b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, join(rel, entry.name));
      else if (entry.name !== "hooks.json")
        files.push({ rel: join(rel, entry.name), content: await readFile(full, "utf-8") });
    }
  };
  await walk(srcDir, "");
  return files;
}

/**
 * Hand-authored extras the plugin needs that the generators don't produce:
 * the repo's committed claude/ subtree stays the canonical store for
 * .mcp.json and scripts/, and the installer ships them to the output.
 * Content is captured at read time (not path-referenced): build:claude
 * regenerates INTO that same subtree, so the write-phase cleanup must be
 * able to clear the output dir without destroying what was just read.
 */
async function buildHandAuthored(root) {
  const items = [];
  const srcClaude = join(root, "claude");
  if (await isFile(join(srcClaude, ".mcp.json"))) {
    const mcp = join(srcClaude, ".mcp.json");
    items.push({ rel: ".mcp.json", content: await readFile(mcp), mode: (await stat(mcp)).mode & 0o777 });
  }
  const scriptsDir = join(srcClaude, "scripts");
  if (await isDirectory(scriptsDir)) {
    for (const file of (await readdir(scriptsDir)).sort(byName)) {
      const src = join(scriptsDir, file);
      if (await isFile(src)) items.push({ rel: join("scripts", file), content: await readFile(src), mode: (await stat(src)).mode & 0o777 });
    }
  }
  return items;
}

/**
 * Generate the Claude Code plugin subtree.
 *
 * @param {object} options
 * @param {string} [options.root]        Package root (contains agents/, skills/, token-map.json, …).
 *                                       Defaults to the repo containing this module.
 * @param {string} [options.output]      Plugin target dir. Defaults to ~/.agent-cortex/claude;
 *                                       the default install additionally writes the marketplace
 *                                       manifest at ~/.agent-cortex/.claude-plugin/marketplace.json.
 * @param {string} [options.pluginRoot]  Override plugin_root used for {{PATH:...}} resolution
 *                                       (default: token-map.json's claude value)
 * @param {boolean} [options.dryRun]     Plan and report without writing anything.
 * @param {(msg: string) => void} [options.warn] Warning sink, also collected in `warnings`.
 * @returns {{ output: string, marketplaceRoot: string|null, manifestPath: string|null,
 *             marketplaceManifest: object|null, agents: string[], natives: string[],
 *             skills: {names: string[], md: number, files: number, dir: string},
 *             hooks: boolean, hookFiles: string[], handAuthored: string[],
 *             warnings: string[], dryRun: boolean }}
 */
export async function installClaude({ root = PACKAGE_ROOT, output, dryRun = false, pluginRoot, warn = DEFAULT_WARN } = {}) {
  const tokenMap = await loadTokenMap(root);
  if (typeof tokenMap.version === "number" && tokenMap.version > CONTRACT_VERSION) {
    throw new Error(
      `token-map.json version ${tokenMap.version} is newer than the contract version ${CONTRACT_VERSION} this installer implements — upgrade agent-cortex`,
    );
  }

  const warnings = [];
  const warnSink = (msg) => {
    warnings.push(msg);
    warn(msg);
  };

  const out = output ?? DEFAULT_OUTPUT;
  // The marketplace manifest is part of the home install (default target) only:
  // --output is generate-only (tests/CI), matching its no-registration semantics.
  const isDefaultInstall = output === undefined;
  const marketplaceRoot = isDefaultInstall ? dirname(out) : null;
  const manifestPath = isDefaultInstall ? join(marketplaceRoot, ".claude-plugin", "marketplace.json") : null;

  const rootPlugin = pluginRoot ?? tokenMap.paths.plugin_root?.[CLAUDE];

  // Read hand-authored extras from the canonical subtree BEFORE the cleanup
  // below: with `--output claude` (build:claude) the output dir IS root/claude,
  // so clearing it first would destroy .mcp.json/scripts/ at their source and
  // they'd never ship. They are re-copied fresh in the write phase. In dry-run
  // nothing is cleaned or written.
  const cleanable = ["agents", "skills", ".claude-plugin", "hooks", "scripts", "hooks.json", ".mcp.json"];
  const handAuthored = await buildHandAuthored(root);

  // Regenerate the plugin children (removes stale output from earlier flows,
  // e.g. old symlinked skills). Must happen BEFORE the build helpers write.
  if (!dryRun) {
    for (const child of cleanable) {
      await rm(join(out, child), { recursive: true, force: true });
    }
    await mkdir(out, { recursive: true });
  }

  const agents = await buildAgents(root);
  const natives = await buildNatives(root, join(root, "agents-native"));
  const skillOut = join(out, "skills");
  const skills = await buildSkills(root, skillOut, { dryRun, pluginRoot: rootPlugin, tokenMap, warn: warnSink });
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
  const pluginJson = await buildPluginJson(root, pkg);
  const hooksSrc = join(root, "hooks", "claude", "hooks.json");
  const hooksJson = (await isFile(hooksSrc)) ? await readFile(hooksSrc, "utf-8") : null;
  const hookFiles = await buildHookFiles(root);
  const marketplaceManifest = isDefaultInstall ? await buildMarketplaceManifest(root, pkg, basename(out)) : null;

  const summary = {
    output: out,
    marketplaceRoot,
    manifestPath,
    marketplaceManifest,
    pluginVersion: pkg.version,
    agents: agents.files.map((f) => f.file.replace(/\.md$/, "")),
    natives: natives.map((f) => f.file.replace(/\.md$/, "")),
    skills: { names: skills.names, md: skills.md, files: skills.files, dir: skillOut },
    hooks: hooksJson !== null,
    hookFiles: hookFiles.map((f) => f.rel),
    handAuthored: handAuthored.map((f) => f.rel),
    warnings,
    dryRun,
  };

  if (agents.skipped.length) console.log(`Skipped composable source(s): ${agents.skipped.join(", ")}`);

  if (dryRun) {
    console.log(`DRY-RUN — would generate into ${out}, no files written:`);
    console.log(`  agents: ${summary.agents.join(", ")}`);
    if (summary.natives.length) console.log(`  native agents: ${summary.natives.join(", ")}`);
    console.log(`  skills: ${summary.skills.names.length} copied → ${skillOut}/<name>/ (token-substituted)`);
    console.log(`  .claude-plugin/plugin.json (version ${pkg.version})`);
    if (isDefaultInstall && manifestPath) {
      console.log(`  marketplace manifest → ${manifestPath} (plugin agent-cortex @ ./${basename(out)})`);
    }
    if (summary.hooks) console.log("  hooks.json (from hooks/claude/hooks.json)");
    if (summary.hookFiles.length)
      console.log(`  hook scripts: ${summary.hookFiles.join(", ")} (bundled into ${join(out, "hooks")}/)`);
    if (summary.handAuthored.length)
      console.log(`  hand-authored files: ${summary.handAuthored.join(", ")} (copied from repo claude/)`);
    return summary;
  }

  // Write phase — the cleanup before buildSkills already cleared stale children.
  const agentOut = join(out, "agents");
  await mkdir(agentOut, { recursive: true });
  for (const { file, content } of [...agents.files, ...natives]) {
    await writeFile(join(agentOut, file), content);
  }
  console.log(`Generated ${summary.agents.length} Claude agent(s): ${summary.agents.join(", ")}`);
  if (summary.natives.length) console.log(`Copied ${summary.natives.length} native Claude agent(s): ${summary.natives.join(", ")}`);

  await mkdir(skillOut, { recursive: true });
  console.log(
    `Copied ${summary.skills.names.length} skill(s) → ${skillOut}/<name>/ (token-substituted, no symlinks)`,
  );

  await mkdir(join(out, ".claude-plugin"), { recursive: true });
  await writeFile(join(out, ".claude-plugin", "plugin.json"), pluginJson);
  console.log(`Wrote ${join(out, ".claude-plugin", "plugin.json")}`);

  if (isDefaultInstall && manifestPath && marketplaceManifest) {
    const manifestDir = dirname(manifestPath);
    await mkdir(manifestDir, { recursive: true });
    await writeFile(manifestPath, JSON.stringify(marketplaceManifest, null, 2) + "\n");
    console.log(`Wrote ${manifestPath} (plugin agent-cortex @ ./${basename(out)})`);
  }

  if (summary.hooks) {
    await writeFile(join(out, "hooks.json"), hooksJson);
    console.log(`Wrote ${join(out, "hooks.json")} (from ${hooksSrc})`);

    if (hookFiles.length > 0) {
      const hookOut = join(out, "hooks");
      await mkdir(hookOut, { recursive: true });
      for (const { rel, content } of hookFiles) {
        const dest = join(hookOut, rel);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, content);
      }
      console.log(`Bundled ${hookFiles.length} hook support file(s) into ${hookOut}`);
    }
  } else {
    console.log(`Skipped hooks.json — ${hooksSrc} not found`);
  }

  if (handAuthored.length > 0) {
    for (const { rel, content, mode } of handAuthored) {
      const dest = join(out, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content);
      if (mode !== undefined) await chmod(dest, mode);
    }
    console.log(`Copied hand-authored file(s): ${summary.handAuthored.join(", ")}`);
  }

  return summary;
}
// ─── Claude Code registration ────────────────────────────────────────────────

// The `claude` CLI on PATH. Overridable in tests via the claudeBin option.
const DEFAULT_CLAUDE_BIN = "claude";

/** Validate a marketplace manifest object; returns the marketplace and plugin
 * names that `claude plugin` commands address. */
function parseMarketplaceManifest(manifest, label) {
  const marketplace = manifest.name;
  const plugin = manifest.plugins?.[0]?.name;
  if (typeof marketplace !== "string" || typeof plugin !== "string") {
    throw new Error(
      `unparsable marketplace manifest (${label}): expected { name, plugins: [{ name }] }`,
    );
  }
  return { marketplace, plugin };
}

/**
 * Read the marketplace manifest that exposes the plugin at install root
 * (<root>/.claude-plugin/marketplace.json).
 */
async function readMarketplaceManifest(root) {
  const manifestPath = join(root, ".claude-plugin", "marketplace.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `no Claude marketplace manifest at ${manifestPath} (${err.message}) — ` +
        `"agent-cortex install claude" registers the plugin by pointing Claude Code at the install root`,
    );
  }
  return { manifest, path: manifestPath };
}

/**
 * Version of the materialised plugin (<root>/<source>/.claude-plugin/plugin.json,
 * where <source> is the marketplace manifest's plugin source) — the signature a
 * directory-source marketplace exposes to `claude plugin`. Read when the version
 * is not passed explicitly; undefined when it cannot be determined.
 */
async function readMaterialisedPluginVersion(root, manifest) {
  const source = manifest.plugins?.[0]?.source;
  if (typeof source !== "string") return undefined;
  const pluginDir = source.startsWith(".") ? join(root, source) : resolve(source);
  try {
    return JSON.parse(await readFile(join(pluginDir, ".claude-plugin", "plugin.json"), "utf-8")).version;
  } catch {
    return undefined;
  }
}

/** Run one claude plugin command, inheriting its output; rejects on failure. */
function runClaudeCommand(claudeBin, args) {
  const label = `${claudeBin} ${args.join(" ")}`;
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, { stdio: "inherit" });
    child.on("error", (err) => reject(new Error(`failed to run "${label}": ${err.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else if (code !== null) reject(new Error(`"${label}" exited ${code}`));
      else reject(new Error(`"${label}" was terminated by ${signal}`));
    });
  });
}

/**
 * Probe whether `claudeBin` supports the plugin CLI by running
 * `claude plugin --help` with output suppressed. Resolves `{ ok: true }` when
 * it exits 0, otherwise `{ ok: false, message }` naming the failure (missing
 * binary vs missing subcommand) so registration can give targeted guidance.
 */
function probePluginSupport(claudeBin) {
  return new Promise((resolve) => {
    const child = spawn(claudeBin, ["plugin", "--help"], { stdio: "ignore" });
    child.on("error", (err) =>
      resolve({
        ok: false,
        message: `cannot run "${claudeBin}" (${err.message}) — is Claude Code installed and on PATH?`,
      }),
    );
    child.on("exit", (code) => {
      if (code === 0) resolve({ ok: true });
      else
        resolve({
          ok: false,
          message:
            `"${claudeBin}" lacks the "plugin" subcommand — its Claude Code build predates plugin support; ` +
            `update to a build with the plugin CLI (v2+), e.g. "pnpm add -g @anthropic-ai/claude-code@latest", and re-run`,
        });
    });
  });
}

/** Run a claude plugin command capturing stdout; null when the command fails. */
function queryClaudeCommand(claudeBin, args) {
  const label = `${claudeBin} ${args.join(" ")}`;
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", (err) => reject(new Error(`failed to run "${label}": ${err.message}`)));
    child.on("exit", (code) => {
      if (code !== 0) resolve(null);
      else resolve(stdout);
    });
  });
}

/**
 * Whether `claude plugin marketplace list` already registers `marketplace`.
 * Unparseable output counts as not-registered: the fallback `marketplace add`
 * is itself idempotent (the CLI reports "already on disk", exit 0).
 */
async function marketplaceRegistered(claudeBin, marketplace) {
  const out = await queryClaudeCommand(claudeBin, ["plugin", "marketplace", "list", "--json"]);
  if (out == null) return false;
  try {
    const entries = JSON.parse(out.trim());
    return Array.isArray(entries) && entries.some((entry) => entry?.name === marketplace);
  } catch {
    return false;
  }
}

/**
 * Installed version of `pluginId` per `claude plugin list --json`; null when
 * not installed or the output is unreadable (the caller falls back to the
 * idempotent `plugin install`).
 */
async function installedPluginVersion(claudeBin, pluginId) {
  const out = await queryClaudeCommand(claudeBin, ["plugin", "list", "--json"]);
  if (out == null) return null;
  try {
    const entries = JSON.parse(out.trim());
    const entry = Array.isArray(entries) ? entries.find((e) => e?.id === pluginId) : undefined;
    return typeof entry?.version === "string" ? entry.version : null;
  } catch {
    return null;
  }
}

/**
 * Register the materialised plugin with Claude Code by driving the `claude
 * plugin` CLI against the home install root as the marketplace source.
 * Idempotent by STATE, not by exit code (the CLI exits 0 on re-add /
 * re-install, saying "already on disk"/"already installed"):
 *
 *   `claude plugin marketplace list --json`  → add the marketplace when
 *     missing, otherwise `marketplace update` refreshes the directory source
 *     (a re-run is the documented UPDATE path)
 *   `claude plugin list --json`               → `plugin install` when not
 *     installed, `plugin update` when the materialised version is newer,
 *     nothing when the installed version already matches (a repeat install is
 *     a true no-op)
 *
 * Both reads degrade gracefully: unparseable output just runs the idempotent
 * add/install (whose non-zero exits surface as genuine failures). The manifest
 * and the materialised version come from <root>/.claude-plugin/marketplace.json
 * and the plugin source's plugin.json unless passed explicitly via
 * `manifest`/`pluginVersion` (installClaude hands both through so --dry-run
 * never needs files on disk).
 *
 * When the `claude` CLI is unusable (missing on PATH, or a build predating the
 * plugin subcommand), the installer warns loudly and prints the exact commands
 * to complete registration manually, exiting non-zero only when
 * `requireRegister` is set — the default is warn-only because the plugin is
 * already materialised by then; the file side of the install succeeded.
 *
 * @param {object} options
 * @param {string} [options.root]            Marketplace root carrying .claude-plugin/…
 *                                           (defaults to the repo containing this module)
 * @param {string} [options.claudeBin]       The `claude` executable (default: `claude` from PATH)
 * @param {boolean} [options.dryRun]         Plan and report without running or writing
 * @param {object} [options.manifest]        Pre-parsed marketplace manifest (skips the file read)
 * @param {string} [options.pluginVersion]   Materialised plugin version (default: read from plugin.json)
 * @param {boolean} [options.requireRegister] Exit non-zero when registration cannot run
 * @param {(msg: string) => void} [options.warn] Warning sink (default: console.warn)
 * @returns {{ marketplace: string, plugin: string, commands: string[][],
 *             dryRun: boolean, registered: boolean, skipped: string[] }}
 */
export async function registerClaude({
  root = PACKAGE_ROOT,
  claudeBin = DEFAULT_CLAUDE_BIN,
  dryRun = false,
  manifest,
  pluginVersion,
  requireRegister = false,
  warn = DEFAULT_WARN,
} = {}) {
  const { manifest: manifestObj, path: manifestPath } =
    manifest !== undefined ? { manifest, path: null } : await readMarketplaceManifest(root);
  const { marketplace, plugin } = parseMarketplaceManifest(manifestObj, manifestPath ?? "generated manifest");
  const pluginId = `${plugin}@${marketplace}`;
  const version = pluginVersion ?? (await readMaterialisedPluginVersion(root, manifestObj));
  const home = resolve(root);

  const summary = { marketplace, plugin, commands: [], dryRun, registered: true, skipped: [] };
  console.log(`Registering plugin "${pluginId}" with Claude Code (via ${claudeBin})…`);

  const manualCommands = [
    `${claudeBin} plugin marketplace add ${home}`,
    `${claudeBin} plugin install ${pluginId} -y`,
  ];

  if (dryRun) {
    console.log("  would query: claude plugin marketplace list --json   (add vs marketplace update by state)");
    console.log("  would query: claude plugin list --json               (install vs plugin update by version)");
    console.log(`  would run: ${manualCommands[0]}  (or "${claudeBin} plugin marketplace update ${marketplace}" when already registered)`);
    console.log(`  would run: ${manualCommands[1]}  (or "${claudeBin} plugin update ${plugin}" when a newer version is materialised)`);
    console.log("(dry-run — no Claude Code state written)");
    return summary;
  }

  // Reject unusable CLIs up-front instead of letting registration appear to
  // succeed: older Claude Code builds treat `claude plugin …` as a chat prompt.
  const probe = await probePluginSupport(claudeBin);
  if (!probe.ok) {
    warn(
      `Claude Code CLI "${claudeBin}" ${probe.message} — the plugin is materialised but NOT registered with Claude Code. ` +
        `Complete registration manually with:\n` +
        manualCommands.map((c) => `  ${c}`).join("\n"),
    );
    if (requireRegister) {
      throw new Error(
        `registration required (--require-register) but the Claude Code CLI cannot drive it — run the commands above and re-run`,
      );
    }
    summary.registered = false;
    return summary;
  }

  // Decide the sequence from the live state; unreadable state falls back to
  // the idempotent add/install (which the CLI itself short-circuits).
  const marketPresent = await marketplaceRegistered(claudeBin, marketplace);
  const installed = await installedPluginVersion(claudeBin, pluginId);

  if (marketPresent) {
    summary.commands.push(["plugin", "marketplace", "update", marketplace]);
  } else {
    summary.commands.push(["plugin", "marketplace", "add", home]);
  }

  if (installed == null) {
    summary.commands.push(["plugin", "install", pluginId, "-y"]);
  } else if (version != null && installed === version) {
    summary.skipped.push(`plugin install ${pluginId} — already installed at ${installed}`);
    summary.skipped.push(`plugin update ${plugin} — installed version matches the materialised version`);
  } else {
    summary.skipped.push(`plugin install ${pluginId} — already installed (updating ${installed} → ${version ?? "materialised"})`);
    summary.commands.push(["plugin", "update", plugin, "-y"]);
  }

  for (const args of summary.commands) {
    console.log(`  ${claudeBin} ${args.join(" ")}`);
    await runClaudeCommand(claudeBin, args);
  }
  console.log(
    `Installed — verify with "claude plugin list" / "claude plugin details ${plugin}" (restart Claude Code to apply).`,
  );
  return summary;
}