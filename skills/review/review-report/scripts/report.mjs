// @ts-check
// Aggregate the `defect:<class>` labels the review stage applies, measure the pipeline's own
// state, and print one bounded report. Filing that report upstream is a separate step.
//
// The class vocabulary is not defined here. `skills/review/review-defects/SKILL.md` owns the
// closed list of eight classes and the worked example for each, so this script parses the
// table out of that file at run time: the words a reviewer applies and the words this report
// counts cannot drift apart. A class that appears as a label but not in that table is
// reported as vocabulary drift, never counted as a class of its own.
//
// Two tracker reads, both read-only:
//
//   bd list --label-pattern 'defect:*' --all --readonly --brief --json    the defect labels
//   bd list --all --readonly --brief --json                               the chore tree
//
// `--all` is not optional on either. `bd list` hides closed beads by default, defects are
// attached to beads that are normally already closed, so a query without it reports
// "No issues found" on a label that is set.
//
// A label is removed when the review that confirms the fix runs (`review-defects`, "Remove it
// when the fix closes"). The counts therefore describe the unconfirmed defects at the moment
// of the report, never the whole history of defects. The trend compares snapshots, and the
// report says so in those words.
//
// No retry, no write to the tracker, no network call unless `--file` is passed. Zero
// dependencies, async throughout, argv arrays only — never a shell string — even though
// `check-no-sync` does not scan `skills/*/scripts`.
//
// Run:
//
//   node report.mjs [--baseline <path>] [--record] [--file] [--repo <owner/name>] \
//     [--json] [--cwd <dir>] [--bd <path>] [--gh <path>] [--git <path>] [--now <rfc3339>]

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ─── Contract ─────────────────────────────────────────────────────────────────

/** Schema version of the machine-readable model, and of the baseline file it writes. */
export const SCHEMA_VERSION = 1;

/** Every defect label starts with this prefix; the class is the rest of the label. */
export const DEFECT_PREFIX = 'defect:';

/** The review stage's chore label. */
export const STAGE_REVIEW = 'stage:review';

/** The fix chore label. */
export const STAGE_FIX = 'stage:fix';

/** The class vocabulary's one authored home: the skill directory that owns it. */
export const VOCABULARY_SKILL = 'review-defects';

/** The file inside that skill directory that carries the vocabulary table. */
export const VOCABULARY_FILE = 'SKILL.md';

/**
 * The canonical defect read, in the form `review-defects` documents. `--all` carries the
 * whole point: without it a query for a label on a closed bead returns nothing.
 */
export const DEFECT_QUERY = /** @type {const} */ ([
  'list',
  '--label-pattern',
  `${DEFECT_PREFIX}*`,
  '--all',
  '--readonly',
  '--brief',
  '--json',
]);

/** The chore-tree read: parent links, dependencies and stage labels, no free-form text. */
export const BULK_QUERY = /** @type {const} */ ([
  'list',
  '--all',
  '--readonly',
  '--brief',
  '--json',
]);

/** Classes printed before the rest are summarised by count. */
export const MAX_CLASSES = 3;

/** Example bead ids printed per class. */
export const MAX_EXAMPLES = 2;

/** The package whose manifest declares the default feedback target, as published. */
export const PACKAGE_NAME = '@jaybeeuu/agent-cortex';

/** The package name `install pi` stages: a private build, never published. */
export const STAGED_PACKAGE_NAME = '@jaybeeuu/agent-cortex-pi';

/** The plugin name `install claude` writes into the Claude plugin manifest. */
export const PLUGIN_NAME = 'agent-cortex';

/** The Claude plugin manifest, relative to the plugin root an install stages. */
export const PLUGIN_MANIFEST = '.claude-plugin/plugin.json';

/**
 * The manifests an install carries, and the identity each must declare to be this package's.
 * Both name the same thing — where this package came from — in the shape its harness reads.
 * `test/review-report.test.mjs` stages both installs, so an installer that renames its generated
 * manifest fails there rather than silently losing the default at install time.
 * @type {readonly { file: string, identities: readonly string[] }[]}
 */
const MANIFEST_FILES = [
  { file: 'package.json', identities: [PACKAGE_NAME, STAGED_PACKAGE_NAME] },
  { file: PLUGIN_MANIFEST, identities: [PLUGIN_NAME] },
];

/** Environment override for the feedback repository. */
export const REPO_ENV = 'AGENT_CORTEX_FEEDBACK_REPO';

