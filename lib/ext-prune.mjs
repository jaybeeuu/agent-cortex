// Pure helpers for `agent-cortex ext prune` (see docs/ideas/extension-manifests.md).
//
// Prune is the inverse of `agent-cortex ext install`: it uninstalls a
// locally-installed extension through the harness's own CLI, and NEVER touches
// the committed manifest — dropping an extension from the manifest stays a
// manual edit + commit in GitHub.
//
// Like lib/extension-manifest.mjs this module is pure: formatting, selection
// parsing and invocation building only — no I/O, no spawning, no prompting.

/** Suffix marking an entry the committed manifest declares (it would come back). */
const DECLARED_SUFFIX = ' (declared — "ext install" would reinstall it)';

/**
 * The command that uninstalls `source` for `harness`.
 *
 *   pi      → pi remove <source>                (rewrites settings.json packages)
 *   claude  → claude plugin uninstall <id> -y   (-y: no prompt in a pipe)
 *
 * @param {"pi"|"claude"} harness
 * @param {string} source
 * @param {{ piBin?: string, claudeBin?: string }} [bins]
 * @returns {{ command: string, args: string[] }}
 */
export function uninstallInvocation(harness, source, { piBin = "pi", claudeBin = "claude" } = {}) {
  if (harness === "pi") return { command: piBin, args: ["remove", source] };
  if (harness === "claude") return { command: claudeBin, args: ["plugin", "uninstall", source, "-y"] };
  throw new Error(`no uninstall mechanism is defined for harness "${harness}"`);
}

/**
 * Render the selectable list: one numbered row per entry, in store order.
 *
 * @param {{ source: string, declared?: boolean }[]} entries
 * @returns {string[]}
 */
export function formatExtensionList(entries) {
  const width = String(entries.length).length;
  return entries.map(
    (entry, index) =>
      `${String(index + 1).padStart(width)}) ${entry.source}${entry.declared === true ? DECLARED_SUFFIX : ""}`,
  );
}

/**
 * Interpret one answer to the selection prompt.
 *
 * An empty answer, "q" or "quit" quits; a 1-based number inside the list picks
 * that row; anything else is `invalid` and the caller re-prompts.
 *
 * @param {string} answer
 * @param {number} count  Number of selectable rows
 * @returns {{ index: number } | { quit: true } | { invalid: true }}
 */
export function parseSelection(answer, count) {
  const text = String(answer ?? "").trim();
  if (text === "" || /^q(uit)?$/i.test(text)) return { quit: true };
  if (!/^\d+$/.test(text)) return { invalid: true };
  const number = Number.parseInt(text, 10);
  if (number < 1 || number > count) return { invalid: true };
  return { index: number - 1 };
}
