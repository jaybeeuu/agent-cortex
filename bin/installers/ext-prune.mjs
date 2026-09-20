// Extension pruner: agent-cortex ext prune [--harness pi|claude]
//
// Lists the extensions installed in the harness's LOCAL store, then uninstalls
// the one the user picks through that harness's own CLI:
//
//   pi      → pi remove <source>                (rewrites settings.json packages)
//   claude  → claude plugin uninstall <id> -y
//
// Prune is local-only and the deliberate inverse of `agent-cortex ext install`:
// the committed manifest is never written here. Dropping an extension from the
// manifest stays a manual edit + commit in GitHub, which is what makes
// experiment → prune-locally → curate-the-manifest safe.
//
// The prompt is a plain readline numbered list (no runtime dependencies, so it
// runs on the CI Node and local Node alike): pick a row by number, confirm, and
// the list is offered again until it is empty or the user quits. A dry-run
// prints the same list and removes nothing.
//
// Zero LLM calls, no third-party TUI: the caller owns stdin/stdout so tests can
// drive the whole flow through a pipe.

import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestFileFor, parseManifest } from "../../lib/extension-manifest.mjs";
import { formatExtensionList, parseSelection, uninstallInvocation } from "../../lib/ext-prune.mjs";
import { DEFAULT_PI_STORE, listInstalledExtensions, spawnRunner } from "./ext-store.mjs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DEFAULT_WARN = (msg) => console.warn(`[ext-prune] ${msg}`);

/**
 * List the locally-installed extensions and uninstall the selected ones.
 *
 * @param {object} options
 * @param {"pi"|"claude"} options.harness
 * @param {boolean} [options.dryRun]        List only — never prompts or spawns
 * @param {string}  [options.root]          Package root, for the committed manifest
 * @param {string}  [options.manifestPath]  Override the manifest path (declared markers)
 * @param {string}  [options.piStore]       pi settings.json to read
 * @param {import("node:stream").Readable}  [options.input]   Defaults to process.stdin
 * @param {import("node:stream").Writable}  [options.output]  Defaults to process.stdout
 * @param {(invocation: {command: string, args: string[], capture?: boolean}) => Promise<{code: number|null, stdout: string, error?: Error}>} [options.run]
 * @param {(msg: string) => void} [options.warn]
 * @param {string}  [options.piBin]         pi binary name (default "pi")
 * @param {string}  [options.claudeBin]     claude binary name (default "claude")
 * @returns {Promise<{harness: string, dryRun: boolean, entries: {source: string, declared?: boolean}[],
 *   pruned: string[], failed: string[], cancelled: boolean}>}
 */
export async function pruneExtensions(options = {}) {
  const {
    harness,
    dryRun = false,
    root = PACKAGE_ROOT,
    run = spawnRunner,
    warn = DEFAULT_WARN,
    input = process.stdin,
    output = process.stdout,
    piBin = "pi",
    claudeBin = "claude",
  } = options;
  const piStore = options.piStore ?? DEFAULT_PI_STORE;
  const manifestPath = options.manifestPath ?? manifestFileFor(root, harness);

  const declared = await readDeclaredSources(manifestPath, warn);
  const sources = await listInstalledExtensions({ harness, piStore, run, warn, claudeBin });
  const entries = sources.map((source) => (declared.has(source) ? { source, declared: true } : { source }));

  output.write(`Locally-installed "${harness}" extensions${storeLabel({ harness, piStore })}:\n`);
  if (entries.length === 0) {
    output.write("  (none)\n");
    return { harness, dryRun, entries, pruned: [], failed: [], cancelled: false };
  }

  if (dryRun) {
    printList(entries, output);
    output.write("(dry-run — nothing removed)\n");
    return { harness, dryRun, entries, pruned: [], failed: [], cancelled: false };
  }

  let remaining = entries;
  const pruned = [];
  const failed = [];
  let cancelled = false;

  const prompter = new LinePrompter({ input, output });
  try {
    while (remaining.length > 0) {
      const choice = await askSelection({ entries: remaining, prompter, output });
      if (choice.quit) {
        cancelled = true;
        break;
      }

      const entry = remaining[choice.index];
      if (!(await askConfirmation({ entry, prompter }))) continue;

      const outcome = await removeOne({ harness, source: entry.source, run, piBin, claudeBin });
      if (outcome.ok) {
        pruned.push(entry.source);
        remaining = remaining.filter((candidate) => candidate.source !== entry.source);
        output.write(`  ✓ removed ${entry.source}\n`);
      } else {
        failed.push(entry.source);
        output.write(`  ⚠ ${entry.source} — ${outcome.error}\n`);
      }
    }
  } finally {
    prompter.close();
  }

  output.write(`  ${pruned.length} removed, ${failed.length} failed, ${remaining.length} left in the local store\n`);
  return { harness, dryRun, entries, pruned, failed, cancelled };
}