/**
 * The skill that owns the rule behind each class: the file to change when this class keeps
 * appearing. Keys are the vocabulary's classes; the test asserts every one of them exists on
 * disk and that no class is left unmapped.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const DEFECT_OWNERS = {
  'test-unproven': ['style-tests', 'implement-task'],
  'test-cannot-fail': ['style-tests', 'implement-task'],
  'criteria-unmet': ['implement-task', 'create-task'],
  'scope-creep': ['implement-task'],
  'style-violation': ['style-code'],
  'missing-proof': ['implement-task', 'run-pipeline-stage'],
  regression: ['implement-task', 'style-tests'],
  'docs-drift': ['maintain-agent-docs', 'style-documentation'],
};

/** A usage mistake: the caller asked for something malformed. Exit code 2. */
export class UsageError extends Error {}

/** A read, a write or a filing that failed for good. Exit code 1. */
export class ReportError extends Error {
  /** @param {string} message @param {{ step?: string }} [detail] */
  constructor(message, { step } = {}) {
    super(message);
    this.name = 'ReportError';
    this.step = step ?? 'report';
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A child-process call that returns stdout. @typedef {(args: string[]) => Promise<string>} Runner */

/** One dependency edge, as `bd list --json` prints it.
 * @typedef {object} Dependency
 * @property {string} depends_on_id
 * @property {string} type
 */

/** The bead fields this report reads. Everything else is ignored.
 * @typedef {object} Bead
 * @property {string} id
 * @property {string[]} [labels]
 * @property {string | null} [parent]
 * @property {Dependency[]} [dependencies]
 */

/** Counts for one defect class.
 * @typedef {object} ClassCount
 * @property {number} count    Labels carrying this class.
 * @property {number} changes  Distinct parents those labels sit on.
 * @property {string[]} beads  The labelled bead ids, sorted.
 */

/** The measured state of the tracker.
 * @typedef {object} Model
 * @property {number} schema
 * @property {string} [generatedAt]
 * @property {string} [project]
 * @property {number} beadsRead
 * @property {{ labelled: number, changes: number, byClass: Record<string, ClassCount>, unknownClasses: string[] }} defects
 * @property {{ cohorts: number, firstPass: number, rate: number | null }} reviews
 * @property {{ total: number, changes: number, byStage: Record<string, number>, unattributed: number }} fixRounds
 */

/** A per-value change between two reports.
 * @typedef {object} Delta
 * @property {string} key
 * @property {number} current
 * @property {number} previous
 * @property {number} delta
 */

/** The comparison of this report with the previous one.
 * @typedef {object} Comparison
 * @property {string} path
 * @property {string | null} reportedAt
 * @property {Delta[]} classes
 * @property {Delta} labelled
 * @property {{ current: number | null, previous: number | null, points: number | null }} rate
 * @property {Delta[]} stages
 */

/** What the renderer needs that is not a measurement.
 * @typedef {object} Context
 * @property {string} project
 * @property {string | null} baselinePath
 * @property {Comparison | null} comparison
 * @property {boolean} baselineRecorded
 */

/** Injected collaborators, so a test drives the script without a tracker or a network.
 * @typedef {object} ReportDeps
 * @property {Runner} [bd]
 * @property {Runner} [gh]
 * @property {Runner} [git]
 * @property {Date} [now]
 * @property {string} [cwd]
 * @property {string} [scriptPath]
 * @property {string} [envRepo]
 * @property {((chunk: string) => void)} [write]  Sink that receives the report as soon as it is
 *   rendered — before the filing target is resolved — so a run that cannot file still prints what
 *   it measured.
 */

// ─── Vocabulary ──────────────────────────────────────────────────────────────

const CLASS_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Read the closed class list out of the vocabulary table in `review-defects/SKILL.md`.
 *
 * One source, not two: the table is the authored list, and parsing it means a class added
 * there is counted here without a second edit. A table that no longer parses is a loud
 * failure, not an empty vocabulary.
 * @param {string} markdown @returns {string[]}
 */
export function parseVocabulary(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^##\s/.test(line) && /closed list/i.test(line));
  if (start === -1) {
    throw new ReportError('cannot find the class vocabulary: no "closed list" section in the skill', {
      step: 'vocabulary',
    });
  }
  /** @type {string[]} */
  const classes = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.trimStart().startsWith('|')) continue;
    const cell = line.split('|')[1]?.trim() ?? '';
    if (!cell.startsWith('`') || !cell.endsWith('`')) continue;
    const name = cell.slice(1, -1).trim();
    if (CLASS_NAME.test(name) && !classes.includes(name)) classes.push(name);
  }
  if (classes.length === 0) {
    throw new ReportError('cannot find the class vocabulary: the closed-list table yielded no class', {
      step: 'vocabulary',
    });
  }
  return classes;
}

