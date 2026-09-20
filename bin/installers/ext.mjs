// Extension installer: agent-cortex ext install --harness pi|claude
//
// Reads the committed per-harness manifest (lib/extension-manifest.mjs) and
// installs each declared THIRD-PARTY extension through that harness's own
// installer:
//
//   pi      → pi install <source>            (npm:, git:, or a raw URL)
//   claude  → claude plugin install <id> -y  (<plugin>@<marketplace>)
//
// The install is deliberately conservative:
//   • Idempotent — a source already present in the harness's local store is
//     skipped, so a second run installs nothing.
//   • Graceful — one extension failing (offline, missing binary, bad source)
//     warns and lets the rest proceed; the caller reports the partial failure.
//   • `--dry-run` never installs or writes anything — it only reads each
//     harness's local store to build the plan.
//
// The CLI NEVER edits a manifest: adding/removing extensions is an edit +
// commit in GitHub (the manifest is the reviewed source of truth).
//
// Zero dependencies so it runs on the CI Node and local Node alike.

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestFileFor, parseManifest, planInstalls, packageSources } from "../../lib/extension-manifest.mjs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// pi writes user-scope installs to ~/.pi/agent/settings.json; the same file the
// pi installer manages. The committed manifest is the durable declaration.
const DEFAULT_PI_STORE = join(homedir(), ".pi", "agent", "settings.json");

const DEFAULT_WARN = (msg) => console.warn(`[ext-installer] ${msg}`);

/**
 * Default command runner. Injected in tests so the suite never spawns a real
 * `pi` or `claude`. Resolves `{ code, stdout, error? }` — a spawn failure (for
 * example a missing binary) resolves with `code: null` and `error` set rather
 * than rejecting, so the caller can degrade gracefully per extension.
 *
 * @param {{command: string, args: string[], capture?: boolean}} invocation
 */
function spawnRunner({ command, args, capture = false }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: capture ? ["ignore", "pipe", "ignore"] : "inherit" });
    let stdout = "";
    if (capture && child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => (stdout += chunk));
    }
    child.on("error", (error) => resolve({ code: null, stdout, error }));
    child.on("exit", (code) => resolve({ code, stdout }));
  });
}

/**
 * Install the extensions declared in a harness manifest.
 *
 * @param {object} options
 * @param {"pi"|"claude"} options.harness
 * @param {string} [options.root]          Package root, for the default manifest path
 * @param {string} [options.manifestPath]  Override the manifest file path
 * @param {string} [options.piStore]       pi settings.json to read installed packages from
 * @param {boolean} [options.dryRun]       Plan only — never spawns an install
 * @param {(invocation: {command: string, args: string[], capture?: boolean}) => Promise<{code: number|null, stdout: string, error?: Error}>} [options.run]
 * @param {(msg: string) => void} [options.warn]
 * @param {string} [options.piBin]         pi binary name (default "pi")
 * @param {string} [options.claudeBin]     claude binary name (default "claude")
 * @returns {Promise<{harness:string, manifestPath:string, dryRun:boolean,
 *   plan:{source:string, description?:string, action:"install"|"skip", status:string, error?:string}[],
 *   installed:number, skipped:number, failed:number}>}
 */
export async function installExtensions(options = {}) {
  const {
    harness,
    root = PACKAGE_ROOT,
    dryRun = false,
    run = spawnRunner,
    warn = DEFAULT_WARN,
    piBin = "pi",
    claudeBin = "claude",
  } = options;
  const manifestPath = options.manifestPath ?? manifestFileFor(root, harness);
  const piStore = options.piStore ?? DEFAULT_PI_STORE;

  const manifest = await readManifest(manifestPath, harness);
  const installed = new Set(await readInstalled({ harness, piStore, run, warn, claudeBin }));

  const plan = [];
  let installedCount = 0;
  let skipped = 0;
  let failed = 0;

  for (const step of planInstalls(manifest.extensions, installed)) {
    if (step.action === "skip") {
      skipped += 1;
      plan.push({ ...step, status: "already-installed" });
      continue;
    }
    if (dryRun) {
      installedCount += 1;
      plan.push({ ...step, status: "would-install" });
      continue;
    }

    const outcome = await installOne({ harness, source: step.source, run, piBin, claudeBin });
    if (outcome.ok) {
      installed.add(step.source);
      installedCount += 1;
      plan.push({ ...step, status: "installed" });
    } else {
      failed += 1;
      warn(`${step.source} — ${outcome.error}`);
      plan.push({ ...step, status: "failed", error: outcome.error });
    }
  }

  return { harness, manifestPath, dryRun, plan, installed: installedCount, skipped, failed };
}

async function readManifest(manifestPath, harness) {
  let raw;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`no ${harness} extension manifest at ${manifestPath} — the package should ship one`);
    }
    throw err;
  }
  return parseManifest(raw, { path: manifestPath, expectedHarness: harness });
}

/** Sources already present in the harness's local extension store. */
async function readInstalled({ harness, piStore, run, warn, claudeBin }) {
  if (harness === "pi") {
    const settings = await readJsonObject(piStore, warn);
    return packageSources(settings.packages);
  }
  const out = await run({ command: claudeBin, args: ["plugin", "list", "--json"], capture: true });
  if (out.code !== 0) {
    warn(`could not list installed claude plugins${out.error ? ` (${out.error.message})` : ""} — assuming none are installed`);
    return [];
  }
  return parseClaudePluginList(out.stdout);
}

/** Plugin ids from `claude plugin list --json`; unreadable output counts as none. */
function parseClaudePluginList(stdout) {
  try {
    const entries = JSON.parse(stdout);
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => entry?.id).filter((id) => typeof id === "string" && id !== "");
  } catch {
    return [];
  }
}

async function installOne({ harness, source, run, piBin, claudeBin }) {
  const invocation =
    harness === "pi"
      ? { command: piBin, args: ["install", source] }
      : { command: claudeBin, args: ["plugin", "install", source, "-y"] };
  const label = `${invocation.command} ${invocation.args.join(" ")}`;
  const out = await run(invocation);
  if (out.error) return { ok: false, error: `failed to run "${label}": ${out.error.message}` };
  if (out.code === 0) return { ok: true };
  return { ok: false, error: `"${label}" exited ${out.code}` };
}

/** Read a JSON object, treating a missing file as `{}` and bad JSON as a warning. */
async function readJsonObject(filePath, warn) {
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    warn(`${filePath} is not valid JSON — assuming no extensions are installed`);
    return {};
  }
}
