// Local extension stores: what each harness has installed right now.
//
// `agent-cortex ext install` reads a store to skip what is already there, and
// `agent-cortex ext prune` reads the same store to offer what can be removed —
// so both share this module instead of each parsing settings/plugin lists
// their own way.
//
//   pi      → ~/.pi/agent/settings.json `packages` (written by pi install/remove)
//   claude  → `claude plugin list --json`
//
// Zero dependencies, async only, and every side effect (spawning, warning)
// injected so the callers stay testable.

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { packageSources } from "../../lib/extension-manifest.mjs";

/** pi writes user-scope installs to ~/.pi/agent/settings.json. */
export const DEFAULT_PI_STORE = join(homedir(), ".pi", "agent", "settings.json");

/**
 * Default command runner. Injected in tests so the suite never spawns a real
 * `pi` or `claude`. Resolves `{ code, stdout, error? }` — a spawn failure (for
 * example a missing binary) resolves with `code: null` and `error` set rather
 * than rejecting, so the caller can degrade gracefully.
 *
 * @param {{command: string, args: string[], capture?: boolean}} invocation
 */
export function spawnRunner({ command, args, capture = false }) {
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
 * Sources already present in `harness`'s local extension store: pi package
 * sources, or claude plugin ids.
 *
 * @param {object} options
 * @param {"pi"|"claude"} options.harness
 * @param {string} options.piStore              pi settings.json to read
 * @param {(invocation: {command: string, args: string[], capture?: boolean}) => Promise<{code: number|null, stdout: string, error?: Error}>} options.run
 * @param {(msg: string) => void} options.warn
 * @param {string} options.claudeBin
 * @returns {Promise<string[]>}
 */
export async function listInstalledExtensions({ harness, piStore, run, warn, claudeBin }) {
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
export function parseClaudePluginList(stdout) {
  try {
    const entries = JSON.parse(stdout);
    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => entry?.id).filter((id) => typeof id === "string" && id !== "");
  } catch {
    return [];
  }
}

/** Read a JSON object, treating a missing file as `{}` and bad JSON as a warning. */
export async function readJsonObject(filePath, warn) {
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
