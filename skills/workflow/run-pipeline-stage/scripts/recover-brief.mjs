// @ts-check
// The read side of the bead trail: one command prints a bounded brief for a bead, so a
// cold session resumes from one screen instead of a transcript.
//
// `trail-entry.mjs` appends one checkpoint per transition. `bd show <id>` returns the whole
// note, and a bead carrying 20 entries prints 118 lines and about 8 KB, most of it history
// nobody needs to continue. This script prints what a session does need — status and state
// labels, the newest trail entries, provenance refs, blocking dependencies, and the
// acceptance criteria — and enforces a line budget on its own output, so the read stays
// small however long the trail grows.
//
// Read-only. Every bd call is one of READ_ONLY_CALLS and carries `--readonly`, so the
// tracker refuses a write even if a later edit mistypes a flag. This script never runs
// `bd note`, `bd update`, `bd close` or `bd provenance record`: it reports, it never records.
//
// Zero dependencies. Run:
//
//   node recover-brief.mjs --bead <id> [--trail <n>] [--provenance <n>] [--max-lines <n>] \
//     [--cwd <dir>]
//
// The newest `--trail` entries print and the rest are summarised by count, because bd
// cannot return part of a note: its `show --json` carries the whole `notes` string, so the
// bound has to live here.

import { pathToFileURL } from 'node:url';

import {
  BD_PATH,
  UsageError,
  errorMessage,
  makeRunner,
  withRetry,
} from './trail-entry.mjs';

// ─── Contract ─────────────────────────────────────────────────────────────────

/** Trail entries printed when the caller names none. */
export const DEFAULT_TRAIL_ENTRIES = 3;

/** Provenance events printed when the caller names none. */
export const DEFAULT_PROVENANCE_EVENTS = 4;

/** The output budget, in lines. Enforced, not documented. */
export const DEFAULT_MAX_LINES = 40;

/** A field longer than this is clipped, so one value cannot eat the budget. */
export const MAX_FIELD_CHARS = 120;

/** Acceptance-criteria lines printed at most, before the rest are summarised. */
export const MAX_ACCEPTANCE_LINES = 6;

/** Blocking dependencies printed at most, before the rest are summarised. */
export const MAX_BLOCKED_LINES = 5;

/** Attempts per bd read: the first try plus two retries. */
export const DEFAULT_ATTEMPTS = 3;

/**
 * The only bd invocations this script may run, as leading argv. Anything else is refused
 * before it reaches the binary.
 */
export const READ_ONLY_CALLS = /** @type {const} */ ([
  ['show'],
  ['provenance', 'log'],
]);

/** Statuses that satisfy a blocking dependency. */
const SATISFIED_STATUSES = new Set(['closed', 'tombstone']);

