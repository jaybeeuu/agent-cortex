// Pi harness installer: agent-cortex install pi
//
// MATERIALISES agent-cortex as a self-contained pi package in a home-scoped
// directory (~/.agent-cortex/pi) instead of writing into pi's own user
// directories (~/.pi/agent/…) — the pi analogue of the Claude installer's
// ~/.agent-cortex/claude — and then REGISTERS it with pi through pi's own
// `pi install <path>` / `pi remove <source>` package commands. Staging only
// writes below the output directory; registration never writes pi's settings
// itself, it drives the CLI that owns them.
//
// Generated tree:
//
//   <output>/package.json            pi manifest — keywords ["pi-package"],
//                                    pi.extensions + pi.skills (conventional
//                                    dirs plus the bundled third-party packages)
//   <output>/agents/<slug>.agent.md  composed flat agents (agents/<name>/
//                                    agent.md + pi/ harness dirs, {{TOOL:...}} /
//                                    {{PATH:...}} substituted against
//                                    token-map.json's pi column). pi package
//                                    rules have no agent resource type: the
//                                    shipped agent-modes extension resolves
//                                    <extension>/../../agents, i.e. this dir
//   <output>/skills/<group>/<name>/  token-substituted skill copies — real
//                                    files, never symlinks
//   <output>/extensions/             copy of the repo extensions/ tree (loaded
//                                    by pi's package discovery)
//   <output>/token-map.json          the map agent-modes reads from the package
//                                    root when composing agents
//   <output>/node_modules/<pkg>/     the required third-party pi packages
//                                    (ask_questions from pi-questions,
//                                    fetch_content from pi-web-access) and
//                                    their transitive closure
//
// Composition per the token-map.json contract:
//   1. {{SECTION:name}} is resolved from the agent's pi/<name>.md section file
//      (shared composer, scripts/lib/compose-agent.mjs).
//   2. {{TOOL:key}} is substituted with the pi column; a null pi mapping drops
//      the token from prose with a warning.
//   3. {{PATH:key}} named keys resolve through the paths table; bare relative
//      paths resolve against the plugin root (default: token-map.json's pi
//      value, which points at this staged package; overridable with
//      --plugin-root for checkout/symlinked installs).
// Frontmatter tool lists are translated the same way agent-modes does at
// runtime: canonical → pi column, null → omitted, unknown (native pi tool) →
// pass through.
//
// Third-party packages: the agents need tools that live in other pi packages.
// They are ordinary runtime dependencies of this package, and the staged tree
// ships its own copy of each (plus its closure) under node_modules/ — pi loads
// a local directory and resolves nothing itself, so a staged package without
// them would hand the agents a model with no ask_questions/fetch_content.
// Resolution goes through Node (createRequire(import.meta.url).resolve), so it
// is hoist-agnostic: isolated, hoisted, nested, and global installs all work.
// A dependency that cannot be resolved fails the install.
//
// Re-staging is idempotent: the installer clears the children it owns before
// writing, so a re-run never accumulates stale copies.
//
// pi's own user settings (settings.json, keybindings.json) are NOT written by
// the installer: they are pi's config, not the package's, and `pi install` is
// the command that owns them. They are READ (never written) to decide
// install-vs-no-op and to find stale raw-repo sources; the committed pi/*.json
// templates remain reference copies.
//
// Registration (registerPi) is idempotent by STATE, not by exit code: the
// configured package sources decide install-vs-no-op, so a re-run after
// `git pull && agent-cortex install pi` is a true no-op (a local package source
// is read from disk on every pi start — there is nothing to refresh). Sources
// pointing at a raw agent-cortex checkout (this package's own repo name) are
// removed first, so exactly one agent-cortex source stays configured; a source
// that survives its removal fails the run, because two configured sources both
// load. If the `pi` CLI is missing, the installer warns and prints the exact
// commands, exiting non-zero only with --require-register.
//
//   node bin/agent-cortex.mjs install pi
//                               materialises into ~/.agent-cortex/pi AND
//                               registers that directory with pi (user scope)
//   node bin/agent-cortex.mjs install pi --output <dir>
//                               stages into <dir> only — no registration (tests/CI)
//   node bin/agent-cortex.mjs install pi --dry-run
//                               reports the staging and registration plan
//                               without writing or spawning anything
//
// Zero dependencies so it runs on the CI Node and local Node alike.

