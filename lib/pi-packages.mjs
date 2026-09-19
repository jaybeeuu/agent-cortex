// Pi third-party package provisioning.
//
// agent-cortex's pi harness needs tools that live in third-party pi packages:
// ask_questions comes from pi-questions, fetch_content from pi-web-access (see
// token-map.json notes and docs/ideas/extension-manifests.md). Those packages
// are declared in the package manifest — package.json → pi.packages — and this
// module makes them real: `agent-cortex install pi` reads the declaration and
// installs any package the pi user scope is missing.
//
// Provisioning goes through the pi CLI (`pi install <source>`), which both
// installs the package under ~/.pi/agent/npm and declares it in
// ~/.pi/agent/settings.json — the same store pi loads packages from. It is
// opt-in (installPi option `provisionPackages`) and idempotent: a package that
// is already declared and installed is skipped. A failed install warns and the
// rest continue, so an offline machine never breaks the agent install.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_WARN = (msg) => console.warn(`[pi-packages] ${msg}`);

/**
 * Read the pi package sources agent-cortex declares it needs.
 *
 * @param {string} root Package root containing package.json
 * @returns {Promise<string[]>} Declared sources, e.g. ["npm:pi-questions"]
 */
export async function loadRequiredPackages(root) {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
  const packages = manifest?.pi?.packages;
  return Array.isArray(packages) ? packages.filter((entry) => typeof entry === "string") : [];
}

/**
 * Extract the npm package name from a pi source string.
 *
 * @param {string} source e.g. "npm:pi-web-access@0.10.7", "npm:@scope/pkg"
 * @returns {string | null} The name, or null for sources we cannot inspect locally
 */
export function npmSourceName(source) {
  if (typeof source !== "string" || !source.startsWith("npm:")) return null;
  const spec = source.slice("npm:".length);
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

/**
 * Decide which required packages still need installing.
 *
 * A package is satisfied only when it is both declared in settings (so pi loads
 * it) and present in the npm store (so it is installed) — otherwise it needs a
 * `pi install` to reconcile.
 *
 * @param {string[]} required
 * @param {{ declaredSources: string[], installedNames: string[] }} state
 * @returns {string[]} The sources still to install
 */
export function planPackageInstalls(required, { declaredSources, installedNames }) {
  const declared = new Set(declaredSources.map(npmSourceName).filter(Boolean));
  const installed = new Set(installedNames);
  return required.filter((source) => {
    const name = npmSourceName(source);
    return name === null || !declared.has(name) || !installed.has(name);
  });
}

/**
 * Install every required package the pi user scope is missing.
 *
 * @param {object} options
 * @param {string[]} options.required        Declared pi sources (see loadRequiredPackages)
 * @param {string} options.piRoot            Pi user scope dir (default ~/.pi/agent)
 * @param {boolean} [options.dryRun]         Report the plan without installing
 * @param {(source: string) => Promise<{ok: boolean, error: string | null}>} [options.runInstall]
 * @param {(msg: string) => void} [options.warn]
 * @returns {Promise<{planned: string[], installed: string[], failed: {source: string, error: string}[]}>}
 */
export async function provisionPiPackages({
  required,
  piRoot,
  dryRun = false,
  runInstall = runPiInstall,
  warn = DEFAULT_WARN,
}) {
  const declaredSources = await readDeclaredSources(join(piRoot, "settings.json"));
  const installedNames = await readInstalledNames(join(piRoot, "npm", "node_modules"));
  const planned = planPackageInstalls(required, { declaredSources, installedNames });

  if (dryRun) return { planned, installed: [], failed: [] };

  const installed = [];
  const failed = [];
  for (const source of planned) {
    const result = await runInstall(source);
    if (result.ok) {
      installed.push(source);
    } else {
      failed.push({ source, error: result.error });
      warn(`could not install pi package ${source}: ${result.error}`);
    }
  }
  return { planned, installed, failed };
}

/** Install one pi package source through the pi CLI. */
export function runPiInstall(source) {
  return new Promise((resolve) => {
    const child = spawn("pi", ["install", source], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.resume(); // drain; only failures are interesting
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      resolve({
        ok: false,
        error: err.code === "ENOENT" ? "pi CLI not found on PATH" : err.message,
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        error: code === 0 ? null : stderr.trim() || `pi install exited with code ${code}`,
      });
    });
  });
}

// ─── Pi user-scope inspection ────────────────────────────────────────────────

/** Read the package sources declared in a pi settings.json (missing or unreadable → none). */
async function readDeclaredSources(settingsPath) {
  let settings;
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf-8"));
  } catch {
    // Nothing declared yet, or a file pi itself owns and repairs. Provisioning is
    // a non-essential step — it must never fail the agent install.
    return [];
  }
  const packages = Array.isArray(settings?.packages) ? settings.packages : [];
  return packages
    .map((entry) => (typeof entry === "string" ? entry : entry?.source))
    .filter((source) => typeof source === "string");
}

/** List installed package names in the pi npm store (missing dir → none). */
async function readInstalledNames(nodeModulesDir) {
  let entries;
  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("@")) {
      names.push(entry.name);
      continue;
    }
    for (const scoped of await readdir(join(nodeModulesDir, entry.name), { withFileTypes: true })) {
      if (scoped.isDirectory()) names.push(`${entry.name}/${scoped.name}`);
    }
  }
  return names;
}