/** A failure worth reporting, not retrying. */
export class BriefError extends Error {
  /**
   * @param {string} message
   * @param {{ step: string }} detail
   */
  constructor(message, { step }) {
    super(message);
    this.name = 'BriefError';
    this.step = step;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A bd call that returns stdout. @typedef {(args: string[]) => Promise<string>} Runner */

/**
 * One trail entry, parsed from the note text. A free-form note has null fields.
 * @typedef {object} TrailEntry
 * @property {string | null} at           Header timestamp, or null for a free-form note.
 * @property {string | null} stage
 * @property {string | null} fingerprint  The writer's content fingerprint, or null.
 * @property {string | null} outcome
 * @property {string | null} evidence
 * @property {string | null} remaining
 * @property {string} text                First meaningful line, for a free-form note.
 */

/** A blocking dependency of the bead being read.
 * @typedef {object} BlockingDep
 * @property {string} id
 * @property {string} status
 * @property {string} title
 */

/**
 * One provenance event, as `bd provenance log --json` prints it.
 * @typedef {object} ProvenanceEvent
 * @property {string} refKind
 * @property {string} ref
 * @property {string} createdAt
 */

/**
 * The bead fields the brief renders.
 * @typedef {object} Bead
 * @property {string} id
 * @property {string} title
 * @property {string} status
 * @property {string} type
 * @property {number} priority
 * @property {string[]} labels
 * @property {string | null} parent
 * @property {string} description
 * @property {string} acceptance
 * @property {string} notes
 * @property {BlockingDep[]} blockedBy
 */

/**
 * Everything the renderer needs, already read from the tracker.
 * @typedef {object} BriefModel
 * @property {Bead} bead
 * @property {TrailEntry[]} trail         Ordered oldest first, deduplicated.
 * @property {ProvenanceEvent[]} provenance  Ordered newest first.
 * @property {string[]} acceptance        Normalised acceptance-criteria lines.
 */

/**
 * Injected collaborators, so a test drives the script without a bead database.
 * @typedef {object} BriefDeps
 * @property {Runner} [bd]
 * @property {(ms: number) => Promise<void>} [sleep]
 */

// ─── Value helpers ────────────────────────────────────────────────────────────

/** Read a non-negative integer from the environment, falling back to `fallback`.
 * @param {string} name @param {number} fallback @returns {number} */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

/** Clip a value to the field budget, marking the cut.
 * @param {string} value @param {number} [max] @returns {string} */
export function clip(value, max = MAX_FIELD_CHARS) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The newest trail entry that recorded what is left, or null.
 * @param {TrailEntry[]} trail @returns {string | null} */
export function nextStep(trail) {
  for (let i = trail.length - 1; i >= 0; i--) {
    const remaining = trail[i].remaining;
    if (remaining !== null && remaining !== '') return remaining;
  }
  return null;
}

/**
 * What the `next:` line says. `no trail entry` is a claim about the trail itself, so it
 * prints only when the bead carries none; a bead whose entries carry no `What is left`
 * field gets a line that says exactly that instead of denying the trail exists.
 * @param {string | null} next  What is left on the newest entry that recorded it.
 * @param {number} trailLength  Entries parsed from the note.
 * @returns {string}
 */
export function nextStepLine(next, trailLength) {
  if (next !== null) return clip(next);
  if (trailLength === 0) return 'no trail entry — record a stage-start entry before working';
  return 'no entry records what is left — read the trail below';
}

// ─── Trail ────────────────────────────────────────────────────────────────────

/**
 * The writer's header line: `[<rfc3339>] [<stage>] trail:<fingerprint>`. A note appended by
 * hand may carry the first two parts only, so the fingerprint is optional.
 */
const TRAIL_HEADER = /^\[([^\]]{4,64})\]\s\[([a-z][a-z0-9-]*)\](?:\s+trail:([0-9a-f]{6,64}))?$/;

/**
 * A line that starts a bracketed field, the shape of both the writer's header and the
 * hand-written note AGENTS.md documents for a stop: `[<ISO timestamp>] stopped: …`.
 */
const ENTRY_START = /^\[[^\]]{4,64}\]/;

/**
 * The fields the writer stamps into an entry body. A stamped entry's body is exactly these
 * lines, so any other text after a header is a note someone appended by hand. Authored in
 * `buildEntry` of `trail-entry.mjs`: a field added there and not here still prints, as a
 * note of its own, rather than disappearing.
 */
const TRAIL_FIELDS = ['Outcome', 'Evidence', 'What is left', 'Refs'];

/**
 * Is this line one of the writer's `Field: value` lines?
 * @param {string} line @returns {boolean}
 */
function isFieldLine(line) {
  return TRAIL_FIELDS.some((name) => line.trim().startsWith(`${name}:`));
}

/** The first line of a note that carries no header, clipped for the brief.
 * @param {string[]} lines @returns {string} */
function firstLine(lines) {
  for (const line of lines) {
    const text = line.trim();
    if (text !== '') return text;
  }
  return '';
}

/** The value of one `Field: value` line in an entry body.
 * @param {string[]} body @param {string} name @returns {string | null} */
function fieldValue(body, name) {
  const prefix = `${name}:`;
  for (const line of body) {
    const text = line.trim();
    if (text.startsWith(prefix)) return text.slice(prefix.length).trim();
  }
  return null;
}