import { readFile, writeFile, mkdir, copyFile, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname, resolve } from "node:path";
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

// Home-scoped staged package. pi loads it by path once registered, so nothing
// is written into ~/.pi/agent. Overridable via --output (tests/CI) or HOME
// (node's os.homedir() honours $HOME on POSIX).
const DEFAULT_OUTPUT = join(homedir(), ".agent-cortex", "pi");

// Name of the generated package. `private` because it is a staged build
// artifact, never published.
const STAGED_NAME = "@jaybeeuu/agent-cortex-pi";

// Children of the output directory this installer owns. They are removed
// before every write so re-staging cannot leave stale copies behind (a skill
// deleted in the repo, a package dropped from the manifest). Anything else in
// the output directory is left alone.
const OWNED_CHILDREN = ["package.json", "token-map.json", "agents", "skills", "extensions", "node_modules"];

const GENERATED_MARKER =
  "GENERATED by `agent-cortex install pi` — DO NOT EDIT; re-run the installer to update.";

// The `pi` CLI that owns package registration. Overridable in tests via piBin.
const DEFAULT_PI_BIN = "pi";

// pi's user settings file — READ ONLY here (registration writes through the
// CLI). Its directory is also the base pi resolves relative package sources
// against. Overridable in tests via settingsPath.
const DEFAULT_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

// Source prefixes pi does not treat as local directories (packages.md:
// npm:, git:, https/github URLs, and built-in extension names).
const NON_LOCAL_PREFIXES = ["npm:", "git:", "github:", "http:", "https:", "ssh:", "builtin:"];

const DEFAULT_WARN = (msg) => console.warn(`[pi-installer] ${msg}`);

/**
 * Stage the agent-cortex pi package.
 *
 * @param {object} options
 * @param {string} [options.root]        Package root (defaults to this file's repo)
 * @param {string} [options.output]      Staged package dir (default ~/.agent-cortex/pi)
 * @param {boolean} [options.dryRun]     Report the plan without writing anything
 * @param {string} [options.pluginRoot]  Override plugin_root used for {{PATH:...}}
 *                                       resolution (default: token-map pi value)
 * @param {(name: string, fromDir?: string) => string | Promise<string>} [options.resolvePackage]
 *                                       Resolve an installed dependency to its
 *                                       directory (default: Node resolution from
 *                                       this package's own install)
 * @param {(msg: string) => void} [options.warn] Warning sink, also collected in `warnings`
 * @returns {Promise<{ output: string, agents: {name: string, filePath: string}[],
 *             skills: {skills: number, md: number, files: number, dir: string},
 *             extensions: {files: number, dir: string},
 *             packages: {dir: string, bundled: string[], staged: string[], resources: {extensions: string[], skills: string[]}},
 *             manifest: {path: string, manifest: object},
 *             tokenMap: string, warnings: string[], dryRun: boolean }>}
 */
export async function installPi(options = {}) {
  const root = options.root ?? PACKAGE_ROOT;
  const output = options.output ?? DEFAULT_OUTPUT;
  const dryRun = options.dryRun ?? false;
  const resolvePackage = options.resolvePackage ?? resolveFromNode;
  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    (options.warn ?? DEFAULT_WARN)(msg);
  };

  if (resolve(output) === resolve(root)) {
    throw new Error(`refusing to stage the pi package into the package root ${output} — the installer clears its own output tree`);
  }

  const tokenMap = await loadTokenMap(root);
  if (typeof tokenMap.version === "number" && tokenMap.version > CONTRACT_VERSION) {
    throw new Error(
      `token-map.json version ${tokenMap.version} is newer than the contract version ${CONTRACT_VERSION} this installer implements — upgrade agent-cortex`,
    );
  }

  const pluginRoot = options.pluginRoot ?? tokenMap.paths.plugin_root?.[PI];

  // Resolve the bundled packages before clearing the output: an unresolvable
  // dependency must fail the install without destroying the previous staging.
  const dependencies = await resolvePiPackages({ root, resolvePackage });

  if (!dryRun) {
    for (const child of OWNED_CHILDREN) {
      await rm(join(output, child), { recursive: true, force: true });
    }
    await mkdir(output, { recursive: true });
  }

  const agents = await installAgents({ root, agentsDir: join(output, "agents"), dryRun, pluginRoot, tokenMap, warn });
  const skills = await installSkills({ root, skillsDir: join(output, "skills"), dryRun, pluginRoot, tokenMap, warn });
  const extensions = await installExtensions({ root, output, dryRun });
  const tokenMapFile = await installTokenMap({ output, tokenMap, dryRun });
  const packages = await stagePiPackages({ dependencies, output, resolvePackage, dryRun, warn });
  const manifestObject = await buildManifest({ root, dependencies });
  // Verify before writing the manifest: a package whose declared resources are
  // missing is not loadable, so it must never be reported as staged.
  if (!dryRun) {
    await verifyManifestResources({ output, manifest: manifestObject });
    await writeManifest({ output, manifest: manifestObject });
  }
  const manifest = { path: join(output, "package.json"), manifest: manifestObject };

  return {
    output,
    agents,
    skills,
    extensions,
    packages,
    manifest,
    tokenMap: tokenMapFile,
    warnings,
    dryRun,
  };
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

  let skills = 0;
  let md = 0;
  let files = 0;
  for (const group of (await readdir(skillsSrc)).sort()) {
    const groupDir = join(skillsSrc, group);
    if (!(await isDirectory(groupDir))) continue;
    for (const name of (await readdir(groupDir)).sort()) {
      if (!(await isFile(join(groupDir, name, "SKILL.md")))) continue;
      skills += 1;
      const stats = await copyTree(join(groupDir, name), join(skillsDir, group, name), { dryRun, transform });
      md += stats.md;
      files += stats.files;
    }
  }
  return { skills, md, files, dir: skillsDir };
}