/**
 * Read the vocabulary out of `review-defects/SKILL.md`.
 *
 * The skill group directories are flattened at install time, so the authoring layout
 * (`skills/review/review-defects`) and the installed layout (`skills/review-defects`) sit at
 * different depths from this script. Walk up until the skill directory is found, rather than
 * assuming either depth.
 * @param {string} scriptPath @returns {Promise<string[]>}
 */
export async function readVocabulary(scriptPath) {
  let dir = dirname(scriptPath);
  for (let depth = 0; depth < 4; depth += 1) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    const file = join(dir, VOCABULARY_SKILL, VOCABULARY_FILE);
    try {
      return parseVocabulary(await readFile(file, 'utf-8'));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') continue;
      throw new ReportError(`cannot read the class vocabulary from ${file}`, { step: 'vocabulary' });
    }
  }
  throw new ReportError(
    `cannot find the ${VOCABULARY_SKILL} skill beside ${scriptPath}: it owns the class vocabulary`,
    { step: 'vocabulary' },
  );
}

// ─── Measurement ─────────────────────────────────────────────────────────────

/**
 * The class named by a bead's labels, if it carries one.
 * @param {Bead} bead @returns {string[]}
 */
export function defectClasses(bead) {
  return (bead.labels ?? [])
    .filter((label) => label.startsWith(DEFECT_PREFIX))
    .map((label) => label.slice(DEFECT_PREFIX.length));
}

/**
 * The `stage:<name>` label a bead carries, if any.
 * @param {Bead} bead @returns {string | null}
 */
export function stageLabel(bead) {
  const label = (bead.labels ?? []).find((value) => value.startsWith('stage:'));
  return label === undefined ? null : label.slice('stage:'.length);
}

/**
 * The bead a chore belongs to: its parent, or the bead itself when it has none.
 * @param {Bead} bead @returns {string}
 */
export function ownerBead(bead) {
  return bead.parent ?? bead.id;
}

/**
 * Measure the four inputs: defects by class, first-pass review rate, fix rounds per stage,
 * and the vocabulary drift.
 *
 * A review cohort is a parent with at least one `stage:review` chore. A rejected review
 * always creates a fresh review chore beside the fix (`run-pipeline-stage`, Remediation), so a
 * parent holding exactly one review chore passed review on its first pass, and a parent
 * holding more than one did not. That is the whole derivation: no stage prose is read.
 *
 * A fix round is attributed to the stage its fresh chore re-runs, which that chore declares as
 * a `blocks` dependency on the fix.
 * @param {{ beads: Bead[], defects: Bead[], vocabulary: string[] }} input @returns {Model}
 */