/** A free-form entry: a note someone appended by hand, carrying no writer fields.
 * @param {string} text @returns {TrailEntry} */
function noteEntry(text) {
  return { at: null, stage: null, fingerprint: null, outcome: null, evidence: null, remaining: null, text };
}

/**
 * Split a bead's `notes` string into trail entries. The note is one text blob: `bd` joins
 * every appended note with a single newline and marks no boundary, so the split is textual.
 *
 * - A writer header starts a stamped entry. Its body runs only over blank lines and the
 *   writer's `Field: value` lines; the first other line ends it.
 * - Any other text is a free-form entry of its own. A bracketed timestamp starts a new one,
 *   which is the shape of the hand-written stop note AGENTS.md documents.
 *
 * So a hand-appended `bd note` is an entry wherever it lands — before a stamped entry,
 * between two of them, or after the last one — rather than a line buried in the previous
 * entry's body, where the renderer would never print it.
 *
 * The one shape text cannot separate: notes that carry no bracketed start and are appended
 * back to back. `bd` joins every note with a bare newline, so such a run reads as one note.
 * The documented stop note starts with `[<ISO timestamp>]`, and so does the writer's header,
 * so the shape a session records is always separable.
 * @param {string} notes @returns {TrailEntry[]}
 */
export function splitTrail(notes) {
  /** @type {TrailEntry[]} */
  const entries = [];
  /** @type {{ at: string, stage: string, fingerprint: string | null } | null} */
  let header = null;
  /** @type {string[]} */
  let body = [];
  /** @type {string[]} */
  let note = [];

  /** Close the open stamped entry, if there is one. */
  const flushStamped = () => {
    if (header === null) return;
    entries.push({
      at: header.at,
      stage: header.stage,
      fingerprint: header.fingerprint,
      outcome: fieldValue(body, 'Outcome'),
      evidence: fieldValue(body, 'Evidence'),
      remaining: fieldValue(body, 'What is left'),
      text: firstLine(body),
    });
    header = null;
    body = [];
  };

  /** Close the open free-form entry, if it carries text. */
  const flushNote = () => {
    const text = firstLine(note);
    if (text !== '') entries.push(noteEntry(text));
    note = [];
  };

  for (const line of notes.split('\n')) {
    const match = TRAIL_HEADER.exec(line.trim());
    if (match !== null) {
      flushStamped();
      flushNote();
      header = { at: match[1], stage: match[2], fingerprint: match[3] ?? null };
      continue;
    }
    if (header !== null) {
      if (line.trim() === '' || isFieldLine(line)) {
        body.push(line);
        continue;
      }
      flushStamped();
    }
    if (ENTRY_START.test(line.trim())) flushNote();
    note.push(line);
  }
  flushStamped();
  flushNote();

  return entries;
}

/**
 * Drop a duplicate of an entry already present. The writer's fingerprint lets a reader
 * collapse a repeat that two writers raced into the note. The last occurrence wins, because
 * that is the one the append sequence ended on.
 * @param {TrailEntry[]} entries @returns {TrailEntry[]}
 */
export function dedupeTrail(entries) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {TrailEntry[]} */
  const kept = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.fingerprint !== null) {
      if (seen.has(entry.fingerprint)) continue;
      seen.add(entry.fingerprint);
    }
    kept.push(entry);
  }
  return kept.reverse();
}

// ─── Bead ─────────────────────────────────────────────────────────────────────

/**
 * The lines under a description heading, so a bead that records its acceptance criteria in
 * the description reads the same as one that used `bd create --acceptance`.
 * @param {string} description @param {RegExp} heading @returns {string[]}
 */
export function sectionLines(description, heading) {
  /** @type {string[]} */
  const lines = [];
  let level = 0;
  for (const line of description.split('\n')) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (match !== null) {
      if (level !== 0) break; // the section ended at the next heading
      if (heading.test(match[2].trim())) {
        level = match[1].length;
        continue;
      }
    } else if (level !== 0) {
      lines.push(line);
    }
  }
  return lines
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) => line !== '');
}