// ─── Extensions ──────────────────────────────────────────────────────────────

/**
 * Copy the repo's extensions/ tree into the staged package verbatim.
 *
 * The extensions import `@earendil-works/*`, which pi's loader supplies, so no
 * dependency tree is needed. `node_modules` (pnpm workspace links) and symlinks
 * are never copied: the staged package owns its dependencies and must contain
 * real files only.
 */
async function installExtensions({ root, output, dryRun }) {
  const src = join(root, "extensions");
  const dir = join(output, "extensions");
  if (!(await isDirectory(src))) return { files: 0, dir };
  const { files } = await copyTree(src, dir, { dryRun });
  return { files, dir };
}

// ─── Token map ───────────────────────────────────────────────────────────────

/**
 * Ship token-map.json alongside agents/ — agent-modes loads it from the package
 * root, so the staged extensions keep the same source of truth as the checkout.
 */
async function installTokenMap({ output, tokenMap, dryRun }) {
  const path = join(output, "token-map.json");
  if (!dryRun) await writeFile(path, `${JSON.stringify(tokenMap, null, 2)}\n`);
  return path;
}

// ─── Third-party pi packages ─────────────────────────────────────────────────

/**
 * Resolve the pi packages this package depends on.
 *
 * Every declared runtime dependency is resolved and inspected: one that ships
 * pi resources (a `pi` manifest key) is bundled into the staged package, and
 * its declared resource paths are rewritten relative to node_modules/ so the
 * generated manifest loads them. Ordinary dependencies are left to the usual
 * module resolution.
 *
 * @returns {Promise<{packages: {name: string, dir: string}[], resources: {extensions: string[], skills: string[]}}>}
 */
async function resolvePiPackages({ root, resolvePackage }) {
  const packages = [];
  const resources = { extensions: [], skills: [] };

  for (const name of await readDirectDependencies(root)) {
    const dir = await resolvePackage(name);
    const manifest = await readJsonObject(join(dir, "package.json"));
    if (manifest === null || manifest.pi === undefined) continue;

    packages.push({ name, dir });
    for (const type of ["extensions", "skills"]) {
      for (const entry of asStringList(manifest.pi[type])) {
        resources[type].push(`node_modules/${name}/${stripRelative(entry)}`);
      }
    }
  }

  return { packages, resources };
}

/**
 * Copy the resolved packages and their transitive closure into <output>/node_modules.
 *
 * The walk resolves every dependency from its dependent's own directory, so the
 * source layout is irrelevant. Copies are real files (never symlinks) and stay
 * flat, matching what pi loads from a local package; a package that resolves to
 * two different versions keeps the first and warns.
 */