/** Where the listed extensions came from, for the report header. */
function storeLabel({ harness, piStore }) {
  return harness === "pi" ? ` (${piStore})` : ' (`claude plugin list`)';
}

function printList(entries, output) {
  for (const row of formatExtensionList(entries)) output.write(`  ${row}\n`);
}

/**
 * Offer the list and read one choice. Re-prompts on anything unparseable, and
 * reports `quit` when the user quits or the input ends.
 *
 * @returns {Promise<{index: number} | {quit: true}>}
 */
async function askSelection({ entries, prompter, output }) {
  printList(entries, output);
  for (;;) {
    const answer = await prompter.ask("Select an extension to prune (number, or q to quit): ");
    if (answer === null) return { quit: true };
    const parsed = parseSelection(answer, entries.length);
    if (!("invalid" in parsed)) return parsed;
    output.write("  Enter a number from the list, or q to quit.\n");
  }
}

/** Ask before removing, defaulting to no. */
async function askConfirmation({ entry, prompter }) {
  const answer = await prompter.ask(`Remove "${entry.source}" from the local store? [y/N] `);
  return answer !== null && /^y(es)?$/i.test(answer.trim());
}

/**
 * Sequential line prompts over one readline interface.
 *
 * One interface for the whole session is what makes a piped run work: readline
 * hands every line it has already received to the "line" listener, and closes
 * itself the moment the input ends — a fresh interface per question would drop
 * the buffered answers, and questioning a closed one throws. Answers that
 * arrive before a prompt is shown are queued, and a question asked after the
 * input ended resolves as `null` so the command exits cleanly.
 */
class LinePrompter {
  #rl;
  #output;
  #queued = [];
  #pending = null;
  #ended = false;

  constructor({ input, output }) {
    this.#output = output;
    this.#rl = createInterface({ input, output, terminal: input.isTTY === true });
    this.#rl.on("line", (line) => this.#deliver(line));
    this.#rl.on("close", () => {
      this.#ended = true;
      this.#deliver(null);
    });
  }

  /** Show `prompt` and resolve the next answer, or `null` once the input ended. */
  ask(prompt) {
    // A closed interface cannot render a prompt (and would throw trying), so an
    // abandoned pipe gets the question as plain text and an immediate answer.
    if (this.#ended) {
      this.#output.write(prompt);
    } else {
      this.#rl.setPrompt(prompt);
      this.#rl.prompt();
    }

    if (this.#queued.length > 0) return Promise.resolve(this.#queued.shift());
    if (this.#ended) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.#pending = resolve;
    });
  }

  close() {
    this.#rl.close();
  }

  #deliver(value) {
    const pending = this.#pending;
    this.#pending = null;
    if (pending) pending(value);
    else if (value !== null) this.#queued.push(value);
  }
}

/** Uninstall one source through its harness CLI. */
async function removeOne({ harness, source, run, piBin, claudeBin }) {
  const invocation = uninstallInvocation(harness, source, { piBin, claudeBin });
  const label = `${invocation.command} ${invocation.args.join(" ")}`;
  const out = await run(invocation);
  if (out.error) return { ok: false, error: `failed to run "${label}": ${out.error.message}` };
  if (out.code === 0) return { ok: true };
  return { ok: false, error: `"${label}" exited ${out.code}` };
}

/**
 * Sources the committed manifest declares, so the list can flag entries that
 * `agent-cortex ext install` would put straight back. Best effort: a missing or
 * unreadable manifest only costs the marker.
 */
async function readDeclaredSources(manifestPath, warn) {
  try {
    const raw = await readFile(manifestPath, "utf-8");
    return new Set(parseManifest(raw, { path: manifestPath }).extensions.map((entry) => entry.source));
  } catch (err) {
    warn(`could not read ${manifestPath} (${err.message}) — extensions will not be marked as declared`);
    return new Set();
  }
}