/**
 * The bead's acceptance criteria as display lines: the dedicated field when `bd` has one,
 * otherwise the `## Acceptance Criteria` section of the description.
 * @param {Bead} bead @returns {string[]}
 */
export function acceptanceOf(bead) {
  const field = bead.acceptance.split('\n').map((line) => line.trim().replace(/^[-*]\s+/, '')).filter((line) => line !== '');
  if (field.length > 0) return field;
  return sectionLines(bead.description, /^acceptance criteria$/i);
}

/** The dependencies that hold this bead back: `blocks` deps not yet in a satisfied status.
 * @param {unknown} dependencies @returns {BlockingDep[]} */
export function blockingDeps(dependencies) {
  if (!Array.isArray(dependencies)) return [];
  /** @type {BlockingDep[]} */
  const blockedBy = [];
  for (const entry of dependencies) {
    if (typeof entry !== 'object' || entry === null) continue;
    const dep = /** @type {Record<string, unknown>} */ (entry);
    if (dep.dependency_type !== 'blocks') continue;
    const status = typeof dep.status === 'string' ? dep.status : 'unknown';
    if (SATISFIED_STATUSES.has(status)) continue;
    blockedBy.push({
      id: typeof dep.id === 'string' ? dep.id : '(unknown)',
      status,
      title: typeof dep.title === 'string' ? dep.title : '',
    });
  }
  return blockedBy;
}

/** Read one string field, defaulting to ''. @param {Record<string, unknown>} raw @param {string} key */
function textOf(raw, key) {
  const value = raw[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Reduce `bd show --json` output to the fields the brief renders. Both shapes bd has
 * printed are accepted: a one-element array, and a bare object.
 * @param {unknown} parsed @returns {Bead}
 */
export function normaliseBead(parsed) {
  const bead = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof bead !== 'object' || bead === null) {
    throw new BriefError('bd show printed no bead', { step: 'bd show' });
  }
  const raw = /** @type {Record<string, unknown>} */ (bead);
  if (typeof raw.id !== 'string' || raw.id === '') {
    throw new BriefError('bd show printed a bead with no id', { step: 'bd show' });
  }
  const labels = Array.isArray(raw.labels)
    ? raw.labels.filter((/** @type {unknown} */ label) => typeof label === 'string')
    : [];
  return {
    id: raw.id,
    title: textOf(raw, 'title'),
    status: textOf(raw, 'status'),
    type: textOf(raw, 'issue_type'),
    priority: typeof raw.priority === 'number' ? raw.priority : 2,
    labels: /** @type {string[]} */ (labels),
    parent: typeof raw.parent === 'string' && raw.parent !== '' ? raw.parent : null,
    description: textOf(raw, 'description'),
    acceptance: textOf(raw, 'acceptance_criteria'),
    notes: textOf(raw, 'notes'),
    blockedBy: blockingDeps(raw.dependencies),
  };
}

/**
 * Reduce `bd provenance log --json` output to the events the brief renders.
 * @param {unknown} parsed @returns {ProvenanceEvent[]}
 */
export function normaliseProvenance(parsed) {
  if (!Array.isArray(parsed)) return [];
  /** @type {ProvenanceEvent[]} */
  const events = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = /** @type {Record<string, unknown>} */ (entry);
    const ref = textOf(raw, 'ref');
    if (ref === '') continue;
    events.push({
      refKind: textOf(raw, 'ref_kind') || 'ref',
      ref,
      createdAt: textOf(raw, 'created_at'),
    });
  }
  // Newest first, so the latest handover is the first line the reader sees.
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * Is this argv one of the read invocations the brief is allowed to make?
 * @param {string[]} args @returns {boolean}
 */
export function isReadOnlyCall(args) {
  return READ_ONLY_CALLS.some((prefix) => prefix.every((token, index) => args[index] === token));
}

/**
 * Wrap a runner so a write can never reach the tracker. The allow-list is the guarantee:
 * a call the brief is not allowed to make fails here, before the binary runs. `--readonly`
 * travels on every call as well, so bd refuses a write independently of this script.
 * @param {Runner} run @returns {Runner}
 */
export function makeReadOnlyBd(run) {
  return async (args) => {
    if (!isReadOnlyCall(args)) {
      throw new BriefError(`refusing a non-read bd call: ${args.join(' ')}`, { step: 'read-only guard' });
    }
    return run([...args, '--readonly']);
  };
}

/** Parse bd's JSON, reporting the step that printed it.
 * @param {string} stdout @param {string} step @returns {unknown} */
export function parseJson(stdout, step) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new BriefError(`${step} did not print JSON`, { step });
  }
}