async function stagePiPackages({ dependencies, output, resolvePackage, dryRun, warn }) {
  const staged = new Map();
  const pending = dependencies.packages.map(({ name, dir }) => ({ name, dir }));

  while (pending.length > 0) {
    const { name, dir } = pending.shift();
    const seen = staged.get(name);
    if (seen !== undefined) {
      if (seen !== dir) warn(`pi package "${name}" resolves to two directories (${seen}, ${dir}) — keeping the first`);
      continue;
    }
    staged.set(name, dir);
    for (const dependency of await readDependencyNames(dir)) {
      pending.push({ name: dependency, dir: await resolvePackage(dependency, dir) });
    }
  }

  const nodeModulesDir = join(output, "node_modules");
  if (!dryRun) {
    for (const [name, dir] of staged) await copyTree(dir, join(nodeModulesDir, name), {});
  }
  return {
    dir: nodeModulesDir,
    bundled: dependencies.packages.map(({ name }) => name),
    staged: [...staged.keys()],
    resources: dependencies.resources,
  };
}

/**
 * Node's own resolution from this package's install — hoist-agnostic by
 * construction. A package's `package.json` is not always exported, so the
 * package directory is found by resolving an entry point and walking up to the
 * enclosing manifest that names it.
 */
async function resolveFromNode(name, fromDir = PACKAGE_ROOT) {
  const req = createRequire(join(fromDir, "package.json"));
  let entry = null;
  for (const specifier of [name, `${name}/package.json`]) {
    try {
      entry = req.resolve(specifier);
      break;
    } catch {
      // try the next form — `exports` may hide either subpath
    }
  }
  if (entry === null) {
    throw new Error(`cannot resolve pi package "${name}" from ${fromDir} — run \`pnpm install\` first`);
  }

  let dir = dirname(entry);
  while (true) {
    const manifest = await readJsonObject(join(dir, "package.json"));
    if (manifest?.name === name) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`cannot locate the package directory of "${name}" resolved from ${fromDir}`);
    dir = parent;
  }
}

async function readDirectDependencies(root) {
  const manifest = await readJsonObject(join(root, "package.json"));
  return manifest === null ? [] : Object.keys(manifest.dependencies ?? {});
}

