// The selection and reporting half of `ctx uninstall`: which harness installs a
// run covers, the flags a non-interactive shell gets instead of a prompt, and
// the report. Removal itself lives in each harness's installer, beside its
// install path — this module never touches an artifact and never runs a command.
//
// Two questions the parent spec left open are settled here, and the help text
// and the report repeat the answers:
//
//   • `--all` removes harness installs and their registrations only. The
//     agent-cortex CLI stays: the package manager that installed it owns its
//     removal. The shared ~/.agent-cortex root stays too, because it holds
//     records that outlive a harness install (legacy-sweep.json, scopes.json).
//     The report states which of the two it left.
//   • A worktree under .agent-cortex/worktrees/ that a ralph run created is
//     never deleted, even by `--all`. This command did not create it, it may
//     hold uncommitted work, and an open worktree is least destructive to
//     report than to remove. Anything found is listed with the git command that
//     removes it.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** @typedef {import("./harness-versions.mjs").HarnessStatus} HarnessStatus */

/** The path ralph creates worktrees below, relative to the repository root. */
const WORKTREE_DIR = [".agent-cortex", "worktrees"];

/**
 * One harness install in the uninstall report.
 * @typedef {object} UninstallEntry
 * @property {string} harness
 * @property {"removed" | "absent" | "incomplete"} status `absent` means there
 *   was nothing to remove, `incomplete` means the files are gone but the
 *   harness registration is still outstanding
 * @property {string[]} actions What was removed, in the order it was removed
 * @property {string[]} commands The harness CLI commands that ran, or would run
 * @property {string[]} warnings
 */

/**
 * The harnesses a prompt may offer to remove: only the ones with an artifact
 * root. A harness that was never installed cannot be uninstalled, so it is not
 * a row — selecting one would only produce a no-op.
 * @param {HarnessStatus[]} statuses
 * @returns {HarnessStatus[]}
 */
export function installedHarnesses(statuses) {
  return statuses.filter((status) => status.staleness !== "missing");
}

/**
 * The instructions a non-interactive `ctx uninstall` prints instead of
 * prompting. The exit code is non-zero, so a script never mistakes "nothing
 * chosen" for "nothing to do".
 * @param {string} programName The resolved command name
 * @returns {string} Text without a trailing newline
 */
export function formatUninstallFlags(programName) {
  return [
    "No harness selected, and this shell is not interactive. Pass a selection:",
    `  ${programName} uninstall <harness>...   remove the named harness installs`,
    `  ${programName} uninstall --all          remove every installed harness (the explicit opt-in when unattended)`,
    `  ${programName} uninstall --dry-run      print what would be removed and write nothing`,
  ].join("\n");
}

/**
 * Read a yes/no answer. Only an explicit yes proceeds: the default on every
 * other answer — including a blank one and a closed input stream — is to change
 * nothing, because `--all` is destructive and a prompt must not act on a
 * keystroke the user did not mean.
 * @param {string} answer
 * @returns {boolean}
 */
export function parseConfirmation(answer) {
  return /^y(es)?$/i.test(answer.trim());
}

/**
 * List the worktrees a ralph run created below the current repository root.
 * Read-only on purpose: the caller reports them and leaves them.
 * @param {{ cwd: string }} options
 * @returns {Promise<{ path: string, names: string[] } | null>} null when there is none
 */
export async function findWorktrees({ cwd }) {
  const path = join(cwd, ...WORKTREE_DIR);
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return null;
  }
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return names.length === 0 ? null : { path, names };
}

/**
 * Render the outcome of an uninstall.
 * @param {object} options
 * @param {UninstallEntry[]} options.entries
 * @param {boolean} [options.dryRun]
 * @param {string | null} [options.sharedRoot] The shared root that survives, when it does
 * @param {{ path: string, names: string[] } | null} [options.worktrees]
 * @returns {string} Text without a trailing newline
 */
export function formatUninstallReport({ entries, dryRun = false, sharedRoot = null, worktrees = null }) {
  /** @type {string[]} */
  const lines = [];
  for (const entry of entries) {
    if (entry.status === "absent") {
      lines.push(`${entry.harness}: already absent — nothing to remove`);
      continue;
    }
    if (entry.status === "incomplete") {
      lines.push(`${entry.harness}: partially removed — the harness registration is still outstanding`);
    } else {
      lines.push(`${entry.harness}: ${dryRun ? "would remove" : "removed"}`);
    }
    for (const command of entry.commands) {
      lines.push(`  ${dryRun ? "→ would run" : "✓ ran"} ${command}`);
    }
    for (const action of entry.actions) {
      lines.push(`  ${dryRun ? "→ would remove" : "✓ removed"} ${action}`);
    }
    for (const warning of entry.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
  }
  if (sharedRoot !== null) {
    lines.push(
      `Left in place: the agent-cortex CLI (your package manager owns it) and the shared ${sharedRoot} root — ` +
        "its records (legacy-sweep.json, scopes.json) survive a harness uninstall",
    );
  }
  if (worktrees !== null) {
    lines.push(
      `Left in place: ${worktrees.names.length} worktree(s) under ${worktrees.path} (${worktrees.names.join(", ")}) — ` +
        'this command never deletes a worktree it did not create; remove one with "git worktree remove <path>"',
    );
  }
  if (dryRun) lines.push("(dry-run — nothing written)");
  return lines.join("\n");
}