/**
 * Read one bead. `bd show --json` returns the whole note — there is no way to ask for the
 * last few entries — so the bound is applied when the brief renders.
 * @param {object} input
 * @param {string} input.beadId
 * @param {Runner} input.bd
 * @param {(ms: number) => Promise<void>} input.sleep
 * @param {number} input.attempts
 * @param {number} input.backoffMs
 * @returns {Promise<Bead>}
 */
export async function readBead({ beadId, bd, sleep, attempts, backoffMs }) {
  const stdout = await withRetry({
    step: `bd show ${beadId}`,
    attempts,
    backoffMs,
    sleep,
    run: () => bd(['show', beadId, '--json']),
  }).then(({ value }) => value);
  return normaliseBead(parseJson(stdout, 'bd show'));
}

/**
 * Read one bead's provenance events. A bead with none prints `[]`.
 * @param {object} input
 * @param {string} input.beadId
 * @param {Runner} input.bd
 * @param {(ms: number) => Promise<void>} input.sleep
 * @param {number} input.attempts
 * @param {number} input.backoffMs
 * @returns {Promise<ProvenanceEvent[]>}
 */
export async function readProvenance({ beadId, bd, sleep, attempts, backoffMs }) {
  const stdout = await withRetry({
    step: `bd provenance log ${beadId}`,
    attempts,
    backoffMs,
    sleep,
    run: () => bd(['provenance', 'log', beadId, '--json']),
  }).then(({ value }) => value);
  return normaliseProvenance(parseJson(stdout, 'bd provenance log'));
}

// ─── Render ───────────────────────────────────────────────────────────────────

/** One trail entry, bounded to three lines however long its fields are.
 * @param {TrailEntry} entry @returns {string[]} */
function entryLines(entry) {
  if (entry.at === null) return [`  (note) ${clip(entry.text)}`];
  const head = `  [${entry.at}] [${entry.stage}]${entry.outcome === null ? '' : ` ${entry.outcome}`}`;
  /** @type {string[]} */
  const lines = [head];
  if (entry.evidence !== null && entry.evidence !== '') lines.push(`    evidence: ${clip(entry.evidence)}`);
  if (entry.remaining !== null && entry.remaining !== '') lines.push(`    left: ${clip(entry.remaining)}`);
  return lines;
}

/**
 * Lay the brief out at the requested selection. No section prints a heading with nothing
 * under it: an empty section states the fact in one line.
 * @param {BriefModel} model
 * @param {{ trailCount: number, provenanceCount: number, acceptanceCount: number, blockedCount: number }} selection
 * @returns {string[]}
 */