async function readDependencyNames(dir) {
  const manifest = await readJsonObject(join(dir, "package.json"));
  return manifest === null ? [] : Object.keys(manifest.dependencies ?? {});
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register the staged package with pi so pi loads its resources.
 *
 * Registration goes through pi's own package commands — `pi install <path>`
 * appends a local-path entry to pi's user `settings.json` (user scope, no
 * copying) and `pi remove <source>` drops one — because pi owns that file. The
 * installer only READS it, to decide the plan by state:
 *
 *   `packages` already holds the staged path  → no install (local package
 *     sources are read from disk on every pi start, so a re-run after
 *     `git pull && agent-cortex install pi` is a true no-op)
 *   a source resolves to a raw agent-cortex checkout (this package's own name)
 *     → `pi remove` it first, so exactly one agent-cortex source stays
 *
 * A superseded source that survives its removal fails the run: pi would load
 * both sources side by side, so reporting success would leave the very state
 * this step exists to prevent. Nothing is installed on that path, and the
 * error names the source still configured.
 *
 * When the `pi` CLI cannot be run, the staged package is left unregistered:
 * the installer warns, prints the exact commands, and fails only with
 * `requireRegister` (the file side of the install already succeeded).
 *
 * @param {object} options
 * @param {string} [options.root]          Package root whose package.json name
 *                                         identifies stale raw-repo sources
 * @param {string} [options.output]        Staged package dir (default ~/.agent-cortex/pi)
 * @param {string} [options.settingsPath]  pi user settings (read only)
 * @param {string} [options.piBin]         The `pi` executable (default: `pi` from PATH)
 * @param {boolean} [options.dryRun]       Plan and report without spawning anything
 * @param {boolean} [options.requireRegister] Throw when registration cannot run
 * @param {(msg: string) => void} [options.warn] Warning sink (default: console.warn)
 * @returns {Promise<{ output: string, piBin: string, registered: boolean,
 *             removed: string[], commands: string[][], dryRun: boolean }>}
 */
export async function registerPi({
  root = PACKAGE_ROOT,
  output = DEFAULT_OUTPUT,
  settingsPath = DEFAULT_SETTINGS_PATH,
  piBin = DEFAULT_PI_BIN,
  dryRun = false,
  requireRegister = false,
  warn = DEFAULT_WARN,
} = {}) {
  const stagedPath = resolve(output);
  const rawPackageName = (await readJsonObject(join(root, "package.json")))?.name;
  const sources = await readConfiguredPackages(settingsPath);
  const { registered, stale } = await classifySources({ sources, settingsPath, stagedPath, rawPackageName });

  // The same sequence a human would run by hand, in the order the installer
  // runs it: drop the superseded sources, then register the staged package.
  const manualCommands = [...stale.map(({ path }) => `${piBin} remove ${path}`), `${piBin} install ${stagedPath}`];

  const summary = { output: stagedPath, piBin, registered: false, removed: [], commands: [], dryRun };
  for (const { path } of stale) summary.commands.push(["remove", path]);
  if (!registered) summary.commands.push(["install", stagedPath]);

  console.log(`Registering the staged pi package with pi (via ${piBin})…`);

  if (dryRun) {
    console.log(`  would read: ${settingsPath} (install-vs-no-op and stale raw-repo sources)`);
    for (const { path } of stale) console.log(`  would run: ${piBin} remove ${path}`);
    if (registered) console.log(`  already configured: ${stagedPath}`);
    else console.log(`  would run: ${piBin} install ${stagedPath}`);
    console.log("(dry-run — no pi state written)");
    return summary;
  }

  // Nothing to change: do not spawn the CLI at all (a re-run is a true no-op).
  if (summary.commands.length === 0) {
    console.log(`  ✓ Already configured — ${stagedPath} (no-op)`);
    summary.registered = true;
    return summary;
  }

  const probe = await probePi(piBin);
  if (!probe.ok) {
    warn(
      `pi CLI "${piBin}" ${probe.detail} — the package is staged at ${stagedPath} but NOT registered with pi. ` +
        `Complete registration manually with:\n` +
        manualCommands.map((command) => `  ${command}`).join("\n"),
    );
    if (requireRegister) {
      throw new Error("registration required (--require-register) but the pi CLI cannot drive it — run the commands above and re-run");
    }
    return summary;
  }

  for (const { path } of stale) {
    try {
      console.log(`  ${piBin} remove ${path}`);
      await runPiCommand(piBin, ["remove", path]);
      summary.removed.push(path);
    } catch (err) {
      // Two configured sources both load, so a source we cannot drop means the
      // registration failed — installing now would leave pi with a raw repo
      // checkout and the staged package at once, and every re-run would repeat
      // the same non-converging cycle. Fail instead of reporting success.
      throw new Error(
        `${err.message} — the superseded source is still configured: ${path}. ` +
          `Remove it with "${piBin} remove ${path}" and re-run`,
      );
    }
  }

  // The plan reaches here with an install to run: the staged path is not
  // configured yet (a registered staged path returns as a no-op above).
  if (!(await isDirectory(stagedPath))) {
    throw new Error(`nothing staged at ${stagedPath} — run "agent-cortex install pi" without --dry-run first`);
  }
  console.log(`  ${piBin} install ${stagedPath}`);
  await runPiCommand(piBin, ["install", stagedPath]);

  summary.registered = true;
  console.log(`Registered — verify with "${piBin} list" and "${piBin} config" (restart pi to apply).`);
  return summary;
}

/**
 * Local package sources configured in pi's settings file, in order. pi stores
 * each entry as a source string or a `{ source, … }` filter object.
 */
async function readConfiguredPackages(settingsPath) {
  const settings = await readJsonObject(settingsPath);
  const packages = settings?.packages;
  if (!Array.isArray(packages)) return [];
  return packages.map(packageSource).filter((source) => source !== undefined);
}

function packageSource(entry) {
  if (typeof entry === "string") return entry;
  return typeof entry?.source === "string" ? entry.source : undefined;
}

function isLocalSource(source) {
  return !NON_LOCAL_PREFIXES.some((prefix) => source.trim().startsWith(prefix));
}

/**
 * Resolve a configured source the way pi does: relative to the directory
 * holding the settings file, with `~` expanded.
 */
function resolveSourcePath(source, settingsDir) {
  const trimmed = source.trim();
  const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  return resolve(settingsDir, expanded);
}

/**
 * Split the configured local sources into "the staged package is already
 * registered" and "a raw agent-cortex checkout superseded by it". A source
 * whose directory is gone is left alone: a missing path cannot be told apart
 * from a temporarily absent one, and removing it could drop a package the user
 * still wants.
 */
async function classifySources({ sources, settingsPath, stagedPath, rawPackageName }) {
  const settingsDir = dirname(settingsPath);
  const stale = [];
  let registered = false;
  for (const source of sources) {
    if (!isLocalSource(source)) continue;
    const path = resolveSourcePath(source, settingsDir);
    if (path === stagedPath) {
      registered = true;
      continue;
    }
    if (rawPackageName === undefined) continue;
    if ((await readJsonObject(join(path, "package.json")))?.name === rawPackageName) stale.push({ path });
  }
  return { registered, stale };
}

/**
 * Probe whether the `pi` CLI can be run at all, with output suppressed.
 * Resolves `{ ok: true }` or `{ ok: false, detail }` naming the failure.
 */
function probePi(piBin) {
  return new Promise((resolve) => {
    const child = spawn(piBin, ["--version"], { stdio: "ignore" });
    child.on("error", (err) =>
      resolve({ ok: false, detail: `cannot be run (${err.message}) — is pi installed and on PATH?` }),
    );
    child.on("exit", (code, signal) =>
      resolve(
        code === 0
          ? { ok: true }
          : { ok: false, detail: code === null ? `was terminated by ${signal}` : `"${piBin} --version" exited ${code}` },
      ),
    );
  });
}

/** Run one pi package command, inheriting its output; rejects on failure. */
function runPiCommand(piBin, args) {
  const label = `${piBin} ${args.join(" ")}`;
  return new Promise((resolve, reject) => {
    const child = spawn(piBin, args, { stdio: "inherit" });
    child.on("error", (err) => reject(new Error(`failed to run "${label}": ${err.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else if (code !== null) reject(new Error(`"${label}" exited ${code}`));
      else reject(new Error(`"${label}" was terminated by ${signal}`));
    });
  });
}

// ─── Manifest ────────────────────────────────────────────────────────────────

/**
 * Build the staged package's pi manifest.
 *
 * pi's package rules do the loading: conventional dirs are declared explicitly
 * so the bundled packages' resources are included alongside ./extensions and
 * ./skills (one pi-visible source, no tokenised repo copies).
 */
async function buildManifest({ root, dependencies }) {
  const pkg = await readJsonObject(join(root, "package.json"));
  return {
    "//": GENERATED_MARKER,
    name: STAGED_NAME,
    version: typeof pkg?.version === "string" ? pkg.version : "0.0.0",
    private: true,
    description: "agent-cortex pi resources — generated by `agent-cortex install pi`",
    type: "module",
    keywords: ["pi-package"],
    pi: {
      extensions: ["./extensions", ...dependencies.resources.extensions],
      skills: ["./skills", ...dependencies.resources.skills],
    },
  };
}

async function writeManifest({ output, manifest }) {
  const path = join(output, "package.json");
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return { path, manifest };
}

/**
 * Prove the manifest references real resources before reporting a success: a
 * staged package whose declared extension or skill path does not exist would
 * load silently short of the tools the agents expect.
 */
async function verifyManifestResources({ output, manifest }) {
  const declared = [...manifest.pi.extensions, ...manifest.pi.skills];
  const missing = [];
  for (const rel of declared) {
    if (!(await pathExists(join(output, rel)))) missing.push(rel);
  }
  if (missing.length > 0) {
    throw new Error(`staged pi manifest references missing resources: ${missing.join(", ")}`);
  }
}

// ─── Copying ─────────────────────────────────────────────────────────────────

/**
 * Recursively copy a tree, optionally transforming file contents. `.md` files
 * go through `transform` when supplied; everything else is copied verbatim.
 * `node_modules` and symlinks are never copied.
 */
async function copyTree(src, dest, { dryRun = false, transform = null } = {}) {
  let files = 0;
  let md = 0;
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    if (entry.isSymbolicLink()) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      const stats = await copyTree(from, to, { dryRun, transform });
      files += stats.files;
      md += stats.md;
    } else if (entry.isFile()) {
      files += 1;
      const isMarkdown = entry.name.endsWith(".md");
      if (isMarkdown) md += 1;
      if (dryRun) continue;
      await mkdir(dest, { recursive: true });
      if (isMarkdown && transform !== null) await writeFile(to, transform(await readFile(from, "utf-8")));
      else await copyFile(from, to);
    }
  }
  return { files, md };
}

// ─── Small helpers ───────────────────────────────────────────────────────────

/** `./skills/` → `skills` — a package resource path relative to its own root. */
function stripRelative(entry) {
  return entry.replace(/^\.\//, "").replace(/\/$/, "");
}

function asStringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

async function readJsonObject(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