export function aggregate({ beads, defects, vocabulary }) {
  /** @type {Record<string, ClassCount>} */
  const byClass = {};
  /** @type {string[]} */
  const unknownClasses = [];
  /** @type {Map<string, Set<string>>} */
  const changesByClass = new Map();

  for (const bead of defects) {
    for (const name of defectClasses(bead)) {
      if (!vocabulary.includes(name)) {
        if (!unknownClasses.includes(name)) unknownClasses.push(name);
        continue;
      }
      const entry = (byClass[name] ??= { count: 0, changes: 0, beads: [] });
      entry.count += 1;
      entry.beads.push(bead.id);
      const changes = changesByClass.get(name) ?? new Set();
      changes.add(ownerBead(bead));
      changesByClass.set(name, changes);
    }
  }
  for (const [name, entry] of Object.entries(byClass)) {
    entry.beads.sort();
    entry.changes = changesByClass.get(name)?.size ?? 0;
  }

  const defectChanges = new Set(defects.map(ownerBead));

  /** @type {Map<string, number>} */
  const reviewCounts = new Map();
  /** @type {Set<string>} */
  const fixIds = new Set();
  /** @type {Map<string, string>} */
  const freshStageByFix = new Map();
  for (const bead of beads) {
    if ((bead.labels ?? []).includes(STAGE_REVIEW)) {
      const parent = ownerBead(bead);
      reviewCounts.set(parent, (reviewCounts.get(parent) ?? 0) + 1);
    }
    if ((bead.labels ?? []).includes(STAGE_FIX)) fixIds.add(bead.id);
  }
  for (const bead of beads) {
    const stage = stageLabel(bead);
    if (stage === null) continue;
    for (const dependency of bead.dependencies ?? []) {
      if (dependency.type === 'blocks' && fixIds.has(dependency.depends_on_id)) {
        freshStageByFix.set(dependency.depends_on_id, stage);
      }
    }
  }

  /** @type {Record<string, number>} */
  const byStage = {};
  let unattributed = 0;
  /** @type {Set<string>} */
  const fixChanges = new Set();
  for (const bead of beads) {
    if (!(bead.labels ?? []).includes(STAGE_FIX)) continue;
    fixChanges.add(ownerBead(bead));
    const stage = freshStageByFix.get(bead.id);
    if (stage === undefined) {
      unattributed += 1;
      continue;
    }
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }

  const cohorts = reviewCounts.size;
  const firstPass = [...reviewCounts.values()].filter((count) => count === 1).length;

  return {
    schema: SCHEMA_VERSION,
    beadsRead: beads.length,
    defects: {
      labelled: Object.values(byClass).reduce((sum, entry) => sum + entry.count, 0),
      changes: defectChanges.size,
      byClass,
      unknownClasses,
    },
    reviews: { cohorts, firstPass, rate: cohorts === 0 ? null : firstPass / cohorts },
    fixRounds: { total: fixIds.size, changes: fixChanges.size, byStage, unattributed },
  };
}

/**
 * Compare this report with the one at `path`. A file this script did not write is refused
 * rather than read as zeros: an unreadable baseline must not become an invented trend.
 * @param {Model} current @param {unknown} previous @param {string} path @returns {Comparison}
 */