export function composeBrief(model, selection) {
  const { bead, trail, provenance, acceptance } = model;
  /** @type {string[]} */
  const lines = [];

  lines.push(`${bead.id}  ${bead.status}  ${bead.type}  P${bead.priority}`);
  if (bead.title !== '') lines.push(clip(bead.title));
  lines.push(`labels: ${bead.labels.length === 0 ? 'none' : bead.labels.join(', ')}`);
  lines.push(`parent: ${bead.parent ?? 'none'}`);
  const next = nextStep(trail);
  lines.push(`next: ${nextStepLine(next, trail.length)}`);

  lines.push('');
  if (bead.blockedBy.length === 0) {
    lines.push('blocked by: none');
  } else {
    lines.push(`blocked by ${bead.blockedBy.length}:`);
    for (const dep of bead.blockedBy.slice(0, selection.blockedCount)) {
      lines.push(`  ${dep.id}  ${dep.status}  ${clip(dep.title)}`);
    }
    const hidden = bead.blockedBy.length - selection.blockedCount;
    if (hidden > 0) lines.push(`  … ${hidden} more blocking`);
  }

  lines.push('');
  if (trail.length === 0) {
    lines.push('trail: no entries yet — this bead carries no trail');
  } else {
    const shown = trail.slice(Math.max(0, trail.length - selection.trailCount));
    const earlier = trail.length - shown.length;
    lines.push(`trail (newest ${shown.length} of ${trail.length}${earlier === 0 ? '' : `; ${earlier} earlier not shown`}):`);
    for (const entry of shown) lines.push(...entryLines(entry));
  }

  lines.push('');
  if (provenance.length === 0) {
    lines.push('provenance: none');
  } else {
    const shown = provenance.slice(0, selection.provenanceCount);
    const hidden = provenance.length - shown.length;
    lines.push(`provenance (${shown.length} of ${provenance.length}):`);
    for (const event of shown) lines.push(`  ${event.refKind}  ${clip(event.ref)}`);
    if (hidden > 0) lines.push(`  … ${hidden} earlier not shown`);
  }

  lines.push('');
  if (acceptance.length === 0) {
    lines.push('acceptance criteria: none recorded');
  } else {
    lines.push('acceptance criteria:');
    for (const line of acceptance.slice(0, selection.acceptanceCount)) lines.push(`  - ${clip(line)}`);
    const hidden = acceptance.length - selection.acceptanceCount;
    if (hidden > 0) lines.push(`  … ${hidden} more`);
  }

  return lines;
}

/**
 * Render the brief inside a line budget.
 *
 * The budget is enforced here rather than promised in prose. When the requested window is
 * too wide the renderer shrinks it in order of least loss — oldest trail entries first,
 * then oldest provenance, then trailing acceptance lines, then surplus blockers — and keeps
 * a count of what it left out. As a last resort it truncates and says so, so no input can
 * print more lines than `--max-lines`.
 *
 * @param {BriefModel} model
 * @param {object} [options]
 * @param {number} [options.maxLines]
 * @param {number} [options.trailLimit]
 * @param {number} [options.provenanceLimit]
 * @returns {string} The brief, newline-terminated.
 */
