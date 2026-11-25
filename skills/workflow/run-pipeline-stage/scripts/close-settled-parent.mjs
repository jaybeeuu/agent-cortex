// @ts-check
// Close a settled parent bead: every child closed, and at least one piece of
// merge or post-merge evidence on record.
//
// Why this exists: the pipeline's own stages close their own chores, and
// nothing revisits the parent afterwards. `bd close <parent>` then refuses
// with "N open child issue(s)" while the gate, the post-merge check and the
// housekeeping chore are still in flight, so a bead that followed the
// documented path ends with every child closed, the parent `in_progress`, and
// a human left to notice. Both the `post-merge` and `housekeeping` playbooks
// call this script, so the closure is a deterministic step rather than a
// model's judgement.
//
// Evidence rule — a parent is settled only when a *closed* child carries the
// PR merge gate label (`lifecycle:feature-pr`) or the post-merge check label
// (`lifecycle:post-merge` / `stage:post-merge`). The gate closes after a human
// merges, and the post-merge chore closes only on a passed check, so either
// label is a merge on record. A parent whose children were all closed by hand
// and carry neither label is left alone: closing it would claim a merge that
// nothing recorded.
//
// Idempotent: a parent already closed is reported as `skipped: already closed`
// and nothing is written, so both stages may call it on every run.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A child bead as `bd children <id> --json` reports it.
 * @typedef {object} ChildBead
 * @property {string} id
 * @property {string} [status]   `open`, `in_progress`, `closed`, …
 * @property {string[]} [labels]
 */

/**
 * One closed child that records a merge, and the label that records it.
 * @typedef {object} Evidence
 * @property {string} id
 * @property {string} label
 */

/**
 * @typedef {'closed' | 'skipped'} Outcome
 * @typedef {'closed' | 'already closed' | 'children open' | 'no merge evidence'} Reason
 */

/**
 * What the script decided for one parent.
 * @typedef {object} ParentReport
 * @property {string} bead
 * @property {Outcome} outcome
 * @property {Reason} reason       `closed` when it closed the parent; otherwise why it did not
 * @property {number} closedChildren  Children read as closed
 * @property {string[]} openChildren  Children that are not closed
 * @property {Evidence[]} evidence    Closed children carrying a merge or post-merge label
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** The HITL gate a human closes once the feature PR is merged (`create-chores.mjs`). */
export const PR_GATE_LABEL = "lifecycle:feature-pr";

/**
 * The post-merge check's labels: `lifecycle:post-merge` from the pipeline
 * definition (`pipeline.json`), and the `stage:post-merge` every stage chore
 * carries. Either one marks the chore, so a chain built by hand with only the
 * stage label still counts.
 * @type {readonly string[]}
 */
export const POST_MERGE_LABELS = ["lifecycle:post-merge", "stage:post-merge"];

// BD_PATH env override lets machines where bd is not on PATH pin a location.
const BD_PATH = process.env.BD_PATH || "bd";
const execFileAsync = promisify(execFile);

// ─── Decision ─────────────────────────────────────────────────────────────────

/**
 * The label on `child` that records a merge, or `null` when it carries none.
 * @param {ChildBead} child
 * @returns {string | null}
 */
export function evidenceLabel(child) {
  const labels = child.labels ?? [];
  if (labels.includes(PR_GATE_LABEL)) return PR_GATE_LABEL;
  return POST_MERGE_LABELS.find((label) => labels.includes(label)) ?? null;
}

/**
 * Decide whether `beadId` is settled, from the bead graph alone. Pure: it reads
 * no clock and writes nothing, so the rule is testable without bd or a model.
 * @param {object} input
 * @param {string} input.beadId
 * @param {string} input.parentStatus                 The parent's own status
 * @param {ChildBead[]} input.children                The parent's children, as `bd children` reports them
 * @returns {ParentReport}
 */
export function decideSettlement({ beadId, parentStatus, children }) {
  /** @param {Reason} reason @param {{ openChildren?: string[], evidence?: Evidence[] }} [detail] */
  const skip = (reason, detail = {}) => ({
    bead: beadId,
    outcome: /** @type {const} */ ("skipped"),
    reason,
    closedChildren: children.filter((child) => child.status === "closed").length,
    openChildren: detail.openChildren ?? [],
    evidence: detail.evidence ?? [],
  });

  if (parentStatus === "closed") return skip("already closed");

  const openChildren = children.filter((child) => child.status !== "closed").map((child) => child.id);
  if (openChildren.length > 0) return skip("children open", { openChildren });

  const evidence = children.flatMap((child) => {
    const label = evidenceLabel(child);
    return label === null ? [] : [{ id: child.id, label }];
  });
  if (evidence.length === 0) return skip("no merge evidence");

  return {
    bead: beadId,
    outcome: "closed",
    reason: "closed",
    closedChildren: children.length,
    openChildren: [],
    evidence,
  };
}

// ─── bd reads and writes ──────────────────────────────────────────────────────

/** @type {(args: string[]) => Promise<string>} */
async function defaultBd(args) {
  const { stdout } = await execFileAsync(BD_PATH, args, { encoding: "utf-8" });
  return stdout;
}

/**
 * `bd show <id> --json` prints a one-element array.
 * @param {{ beadId: string, bd: (args: string[]) => Promise<string> }} input
 * @returns {Promise<{ status?: string }>}
 */