export function compare(current, previous, path) {
  if (typeof previous !== 'object' || previous === null) {
    throw new ReportError(`baseline ${path} is not a report this script wrote`, { step: 'baseline' });
  }
  const model = /** @type {Partial<Model>} */ (previous);
  if (model.schema !== SCHEMA_VERSION) {
    throw new ReportError(
      `baseline ${path} declares schema ${String(model.schema)}, this script writes ${SCHEMA_VERSION}`,
      { step: 'baseline' },
    );
  }

  const previousClasses = model.defects?.byClass ?? {};
  const previousStages = model.fixRounds?.byStage ?? {};
  const names = [...new Set([...Object.keys(current.defects.byClass), ...Object.keys(previousClasses)])];
  const classNames = [...names].sort((a, b) => a.localeCompare(b));

  /** @param {string} key @param {number} now @param {number} before @returns {Delta} */
  const delta = (key, now, before) => ({ key, current: now, previous: before, delta: now - before });

  const currentRate = current.reviews.rate;
  const previousRate = model.reviews?.rate ?? null;
  const points =
    currentRate === null || previousRate === null
      ? null
      : Math.round((currentRate - previousRate) * 100);

  const stageNames = [...new Set([...Object.keys(current.fixRounds.byStage), ...Object.keys(previousStages)])];

  return {
    path,
    reportedAt: model.generatedAt ?? null,
    classes: classNames.map((name) =>
      delta(name, current.defects.byClass[name]?.count ?? 0, previousClasses[name]?.count ?? 0),
    ),
    labelled: delta('defects', current.defects.labelled, model.defects?.labelled ?? 0),
    rate: { current: currentRate, previous: previousRate, points },
    stages: stageNames
      .sort((a, b) => a.localeCompare(b))
      .map((name) => delta(name, current.fixRounds.byStage[name] ?? 0, previousStages[name] ?? 0)),
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/** A signed count, or "no change". @param {number} value */
function signed(value) {
  if (value === 0) return 'no change';
  return value > 0 ? `+${value}` : String(value);
}

/** A rate as a whole percentage. @param {number} rate */
function percent(rate) {
  return `${Math.round(rate * 100)}%`;
}

/** The owning skills for a class, as skill paths a reader can open. @param {string} name */
function owners(name) {
  const skills = DEFECT_OWNERS[name];
  if (skills === undefined || skills.length === 0) return 'no owning skill mapped';
  return skills.map((skill) => `${skill}/SKILL.md`).join(', ');
}

/**
 * The defect section: the top classes, their counts, two example beads and the owning skill.
 * A tracker with no label says so rather than printing a row of zeros.
 * @param {Model} model @returns {string[]}
 */
function defectSection(model) {
  const { byClass, labelled, changes, unknownClasses } = model.defects;
  const lines = [
    `Defects by class — \`bd list --label-pattern '${DEFECT_PREFIX}*' --all\``,
  ];

  if (labelled === 0 && unknownClasses.length === 0) {
    lines.push(
      '  No defect label is set on any bead, closed beads included. There is nothing to count,',
      '  so no zero is printed as if it were a measurement.',
    );
    return lines;
  }

  const ranked = Object.entries(byClass)
    .sort(([nameA, a], [nameB, b]) => b.count - a.count || nameA.localeCompare(nameB))
    .slice(0, MAX_CLASSES);
  const width = Math.max(...ranked.map(([name]) => name.length));

  ranked.forEach(([name, entry], index) => {
    const examples = entry.beads.slice(0, MAX_EXAMPLES).join(', ');
    const label = entry.count === 1 ? 'defect' : 'defects';
    lines.push(
      `  ${index + 1}. ${name.padEnd(width)}  ${entry.count} ${label} in ${entry.changes} ` +
        `${entry.changes === 1 ? 'change' : 'changes'} · owners: ${owners(name)}`,
      `     example${entry.beads.length === 1 ? '' : 's'}: ${examples}`,
    );
  });

  const classCount = Object.keys(byClass).length;
  const remainingClasses = classCount - ranked.length;
  const tail = remainingClasses > 0 ? ` Top ${ranked.length} of ${classCount} classes.` : '';
  lines.push(
    `  ${labelled} unconfirmed ${labelled === 1 ? 'defect' : 'defects'} across ${changes} ` +
      `${changes === 1 ? 'change' : 'changes'}.${tail}`,
  );

  if (unknownClasses.length > 0) {
    lines.push(
      `  Unknown class in the labels: ${unknownClasses.map((name) => `${DEFECT_PREFIX}${name}`).join(', ')}. ` +
        'Not in the vocabulary — treat each as a review defect, not a class.',
    );
  }
  return lines;
}

/**
 * The review section: the rate, its derivation, or the reason there is none.
 * @param {Model} model @returns {string[]}
 */
function reviewSection(model) {
  const { cohorts, firstPass, rate } = model.reviews;
  const lines = ['First-pass review rate'];
  if (cohorts === 0 || rate === null) {
    lines.push(
      '  No review stage chore is recorded in this tracker, so no rate is reported — absent',
      '  is not zero.',
    );
    return lines;
  }
  lines.push(
    `  ${firstPass} of ${cohorts} review cohorts passed with no fix round — ${percent(rate)}`,
    '  A cohort is a parent holding at least one stage:review chore; a rejected review always',
    '  creates a fresh one, so a parent with exactly one passed first time.',
  );
  return lines;
}

/**
 * The fix-round section, grouped by the stage each fix round repaired.
 * @param {Model} model @returns {string[]}
 */
function fixSection(model) {
  const { total, changes, byStage, unattributed } = model.fixRounds;
  const lines = ['Fix rounds'];
  if (total === 0) {
    lines.push('  No stage:fix chore is recorded in this tracker.');
    return lines;
  }
  const parts = Object.entries(byStage)
    .sort(([nameA, a], [nameB, b]) => b - a || nameA.localeCompare(nameB))
    .map(([name, count]) => `${name} ${count}`);
  if (unattributed > 0) parts.push(`unattributed ${unattributed}`);
  lines.push(
    `  ${total} in total across ${changes} ${changes === 1 ? 'change' : 'changes'} — ${parts.join(', ')}`,
  );
  return lines;
}

/**
 * The trend section. A trend needs a previous report; without one this says so, and a single
 * labelled defect is never dressed up as a direction.
 * @param {Context} context @returns {string[]}
 */
function trendSection(context) {
  const lines = ['Change since the previous report'];
  const comparison = context.comparison;

  if (context.baselinePath === null) {
    lines.push(
      '  None — no previous report was named. This is a snapshot, not a trend.',
      '  Pass --baseline <path> to compare against one, and --record to keep this one.',
    );
    return lines;
  }
  if (comparison === null) {
    lines.push(
      `  None — no report exists at ${context.baselinePath} yet. This is a snapshot, not a trend.`,
      '  Re-run with --record to keep this report as the baseline.',
    );
    return lines;
  }

  const reportedAt = comparison.reportedAt ?? 'an unrecorded time';
  lines.push(`  Against ${comparison.path}, reported ${reportedAt}`);

  const changed = comparison.classes.filter((entry) => entry.delta !== 0);
  if (changed.length === 0) {
    lines.push('  No defect class changed.');
  } else {
    const shown = changed
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key))
      .slice(0, MAX_CLASSES);
    const rest = changed.length - shown.length;
    const listed = shown.map((entry) => `${entry.key} ${entry.current} (${signed(entry.delta)})`);
    lines.push(`  ${listed.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`);
  }

  if (comparison.rate.current !== null && comparison.rate.previous !== null) {
    const points = comparison.rate.points ?? 0;
    const change = points === 0 ? 'no change' : `${signed(points)} points`;
    lines.push(
      `  First-pass review rate ${percent(comparison.rate.current)} ` +
        `(from ${percent(comparison.rate.previous)}, ${change})`,
    );
  }
  const stageChanges = comparison.stages
    .filter((entry) => entry.delta !== 0)
    .map((entry) => `${entry.key} ${entry.current} (${signed(entry.delta)})`);
  if (stageChanges.length > 0) lines.push(`  Fix rounds ${stageChanges.join(', ')}`);
  if (comparison.labelled.current <= 1) {
    lines.push(
      `  ${comparison.labelled.current} labelled defect: a single data point, so there is no trend yet.`,
    );
  }
  return lines;
}