export function renderBrief(model, { maxLines = DEFAULT_MAX_LINES, trailLimit = DEFAULT_TRAIL_ENTRIES, provenanceLimit = DEFAULT_PROVENANCE_EVENTS } = {}) {
  const selection = {
    trailCount: Math.min(trailLimit, model.trail.length),
    provenanceCount: Math.min(provenanceLimit, model.provenance.length),
    acceptanceCount: Math.min(MAX_ACCEPTANCE_LINES, model.acceptance.length),
    blockedCount: Math.min(MAX_BLOCKED_LINES, model.bead.blockedBy.length),
  };

  let lines = composeBrief(model, selection);
  while (lines.length > maxLines) {
    if (selection.trailCount > 1) selection.trailCount -= 1;
    else if (selection.provenanceCount > 1) selection.provenanceCount -= 1;
    else if (selection.acceptanceCount > 1) selection.acceptanceCount -= 1;
    else if (selection.blockedCount > 1) selection.blockedCount -= 1;
    else break;
    lines = composeBrief(model, selection);
  }

  if (lines.length <= maxLines) return `${lines.join('\n')}\n`;
  const kept = lines.slice(0, Math.max(1, maxLines - 1));
  kept.push(`… truncated at ${maxLines} lines; --max-lines raises the budget`);
  return `${kept.join('\n')}\n`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `Usage: node recover-brief.mjs --bead <id> [--trail <n>] [--provenance <n>] \\
  [--max-lines <n>] [--cwd <dir>]

Prints a bounded brief for one bead: status and state labels, the newest trail entries, the
provenance refs, the blocking dependencies, and the acceptance criteria. The rest of the
trail is summarised by count.

Read-only: every bd call is a read subcommand carrying --readonly. This script never writes
to the tracker.

--trail       trail entries printed (default: ${DEFAULT_TRAIL_ENTRIES}); the newest n are shown
--provenance  provenance events printed (default: ${DEFAULT_PROVENANCE_EVENTS})
--max-lines   the output budget the renderer enforces (default: ${DEFAULT_MAX_LINES})

Environment:
  BD_PATH                         bd binary (default: bd)
  BRIEF_TRAIL                     default for --trail
  BRIEF_PROVENANCE                default for --provenance
  BRIEF_MAX_LINES                 default for --max-lines
  BRIEF_ATTEMPTS                  attempts per bd read (default: ${DEFAULT_ATTEMPTS})
  BRIEF_BACKOFF_MS                first backoff step in ms (shared retry with the writer)
  TRAIL_ENTRY_CALL_TIMEOUT_MS     per-call timeout in ms, shared with the writer
`;

/**
 * Parse the CLI's argv into `runCli` options.
 * @param {string[]} argv
 * @returns {{ beadId: string, trailLimit: number, provenanceLimit: number, maxLines: number, cwd: string }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  let cwd = process.cwd();

  const FLAGS = new Map([
    ['--bead', 'bead'],
    ['--trail', 'trail'],
    ['--provenance', 'provenance'],
    ['--max-lines', 'maxLines'],
    ['--cwd', 'cwd'],
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = FLAGS.get(arg);
    if (name === undefined) throw new UsageError(`unexpected argument: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new UsageError(`${arg} needs a value`);
    if (name === 'cwd') cwd = value;
    else values[name] = value;
  }

  if (values.bead === undefined) throw new UsageError('--bead is required');

  /** @param {string} flag @param {string | undefined} raw @param {number} fallback @param {number} min */
  const count = (flag, raw, fallback, min) => {
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      throw new UsageError(`${flag} must be an integer of at least ${min} (got ${JSON.stringify(raw)})`);
    }
    return value;
  };

  return {
    beadId: values.bead,
    trailLimit: count('--trail', values.trail, envInt('BRIEF_TRAIL', DEFAULT_TRAIL_ENTRIES), 1),
    provenanceLimit: count('--provenance', values.provenance, envInt('BRIEF_PROVENANCE', DEFAULT_PROVENANCE_EVENTS), 0),
    maxLines: count('--max-lines', values.maxLines, envInt('BRIEF_MAX_LINES', DEFAULT_MAX_LINES), 10),
    cwd,
  };
}

/**
 * Read one bead and print its brief.
 * @param {object} options
 * @param {string[]} options.argv                      CLI arguments (without node/script).
 * @param {(chunk: string) => void} [options.write]     stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [options.writeError] stderr sink; injectable for tests.
 * @param {BriefDeps} [options.deps]                   Collaborators; injectable for tests.
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({
  argv,
  write = (chunk) => process.stdout.write(chunk),
  writeError = (chunk) => process.stderr.write(chunk),
  deps = {},
}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    write(USAGE);
    return 0;
  }

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeError(`recover-brief: ${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }

  const bd = makeReadOnlyBd(deps.bd ?? makeRunner(BD_PATH, options.cwd));
  const sleep = deps.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const attempts = envInt('BRIEF_ATTEMPTS', DEFAULT_ATTEMPTS);
  const backoffMs = envInt('BRIEF_BACKOFF_MS', 100);

  try {
    // Sequential, not concurrent: embeddeddolt serialises readers too, and two calls in
    // flight on a busy database is the shape that fails and retries.
    const bead = await readBead({ beadId: options.beadId, bd, sleep, attempts, backoffMs });
    const provenance = await readProvenance({ beadId: options.beadId, bd, sleep, attempts, backoffMs });

    const model = {
      bead,
      trail: dedupeTrail(splitTrail(bead.notes)),
      provenance,
      acceptance: acceptanceOf(bead),
    };
    write(renderBrief(model, {
      maxLines: options.maxLines,
      trailLimit: options.trailLimit,
      provenanceLimit: options.provenanceLimit,
    }));
    return 0;
  } catch (error) {
    const kind = error instanceof UsageError ? 'usage' : 'failed';
    writeError(`recover-brief ${kind}: ${errorMessage(error)}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
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
