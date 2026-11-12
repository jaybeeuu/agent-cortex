// The selection and reporting half of `ctx update`: which harnesses a refresh
// covers, how the table and the report read, and the interactive prompt.
//
// Delegation is not here. The caller injects `refresh(harness)`, which the CLI
// wires to the harness installers — so update-vs-install stays the installer's
// decision and this module never writes an artifact itself.

import { homedir } from "node:os";
import { collectHarnessStatus } from "./harness-versions.mjs";

/** @typedef {import("./harness-versions.mjs").HarnessStatus} HarnessStatus */

const NOT_INSTALLED = "not installed";
const UNKNOWN = "unknown";

/**
 * One refreshed harness in the update report.
 * @typedef {object} UpdateEntry
 * @property {string} harness
 * @property {string} previous The version before the refresh, or "not installed"
 * @property {string} next The version the installer recorded afterwards
 * @property {string[]} artifacts What the installer wrote
 */

/**
 * The harnesses an update covers, and the ones it leaves alone.
 * @typedef {object} UpdatePlan
 * @property {HarnessStatus[]} targets
 * @property {HarnessStatus[]} skipped
 * @property {string[]} unknown Names that are not supported harnesses
 */

/**
 * Decide which harnesses an update refreshes. An explicit name is always a
 * target (the user asked for that installer to re-run); `--all` targets every
 * harness that is not at the CLI version; `--all --force` targets every harness.
 * @param {object} options
 * @param {HarnessStatus[]} options.statuses One entry per supported harness
 * @param {string[]} [options.harnesses] Names from the command line or the prompt
 * @param {boolean} [options.all] `ctx update -a`
 * @param {boolean} [options.force] `ctx update -a -f`
 * @returns {UpdatePlan}
 */
export function selectHarnesses({ statuses, harnesses = [], all = false, force = false }) {
  /** @type {string[]} */
  const unknown = [];
  /** @type {HarnessStatus[]} */
  let targets;
  if (harnesses.length > 0) {
    targets = [];
    for (const name of harnesses) {
      const status = statuses.find((entry) => entry.harness === name);
      if (status === undefined) {
        if (!unknown.includes(name)) unknown.push(name);
        continue;
      }
      if (!targets.includes(status)) targets.push(status);
    }
  } else if (all && force) {
    targets = [...statuses];
  } else if (all) {
    targets = statuses.filter((entry) => entry.staleness !== "current");
  } else {
    targets = [];
  }
  const skipped = statuses.filter((entry) => !targets.includes(entry));
  return { targets, skipped, unknown };
}

/**
 * Count a noun for the report: `1 file`, `4 files`.
 * @param {number} amount
 * @param {string} noun Singular form
 * @returns {string}
 */
function count(amount, noun) {
  return `${amount} ${noun}${amount === 1 ? "" : "s"}`;
}

/**
 * What a pi refresh wrote, for the update report.
 * @param {import("../bin/installers/pi.mjs").InstallPiResult} result
 * @returns {string[]}
 */
export function describePiArtifacts(result) {
  return [
    `agents (${count(result.agents.length, "file")})`,
    `skills (${count(result.skills.skills, "skill")}, ${count(result.skills.md, "markdown file")})`,
    `extensions (${count(result.extensions.files, "file")})`,
    `bundled pi packages (${result.packages.bundled.length > 0 ? result.packages.bundled.join(", ") : "none"})`,
    `package manifest (version ${result.manifest.manifest.version})`,
  ];
}

/**
 * What a claude refresh wrote, for the update report.
 * @param {import("../bin/installers/claude.mjs").InstallClaudeResult} result
 * @returns {string[]}
 */
export function describeClaudeArtifacts(result) {
  return [
    `agents (${count(result.agents.length, "file")})`,
    `skills (${count(result.skills.names.length, "skill")}, ${count(result.skills.md, "markdown file")})`,
    `hooks (${count(result.hookFiles.length, "file")})`,
    `hand-authored extras (${count(result.handAuthored.length, "file")})`,
    `plugin manifest (version ${result.pluginVersion})`,
    `settings (${result.settings?.action ?? "not written"})`,
    `instructions (${result.instructions?.action ?? "not written"})`,
  ];
}

/**
 * Refresh every target through the injected installer and report the result.
 * The new version is read back from the fingerprint the installer wrote, never
 * assumed from the CLI version, so a failed materialisation shows as unknown.
 * @param {object} options
 * @param {string} options.cli The running CLI version
 * @param {string} [options.home] Home directory holding the install roots
 * @param {HarnessStatus[]} options.targets
 * @param {(harness: string) => Promise<string[]>} options.refresh Runs one harness installer
 * @returns {Promise<UpdateEntry[]>}
 */