/**
 * Render the whole report. Pure: it prints what was measured and never calls out.
 * @param {Model} model @param {Context} context @returns {string}
 */
export function renderReport(model, context) {
  const lines = [
    `Defect report — ${context.project}`,
    `Reported ${model.generatedAt ?? '(no clock)'}. Read ${model.beadsRead} beads from the tracker.`,
    '',
    ...defectSection(model),
    '',
    ...reviewSection(model),
    '',
    ...fixSection(model),
    '',
    ...trendSection(context),
    '',
    'A defect label is removed when the review that confirms its fix runs, so every count',
    'above is the unconfirmed defect set at this moment, not the history of defects.',
  ];
  if (context.baselineRecorded && context.baselinePath !== null) {
    lines.push(`This report was recorded as the baseline at ${context.baselinePath}.`);
  }
  return `${lines.join('\n')}\n`;
}

// ─── Reading the tracker ─────────────────────────────────────────────────────

/**
 * Build a runner for one binary. argv arrays only, so a value carrying spaces or quotes
 * reaches the binary unmangled.
 * @param {string} bin @param {string} cwd @returns {Runner}
 */
export function makeRunner(bin, cwd) {
  return async (args) => {
    const { stdout } = await execFileAsync(bin, args, {
      cwd,
      encoding: 'utf-8',
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  };
}

/**
 * Parse the JSON array a `bd list --json` call prints.
 * @param {string} stdout @param {string} step @returns {Bead[]}
 */
export function parseBeads(stdout, step) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ReportError(`bd ${step} printed output that is not JSON`, { step });
  }
  if (!Array.isArray(parsed)) {
    throw new ReportError(`bd ${step} did not print a bead array`, { step });
  }
  return /** @type {Bead[]} */ (parsed);
}

/**
 * Read both bead sets through the given runner.
 * @param {Runner} bd @returns {Promise<{ beads: Bead[], defects: Bead[] }>}
 */
export async function collect(bd) {
  const beads = parseBeads(await bd([...BULK_QUERY]), 'chore read');
  const defects = parseBeads(await bd([...DEFECT_QUERY]), 'defect read');
  return { beads, defects };
}

// ─── Project and filing target ───────────────────────────────────────────────

/**
 * Turn a remote URL or an `owner/name` slug into `owner/name`.
 * @param {string} value @returns {string | null}
 */
export function parseSlug(value) {
  const trimmed = value.trim();
  const patterns = [
    /^[^@/\s]+@[^:/\s]+:(.+)$/, // git@host:owner/name.git
    /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/]+\/(.+)$/i, // https://host/owner/name.git
    /^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)$/, // owner/name
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (match === null) continue;
    const parts = match[1].replace(/\.git$/, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return parts.slice(-2).join('/');
  }
  return null;
}

/**
 * Identify the project being reported on. A repository with no remote is a normal case: it
 * is named by its directory, and the report says the remote is absent.
 * @param {Runner} git @param {string} cwd @returns {Promise<string>}
 */
