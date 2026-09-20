// Extension installer: agent-cortex ext install --harness pi|claude
//
// Reads the committed per-harness manifest (lib/extension-manifest.mjs) and
// installs each declared THIRD-PARTY extension through that harness's own
// installer:
//
//   pi      → pi install <source>            (npm:, git:, or a raw URL)
//   claude  → claude plugin install <id> -y  (<plugin>@<marketplace>)
//
// The store layout this reads and the runner it spawns live in
// ./ext-store.mjs, shared with `agent-cortex ext prune`.
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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestFileFor, parseManifest, planInstalls } from "../../lib/extension-manifest.mjs";
import { DEFAULT_PI_STORE, listInstalledExtensions, spawnRunner } from "./ext-store.mjs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DEFAULT_WARN = (msg) => console.warn(`[ext-installer] ${msg}`);

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
  const installed = new Set(await listInstalledExtensions({ harness, piStore, run, warn, claudeBin }));

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