export async function runUpdate({ cli, home = homedir(), targets, refresh }) {
  /** @type {{ harness: string, previous: string, artifacts: string[] }[]} */
  const refreshed = [];
  for (const target of targets) {
    const artifacts = await refresh(target.harness);
    refreshed.push({ harness: target.harness, previous: target.installed ?? NOT_INSTALLED, artifacts });
  }
  if (refreshed.length === 0) return [];
  const statuses = await collectHarnessStatus({ cli, home });
  return refreshed.map((entry) => {
    const status = statuses.find((candidate) => candidate.harness === entry.harness);
    return { ...entry, next: status?.installed ?? UNKNOWN };
  });
}

/**
 * Render the harness table: one row per supported harness, so an absent
 * install is visible instead of silently missing.
 * @param {HarnessStatus[]} statuses
 * @returns {string} Text without a trailing newline
 */
export function formatHarnessTable(statuses) {
  /** @type {string[][]} */
  const rows = [["harness", "installed", "cli", "status"]];
  for (const status of statuses) {
    rows.push([status.harness, status.installed ?? NOT_INSTALLED, status.cli, status.staleness]);
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) => row.map((cell, column) => (column === widths.length - 1 ? cell : cell.padEnd(widths[column]))).join("  "))
    .join("\n");
}

/**
 * The instructions a non-interactive `ctx update` prints instead of prompting.
 * @param {string} programName The resolved command name
 * @returns {string} Text without a trailing newline
 */
export function formatUpdateFlags(programName) {
  return [
    "No harness selected, and this shell is not interactive. Pass a selection:",
    `  ${programName} update <harness>...   refresh the named harnesses`,
    `  ${programName} update -a             refresh every harness that is not at the CLI version`,
    `  ${programName} update -a -f          re-run every harness installer regardless of version`,
  ].join("\n");
}

/**
 * Render the outcome of an update. Only skipped harnesses that are already at
 * the CLI version are listed; one left alone for another reason (a stale
 * harness beside an explicit selection) is not "already at" anything.
 * @param {object} options
 * @param {string} options.cli The running CLI version
 * @param {UpdateEntry[]} options.entries
 * @param {HarnessStatus[]} [options.skipped]
 * @returns {string} Text without a trailing newline
 */
export function formatUpdateReport({ cli, entries, skipped = [] }) {
  const current = skipped.filter((entry) => entry.staleness === "current");
  /** @type {string[]} */
  const lines = [];
  for (const entry of entries) {
    lines.push(`${entry.harness} ${entry.previous} → ${entry.next}`);
    for (const artifact of entry.artifacts) {
      lines.push(`  ✓ ${artifact}`);
    }
  }
  if (entries.length === 0) {
    lines.push(`Nothing to update — every harness is at ${cli}.`);
  } else if (current.length > 0) {
    lines.push(`Skipped (already at ${cli}): ${current.map((entry) => entry.harness).join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Turn a prompt answer into harness names: row numbers, `a` for every row, or
 * blank for none.
 * @param {string} answer
 * @param {HarnessStatus[]} statuses The rows the prompt listed, in order
 * @returns {string[]}
 */
export function parseHarnessSelection(answer, statuses) {
  const trimmed = answer.trim();
  if (trimmed === "") return [];
  if (/^(a|all)$/i.test(trimmed)) return statuses.map((status) => status.harness);
  /** @type {string[]} */
  const chosen = [];
  for (const token of trimmed.split(/[,\s]+/)) {
    const index = Number(token);
    const status = Number.isInteger(index) ? statuses[index - 1] : undefined;
    if (status === undefined) {
      throw new Error(`Invalid selection "${token}". Enter row numbers 1-${statuses.length}, "a", or blank to cancel.`);
    }
    if (!chosen.includes(status.harness)) chosen.push(status.harness);
  }
  return chosen;
}

/**
 * Ask on an interactive terminal which harnesses to refresh. The table is the
 * list the user picks from; a closed input stream cancels the selection.
 * @param {object} options
 * @param {HarnessStatus[]} options.statuses
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @returns {Promise<string[]>}
 */
export async function promptHarnessSelection({ statuses, input = process.stdin, output = process.stdout }) {
  output.write(`${formatHarnessTable(statuses)}\n\n`);
  const answer = await readLine(input, output, `Select harnesses (row numbers, "a" for all, blank to cancel): `);
  return parseHarnessSelection(answer, statuses);
}

/**
 * Read one line, prompting on `output` first. A stream that ends without a
 * newline returns what it carried, so a closed stdin cancels rather than hangs.
 * @param {NodeJS.ReadableStream} input
 * @param {NodeJS.WritableStream} output
 * @param {string} question
 * @returns {Promise<string>}
 */
async function readLine(input, output, question) {
  output.write(question);
  let buffered = "";
  for await (const chunk of input) {
    buffered += String(chunk);
    const newline = buffered.indexOf("\n");
    if (newline !== -1) return buffered.slice(0, newline);
  }
  return buffered;
}