export async function identifyProject(git, cwd) {
  try {
    const slug = parseSlug(await git(['remote', 'get-url', 'origin']));
    if (slug !== null) return slug;
  } catch {
    // No origin: fall through to the working directory.
  }
  try {
    const top = (await git(['rev-parse', '--show-toplevel'])).trim();
    if (top !== '') return `${basename(top)} (no git remote)`;
  } catch {
    // Not a git repository either.
  }
  return `${basename(cwd)} (not a git repository)`;
}

/**
 * Read the feedback repository out of the manifest of the install this skill ships inside, so no
 * repository is written into shipped code: the default is whatever the installed artefact declares.
 *
 * Two installs, two manifests. `install pi` stages a package whose `package.json` declares the
 * repository; `install claude` stages a Claude plugin whose `.claude-plugin/plugin.json` declares
 * it. Each manifest is read only when it names this package: a manifest carrying any other name is
 * the consuming project's own, and must never become the repository a report is filed against.
 * @param {string} scriptPath @returns {Promise<string | null>}
 */
export async function manifestRepo(scriptPath) {
  let dir = dirname(scriptPath);
  for (;;) {
    for (const { file, identities } of MANIFEST_FILES) {
      const slug = await readManifestRepo(join(dir, file), identities);
      if (slug !== null) return slug;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The repository one manifest declares, or null when the file is absent, unparseable, or the
 * manifest of something else.
 * @param {string} file @param {readonly string[]} identities @returns {Promise<string | null>}
 */
async function readManifestRepo(file, identities) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(file, 'utf-8'));
  } catch {
    // No manifest here, or one that does not parse: keep walking up.
    return null;
  }
  if (!identities.includes(manifest?.name)) return null;
  const repository = manifest.repository;
  const value = typeof repository === 'string' ? repository : repository?.url;
  return typeof value === 'string' ? parseSlug(value) : null;
}

/**
 * Resolve the repository a report is filed against: the flag, then the environment, then the
 * package manifest's own declaration. Never a hardcoded slug, never a hostname.
 * @param {{ flag: string | null, env: string | undefined, scriptPath: string }} input
 * @returns {Promise<string>}
 */
export async function resolveRepo({ flag, env, scriptPath }) {
  for (const [source, value] of [
    ['--repo', flag],
    [REPO_ENV, env],
  ]) {
    if (value === undefined || value === null || value === '') continue;
    const slug = parseSlug(value);
    if (slug === null) {
      throw new UsageError(`${source} is not an owner/name repository: ${value}`);
    }
    return slug;
  }
  const fromManifest = await manifestRepo(scriptPath);
  if (fromManifest !== null) return fromManifest;
  throw new ReportError(
    `cannot resolve the feedback repository: pass --repo <owner/name> or set ${REPO_ENV}`,
    { step: 'filing' },
  );
}

/**
 * The `gh` argv for filing one report. An argv array, never a shell string, so the body
 * reaches `gh` byte for byte.
 * @param {{ repo: string, title: string, body: string }} input @returns {string[]}
 */
export function filingArgs({ repo, title, body }) {
  return ['issue', 'create', '--repo', repo, '--title', title, '--body', body];
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Options
 * @property {string | null} baseline
 * @property {boolean} record
 * @property {boolean} file
 * @property {string | null} repo
 * @property {boolean} json
 * @property {string | null} cwd
 * @property {string | null} bd
 * @property {string | null} gh
 * @property {string | null} git
 * @property {string | null} now
 */

/**
 * Parse the command line. Unknown flags are refused, so a typo cannot silently change what
 * the report means.
 * @param {string[]} argv @returns {Options}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const options = {
    baseline: null,
    record: false,
    file: false,
    repo: null,
    json: false,
    cwd: null,
    bd: null,
    gh: null,
    git: null,
    now: null,
  };
  /** @type {Record<string, 'baseline' | 'repo' | 'cwd' | 'bd' | 'gh' | 'git' | 'now'>} */
  const valued = {
    '--baseline': 'baseline',
    '--repo': 'repo',
    '--cwd': 'cwd',
    '--bd': 'bd',
    '--gh': 'gh',
    '--git': 'git',
    '--now': 'now',
  };
  /** @type {Record<string, 'record' | 'file' | 'json'>} */
  const flags = { '--record': 'record', '--file': 'file', '--json': 'json' };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const flag = flags[arg];
    if (flag !== undefined) {
      options[flag] = true;
      continue;
    }
    const key = valued[arg];
    if (key !== undefined) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`${arg} needs a value`);
      }
      options[key] = value;
      index += 1;
      continue;
    }
    throw new UsageError(`unknown argument: ${arg}`);
  }

  if (options.record && options.baseline === null) {
    throw new UsageError('--record needs --baseline <path>: that path is where the report is kept');
  }
  return options;
}