async function readParent({ beadId, bd }) {
  const parsed = JSON.parse(await bd(["show", beadId, "--json"]));
  const bead = Array.isArray(parsed) ? parsed[0] : parsed;
  if (bead === undefined || bead === null) {
    throw new Error(`bd show ${beadId} --json returned no bead`);
  }
  return bead;
}

/**
 * @param {{ beadId: string, bd: (args: string[]) => Promise<string> }} input
 * @returns {Promise<ChildBead[]>}
 */
async function readChildren({ beadId, bd }) {
  const parsed = JSON.parse(await bd(["children", beadId, "--json"]));
  if (!Array.isArray(parsed)) {
    throw new Error(`bd children ${beadId} --json did not return a list`);
  }
  return parsed;
}

/** @param {ParentReport} report @returns {string} */
function evidenceText(report) {
  return report.evidence.map(({ id, label }) => `${id} (${label})`).join(", ");
}

/** @param {ParentReport} report @returns {string} */
function settlement(report) {
  return `all ${report.closedChildren} children closed; merge evidence: ${evidenceText(report)}`;
}

/**
 * Read the bead graph, close the parent when it is settled, and report what
 * happened. bd writes the note before the close: the note is the record of the
 * evidence, and it stays true whether or not the close succeeds.
 * @param {object} input
 * @param {string} input.beadId
 * @param {(args: string[]) => Promise<string>} [input.bd]  bd runner; injectable for tests
 * @param {() => string} [input.now]                        Clock for the trail stamp; injectable for tests
 * @returns {Promise<ParentReport>}
 */
export async function closeSettledParent({ beadId, bd = defaultBd, now = () => new Date().toISOString() }) {
  const parent = await readParent({ beadId, bd });
  const children = await readChildren({ beadId, bd });
  const report = decideSettlement({ beadId, parentStatus: parent.status ?? "open", children });
  if (report.outcome !== "closed") return report;

  await bd(["note", beadId, `[${now()}] close-settled-parent: ${settlement(report)}`]);
  await bd(["close", beadId, `--reason=settled: ${settlement(report)}`]);
  return report;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = [
  "Usage: node close-settled-parent.mjs --parent <bead-id> [--json]",
  "",
  "Closes a parent bead when every child is closed and at least one closed child",
  `carries ${PR_GATE_LABEL} or one of ${POST_MERGE_LABELS.join(", ")}.`,
  "",
  "Prints one line per parent: `closed`, `skipped: children open`,",
  "`skipped: no merge evidence`, or `skipped: already closed`.",
  "",
  "Exit status: 0 when the parent was closed or nothing needed closing, 1 on a bd",
  "or read error, 2 on a usage error.",
  "",
  "Environment: BD_PATH  bd binary (default: bd)",
  "",
].join("\n");

class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @returns {{ beadId: string, json: boolean }}
 */
function parseArgs(argv) {
  /** @type {string | undefined} */
  let beadId;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--parent") {
      beadId = argv[++i];
      if (beadId === undefined) throw new UsageError("--parent needs a value");
    } else {
      throw new UsageError(`unexpected argument: ${arg}`);
    }
  }
  if (beadId === undefined) throw new UsageError("--parent is required");
  return { beadId, json };
}

/**
 * @param {ParentReport} report
 * @returns {string}
 */
function formatReport(report) {
  switch (report.reason) {
    case "closed":
      return `closed ${report.bead}: ${settlement(report)}\n`;
    case "children open":
      return `skipped: children open — ${report.bead} (${report.openChildren.join(", ")})\n`;
    case "no merge evidence":
      return `skipped: no merge evidence — ${report.bead} (no closed child carries ${PR_GATE_LABEL} or ${POST_MERGE_LABELS.join("/")})\n`;
    case "already closed":
      return `skipped: already closed — ${report.bead} (nothing to do)\n`;
  }
}

/**
 * @param {object} options
 * @param {string[]} options.argv                                   CLI arguments (without node/script)
 * @param {(args: string[]) => Promise<string>} [options.bd]         bd runner; injectable for tests
 * @param {() => string} [options.now]                               Clock; injectable for tests
 * @param {(chunk: string) => void} [options.write]                  stdout sink; injectable for tests
 * @param {(chunk: string) => void} [options.writeError]             stderr sink; injectable for tests
 * @returns {Promise<number>} process exit code
 */
export async function runCli({
  argv,
  bd,
  now,
  write = (chunk) => process.stdout.write(chunk),
  writeError = (chunk) => process.stderr.write(chunk),
}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    write(USAGE);
    return 0;
  }
  /** @type {{ beadId: string, json: boolean }} */
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeError(`close-settled-parent: ${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }
  try {
    const report = await closeSettledParent({
      beadId: options.beadId,
      ...(bd === undefined ? {} : { bd }),
      ...(now === undefined ? {} : { now }),
    });
    write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    return 0;
  } catch (error) {
    writeError(`close-settled-parent failed: ${errorMessage(error)}\n`);
    return 1;
  }
}

/** @param {unknown} error @returns {string} */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// Only run the CLI when invoked directly, so tests can import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli({ argv: process.argv.slice(2) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${errorMessage(error)}\n`);
      process.exitCode = 1;
    });
}