/**
 * Run one report end to end. The report is printed before anything is filed, so a run without
 * `--file` cannot reach the network at all, and a run that cannot resolve or reach its filing
 * target still prints the report it measured.
 * @param {string[]} argv @param {ReportDeps} deps
 * @returns {Promise<{ stdout: string, model: Model, filed: string | null }>}
 */
export async function runCli(argv, deps = {}) {
  const options = parseArgs(argv);
  const cwd = resolve(options.cwd ?? deps.cwd ?? process.cwd());
  const scriptPath = resolve(deps.scriptPath ?? fileURLToPath(import.meta.url));
  const now = deps.now ?? (options.now === null ? new Date() : new Date(options.now));
  if (Number.isNaN(now.getTime())) throw new UsageError(`--now is not a date: ${options.now}`);

  const bd = deps.bd ?? makeRunner(options.bd ?? process.env.BD_PATH ?? 'bd', cwd);
  const git = deps.git ?? makeRunner(options.git ?? process.env.GIT_PATH ?? 'git', cwd);

  const vocabulary = await readVocabulary(scriptPath);
  const { beads, defects } = await collect(bd);
  const model = aggregate({ beads, defects, vocabulary });
  model.generatedAt = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  model.project = await identifyProject(git, cwd);

  /** @type {Comparison | null} */
  let comparison = null;
  const baselinePath = options.baseline === null ? null : resolve(cwd, options.baseline);
  if (baselinePath !== null) {
    let previous;
    try {
      previous = JSON.parse(await readFile(baselinePath, 'utf-8'));
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code !== 'ENOENT') {
        throw new ReportError(`cannot read the baseline at ${baselinePath}`, { step: 'baseline' });
      }
      previous = null;
    }
    if (previous !== null) comparison = compare(model, previous, baselinePath);
  }

  const context = {
    project: model.project,
    baselinePath,
    comparison,
    baselineRecorded: options.record && baselinePath !== null,
  };
  const report = renderReport(model, context);

  let stdout = options.json ? `${JSON.stringify(model, null, 2)}\n` : report;
  const write = deps.write ?? (() => {});

  if (context.baselineRecorded && baselinePath !== null) {
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify(model, null, 2)}\n`);
  }

  // Emit the report here, before the filing target is resolved: what was measured is not
  // conditional on where it is filed, so a failure to resolve or reach the repository must not
  // discard it.
  write(stdout);

  let filed = null;
  if (options.file) {
    const repo = await resolveRepo({
      flag: options.repo,
      env: deps.envRepo ?? process.env[REPO_ENV],
      scriptPath,
    });
    const gh = deps.gh ?? makeRunner(options.gh ?? process.env.GH_PATH ?? 'gh', cwd);
    const title = `Defect report — ${model.project} — ${model.generatedAt}`;
    filed = (await gh(filingArgs({ repo, title, body: report }))).trim().split('\n').pop() ?? null;
    const filedLine = `Filed: ${filed}\n`;
    stdout += filedLine;
    write(filedLine);
  }

  return { stdout, model, filed };
}

const USAGE = `Usage: node report.mjs [options]

  --baseline <path>  Compare against the report kept at this path
  --record           Keep this report at the --baseline path
  --file             File the report with \`gh issue create\` (the only networked step)
  --repo <owner/name>  Feedback repository (default: the repository this install declares)
  --json             Print the machine-readable model instead of the report
  --cwd <dir>        Directory the tracker and git commands run in
  --bd --gh --git <path>  Binaries to use (defaults: $BD_PATH, $GH_PATH, $GIT_PATH)
  --now <rfc3339>    Timestamp to report (default: now)

${REPO_ENV}  Feedback repository, when --repo is absent
`;

/**
 * The process entry point: print the report, then either file it or print the failure and exit
 * non-zero. The report goes out through a sink that writes it as soon as it is rendered, so a
 * filing failure leaves the measurement on stdout and the reason on stderr.
 * @param {string[]} argv @returns {Promise<number>}
 */
export async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  try {
    await runCli(argv, { write: (chunk) => process.stdout.write(chunk) });
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`review-report: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof ReportError) {
      process.stderr.write(`review-report: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
