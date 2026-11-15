// Tests for skills/workflow/hitl-queue/scripts/queue.mjs — the ranked HITL decision queue.
//
// The design rests on facts this file drives directly: the dependent multiplier is
// transitive and counts beads rather than paths (a diamond counts once), a `--due` date
// moves a bead up by the factor its remaining time earns in the strategy's tier table,
// the three ordering properties the acceptance criteria name hold, a bead with no score is
// listed as unscored instead of placed, and one backlog always prints in one order. The
// script is exercised through its exported functions against an in-memory `bd`, and through
// its real CLI against a stub binary, so the argv it issues is the argv the queue is tested
// with.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import { fakeBd } from './helpers/fake-bd-queue.mjs';
import { REQUIRED_SECTIONS } from '../skills/workflow/prioritise-work/scripts/strategy.mjs';
import {
  buildQueue,
  dependentMultiplier,
  queueTotal,
  renderQueue,
} from '../skills/workflow/hitl-queue/scripts/queue.mjs';

const tempRoot = createTempRoot('hitl-queue-');
const execFileAsync = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'skills', 'workflow', 'hitl-queue', 'scripts', 'queue.mjs');
const HELPER = join(REPO_ROOT, 'test', 'helpers', 'fake-bd-queue.mjs');

/**
 * One bead in the graph a test writes down. The shape lives with the fake `bd` that
 * serves it, so the CLI stub and the in-process tests cannot drift apart.
 * @typedef {import('./helpers/fake-bd-queue.mjs').GraphBead} GraphBead
 */

/** A stored `rice` record, as `score-bead score` writes it. @param {object} [overrides] */
function rice(overrides = {}) {
  return {
    reach: 4,
    impact: 3,
    confidence: 0.7,
    effort: 2,
    score: 4.2,
    strategyVersion: 2,
    assessedAt: '2026-11-14T09:00:00.000Z',
    rationale: 'queue test',
    ...overrides,
  };
}

/**
 * A filled strategy at the given version, written into a workspace.
 * @param {string} workspace
 * @param {number} [version]
 * @param {[string, string][]} [tiers]  Deadline-tier rows; omitted for no table at all.
 * @returns {Promise<string>} the strategy path
 */
async function writeStrategy(workspace, version = 2, tiers) {
  const sections = REQUIRED_SECTIONS.map((title) => `## ${title}\n\n- the answer for ${title}.\n`);
  const table = tiers === undefined
    ? ''
    : `\n## Deadline tiers\n\n| Remaining | Factor |\n|---|---|\n${tiers.map(([when, factor]) => `| ${when} | ${factor} |`).join('\n')}\n`;
  const file = join(workspace, 'strategy.md');
  await writeFile(
    file,
    `# Prioritisation strategy\n\n- **Version:** ${version}\n- **Updated:** 2026-11-14\n\n${sections.join('\n')}${table}`,
    'utf8',
  );
  return file;
}

/**
 * Build the queue over a graph, in a fresh workspace with a valid strategy.
 * @param {object} options
 * @param {GraphBead[]} options.beads
 * @param {number} [options.strategyVersion]
 * @param {boolean} [options.includeIdeas]
 * @param {number} [options.now]        The moment the deadlines are measured from.
 * @param {[string, string][]} [options.tiers]  A deadline-tier table for the strategy.
 */
async function queue({ beads, strategyVersion, includeIdeas, now, tiers }) {
  const workspace = await tempRoot.createWorkspace();
  const file = await writeStrategy(workspace, strategyVersion, tiers);
  return await buildQueue({
    bd: fakeBd(beads),
    cwd: workspace,
    file,
    ...(includeIdeas === undefined ? {} : { includeIdeas }),
    ...(now === undefined ? {} : { now }),
  });
}

/** The row for one bead, or a failed assertion naming what the queue did return.
 * @param {Awaited<ReturnType<typeof buildQueue>>} report @param {string} id */
function rowFor(report, id) {
  const row = report.rows.find((candidate) => candidate.id === id);
  assert.ok(row !== undefined, `the queue does not list ${id}; it lists ${report.rows.map((r) => r.id).join(', ')}`);
  return row;
}

describe('the dependent multiplier', () => {
  it('is 1 + ln(1 + n), so zero dependents scores 1 and three score about 2.39', () => {
    assert.equal(dependentMultiplier(0), 1);
    assert.equal(Math.round(dependentMultiplier(3) * 100) / 100, 2.39);
    assert.equal(Math.round(dependentMultiplier(30) * 100) / 100, 4.43);
    // Monotonic: more unblocked work never ranks lower.
    for (let n = 0; n < 50; n++) assert.ok(dependentMultiplier(n + 1) > dependentMultiplier(n));
  });

  it('scales the total by both multipliers and rounds it to one decimal', () => {
    assert.equal(queueTotal({ score: 4.2, dependents: 0, inProgress: false }), 4.2);
    assert.equal(queueTotal({ score: 4.2, dependents: 0, inProgress: true }), 6.3);
    assert.equal(queueTotal({ score: 4.2, dependents: 3, inProgress: false }), 10);
  });
});

describe('ordering the queue', () => {
  it('ranks a bead that blocks three others above an equal bead that blocks none', async () => {
    const report = await queue({
      beads: [
        { id: 'tst-b', title: 'Blocks none', labels: ['execution:hitl'], rice: rice() },
        { id: 'tst-a', title: 'Blocks three', labels: ['execution:hitl'], rice: rice() },
        { id: 'tst-1', title: 'waits 1', labels: ['execution:afk'], dependsOn: ['tst-a'] },
        { id: 'tst-2', title: 'waits 2', labels: ['execution:afk'], dependsOn: ['tst-a'] },
        { id: 'tst-3', title: 'waits 3', labels: ['execution:afk'], dependsOn: ['tst-a'] },
      ],
    });

    const blocking = rowFor(report, 'tst-a');
    const idle = rowFor(report, 'tst-b');
    assert.equal(blocking.dependents, 3);
    assert.equal(idle.dependents, 0);
    assert.equal(blocking.total, 10);
    assert.equal(idle.total, 4.2);
    assert.equal(blocking.rank, 1);
    assert.equal(idle.rank, 2);
  });

  it('ranks an in-progress bead above an equal bead that has not started', async () => {
    const report = await queue({
      beads: [
        { id: 'tst-a', title: 'Not started', labels: ['execution:hitl'], rice: rice() },
        { id: 'tst-b', title: 'In progress', status: 'in_progress', labels: ['execution:hitl'], rice: rice() },
      ],
    });

    assert.equal(rowFor(report, 'tst-b').wipMultiplier, 1.5);
    assert.equal(rowFor(report, 'tst-a').wipMultiplier, 1);
    assert.equal(rowFor(report, 'tst-b').total, 6.3);
    assert.equal(rowFor(report, 'tst-a').total, 4.2);
    assert.deepEqual(report.rows.map((row) => row.id), ['tst-b', 'tst-a']);
  });

  it('breaks a tie on rice, then on id, so one backlog always prints in one order', async () => {
    // All three totals are 10.0: one earns it from a high score, the twins from three
    // dependents each. Only the fixed tie-break can order them.
    const beads = [
      { id: 'tst-c', title: 'High score', labels: ['execution:hitl'], rice: rice({ score: 10 }) },
      { id: 'tst-b', title: 'Many dependents', labels: ['execution:hitl'], rice: rice() },
      { id: 'tst-a', title: 'Twin', labels: ['execution:hitl'], rice: rice() },
      { id: 'tst-1', title: 'waits 1', labels: ['execution:afk'], dependsOn: ['tst-b'] },
      { id: 'tst-2', title: 'waits 2', labels: ['execution:afk'], dependsOn: ['tst-b'] },
      { id: 'tst-3', title: 'waits 3', labels: ['execution:afk'], dependsOn: ['tst-b'] },
      { id: 'tst-4', title: 'waits 4', labels: ['execution:afk'], dependsOn: ['tst-a'] },
      { id: 'tst-5', title: 'waits 5', labels: ['execution:afk'], dependsOn: ['tst-a'] },
      { id: 'tst-6', title: 'waits 6', labels: ['execution:afk'], dependsOn: ['tst-a'] },
    ];
    const first = await queue({ beads });
    const second = await queue({ beads });

    assert.deepEqual(first.rows.map((row) => row.total), [10, 10, 10]);
    assert.deepEqual(first.rows.map((row) => row.id), ['tst-c', 'tst-a', 'tst-b']);
    assert.equal(renderQueue(first), renderQueue(second));
  });
});

describe('the deadline factor', () => {
  /** The moment every case below measures from, injected so no case depends on the clock. */
  const NOW = Date.parse('2026-11-15T09:00:00Z');

  it('ranks an item due in three days above an otherwise identical item with no deadline', async () => {
    const report = await queue({
      now: NOW,
      beads: [
        { id: 'tst-a', title: 'Due in three days', labels: ['execution:hitl'], rice: rice(), dueAt: '2026-11-18T09:00:00Z' },
        { id: 'tst-b', title: 'No deadline', labels: ['execution:hitl'], rice: rice() },
      ],
    });

    assert.equal(rowFor(report, 'tst-a').deadlineFactor, 1.5);
    assert.equal(rowFor(report, 'tst-a').total, 6.3);
    assert.equal(rowFor(report, 'tst-b').deadlineFactor, 1);
    assert.equal(rowFor(report, 'tst-b').total, 4.2);
    assert.deepEqual(report.rows.map((row) => row.id), ['tst-a', 'tst-b']);
  });

  it('applies each tier at its own edge: a boundary earns the factor that names it', async () => {
    // Each case states one side of one boundary. "Exactly" earns the narrower tier, a
    // millisecond more drops to the wider one, and a deadline exactly now has not slipped.
    const cases = [
      { id: 'tst-w1', left: 'just over a week', dueAt: '2026-11-22T09:01:00Z', factor: 1, overdue: false },
      { id: 'tst-w2', left: 'exactly a week', dueAt: '2026-11-22T09:00:00Z', factor: 1.5, overdue: false },
      { id: 'tst-d1', left: 'just over two days', dueAt: '2026-11-17T09:01:00Z', factor: 1.5, overdue: false },
      { id: 'tst-d2', left: 'exactly two days', dueAt: '2026-11-17T09:00:00Z', factor: 2, overdue: false },
      { id: 'tst-d3', left: 'just over a day', dueAt: '2026-11-16T09:01:00Z', factor: 2, overdue: false },
      { id: 'tst-d4', left: 'exactly a day', dueAt: '2026-11-16T09:00:00Z', factor: 4, overdue: false },
      { id: 'tst-n1', left: 'due now', dueAt: '2026-11-15T09:00:00Z', factor: 4, overdue: false },
      { id: 'tst-o1', left: 'a minute past', dueAt: '2026-11-15T08:59:00Z', factor: 8, overdue: true },
    ];

    const report = await queue({
      now: NOW,
      beads: cases.map((each) => ({
        id: each.id,
        title: each.left,
        labels: ['execution:hitl'],
        rice: rice(),
        dueAt: each.dueAt,
      })),
    });

    for (const each of cases) {
      const row = rowFor(report, each.id);
      assert.equal(row.deadlineFactor, each.factor, `${each.left}: expected factor ${each.factor}`);
      assert.equal(row.overdue, each.overdue, `${each.left}: expected overdue=${each.overdue}`);
    }
  });

  it('shows the deadline and the factor in a row that has one, and flags an overdue row OVERDUE', async () => {
    const report = await queue({
      now: NOW,
      beads: [
        { id: 'tst-a', title: 'Due in three days', labels: ['execution:hitl'], rice: rice(), dueAt: '2026-11-18T09:00:00Z' },
        { id: 'tst-o', title: 'Slipped', labels: ['execution:hitl'], rice: rice({ score: 1 }), dueAt: '2026-11-14T09:00:00Z' },
        { id: 'tst-b', title: 'No deadline', labels: ['execution:hitl'], rice: rice({ score: 1 }) },
      ],
    });

    const text = renderQueue(report);
    assert.match(text, /deadline ×1\.5 in 3d \(due 2026-11-18T09:00Z\)/);
    assert.match(text, /deadline ×8 OVERDUE by 1d \(due 2026-11-14T09:00Z\)/);
    assert.equal(rowFor(report, 'tst-o').overdue, true);
    assert.equal(rowFor(report, 'tst-o').deadlineFactor, 8);
    // A row without a deadline keeps the neutral factor and shows no deadline clause.
    assert.equal(rowFor(report, 'tst-b').deadlineFactor, 1);
    assert.doesNotMatch(text, /tst-b\s+1\.0\s+rice[^\n]*deadline/);
  });

  it('reads the tiers from the strategy, so a changed tier changes the rank', async () => {
    // Five days out, the due bead earns the shipped "within a week" factor of 1.5 while a
    // bead ten days out earns 1. Writing different numbers into those two rows flips the
    // order between them: only a strategy-held factor can move an order that way.
    const beads = [
      { id: 'tst-d', title: 'Due in five days', labels: ['execution:hitl'], rice: rice(), dueAt: '2026-11-20T09:00:00Z' },
      { id: 'tst-f', title: 'Due in ten days', labels: ['execution:hitl'], rice: rice(), dueAt: '2026-11-25T09:00:00Z' },
      { id: 'tst-n', title: 'No deadline', labels: ['execution:hitl'], rice: rice() },
    ];

    const shipped = await queue({ now: NOW, beads });
    assert.equal(rowFor(shipped, 'tst-d').deadlineFactor, 1.5);
    assert.equal(rowFor(shipped, 'tst-f').deadlineFactor, 1);
    assert.equal(rowFor(shipped, 'tst-n').deadlineFactor, 1);
    assert.deepEqual(shipped.rows.map((row) => row.id), ['tst-d', 'tst-f', 'tst-n']);

    const custom = await queue({
      now: NOW,
      beads,
      tiers: [
        ['within 1d', '4'],
        ['within 2d', '2'],
        ['within 7d', '0.5'],
        ['more than 7d', '10'],
        ['overdue', '1'],
      ],
    });

    assert.equal(rowFor(custom, 'tst-d').deadlineFactor, 0.5);
    assert.equal(rowFor(custom, 'tst-f').deadlineFactor, 10);
    // A bead with no deadline sits outside the tiers: its factor stays 1, so tuning a
    // row never lifts undated work by accident.
    assert.equal(rowFor(custom, 'tst-n').deadlineFactor, 1);
    assert.deepEqual(custom.rows.map((row) => row.id), ['tst-f', 'tst-n', 'tst-d']);
  });

  it('keeps a deferred bead out until its defer date, then admits it once that date has passed', async () => {
    const report = await queue({
      now: NOW,
      beads: [
        { id: 'tst-a', title: 'Decide', labels: ['execution:hitl'], rice: rice() },
        {
          id: 'tst-f',
          title: 'Parked forward',
          status: 'deferred',
          labels: ['execution:hitl'],
          rice: rice(),
          deferUntil: '2026-11-18T09:00:00Z',
        },
        {
          id: 'tst-w',
          title: 'Woken',
          status: 'deferred',
          labels: ['execution:hitl'],
          rice: rice(),
          deferUntil: '2026-11-15T08:00:00Z',
        },
      ],
    });

    assert.deepEqual(report.rows.map((row) => row.id).sort(), ['tst-a', 'tst-w']);
    assert.equal(report.counts.excludedDeferred, 1);
    assert.match(renderQueue(report), /excluded: 1 deferred bead/);
  });
});

describe('the dependent count', () => {
  it('sums dependents transitively, so a chain of three counts three', async () => {
    const report = await queue({
      beads: [
        { id: 'tst-a', title: 'Root', labels: ['execution:hitl'], rice: rice() },
        { id: 'tst-1', title: 'A', labels: ['execution:afk'], dependsOn: ['tst-a'] },
        { id: 'tst-2', title: 'B', labels: ['execution:afk'], dependsOn: ['tst-1'] },
        { id: 'tst-3', title: 'C', labels: ['execution:afk'], dependsOn: ['tst-2'] },
      ],
    });

    const root = rowFor(report, 'tst-a');
    assert.equal(root.dependents, 3);
    assert.deepEqual(root.dependentIds, ['tst-1', 'tst-2', 'tst-3']);
  });

  it("counts a diamond's shared dependent once, so three distinct beads are not four paths", async () => {
    // a ← left, a ← right, left ← bottom, right ← bottom: four paths to three beads.
    const report = await queue({
      beads: [
        { id: 'tst-a', title: 'Root', labels: ['execution:hitl'], rice: rice() },
        { id: 'tst-l', title: 'Left', labels: ['execution:afk'], dependsOn: ['tst-a'] },
        { id: 'tst-r', title: 'Right', labels: ['execution:afk'], dependsOn: ['tst-a'] },
        { id: 'tst-x', title: 'Bottom', labels: ['execution:afk'], dependsOn: ['tst-l', 'tst-r'] },
      ],
    });

    const root = rowFor(report, 'tst-a');
    assert.equal(root.dependents, 3);
    assert.deepEqual(root.dependentIds, ['tst-l', 'tst-r', 'tst-x']);
    assert.equal(root.total, 10);
  });

  it('leaves a closed dependent out of the count while walking through it', async () => {
    const report = await queue({
      beads: [
        { id: 'tst-a', title: 'Root', labels: ['execution:hitl'], rice: rice() },
        { id: 'tst-c', title: 'Closed', status: 'closed', labels: ['execution:afk'], dependsOn: ['tst-a'] },
        { id: 'tst-o', title: 'Open', labels: ['execution:afk'], dependsOn: ['tst-c'] },
      ],
    });

    const root = rowFor(report, 'tst-a');
    assert.deepEqual(root.dependentIds, ['tst-o']);
    assert.equal(root.dependents, 1);
  });

  it('counts only blocks edges, so a related bead is not an answer anyone waits on', async () => {
    const report = await queue({
      beads: [
        { id: 'tst-a', title: 'Root', labels: ['execution:hitl'], rice: rice() },
        { id: 'tst-r', title: 'Related', labels: ['execution:afk'], relatesTo: ['tst-a'] },
        { id: 'tst-b', title: 'Blocked', labels: ['execution:afk'], dependsOn: ['tst-a'] },
      ],
    });

    assert.deepEqual(rowFor(report, 'tst-a').dependentIds, ['tst-b']);
  });
});

describe('a queue with no scores', () => {
  it('ranks nothing, says so, and lists every candidate as unscored with a reason', async () => {
    const report = await queue({
      beads: [
        { id: 'tst-a', title: 'Never scored', labels: ['execution:hitl'] },
        { id: 'tst-b', title: 'Scored record with no total', labels: ['execution:hitl'], rice: { reach: 4 } },
      ],
    });

    assert.equal(report.counts.ranked, 0);
    assert.equal(report.counts.unscored, 2);
    assert.deepEqual(report.rows.map((row) => row.rank), [undefined, undefined]);
    assert.equal(rowFor(report, 'tst-a').unscoredReason, 'no rice metadata');
    assert.equal(rowFor(report, 'tst-b').unscoredReason, 'no score in its rice record');

    const text = renderQueue(report);
    assert.match(text, /HITL decision queue · 0 ranked, 2 unscored/);
    assert.match(text, /no RICE score on any candidate — nothing can be ranked/);
    assert.match(text, /unscored — no rice metadata/);
    assert.match(text, /unscored — no score in its rice record/);
  });

  it('marks a score older than the strategy file while still ranking it', async () => {
    const report = await queue({
      strategyVersion: 3,
      beads: [{ id: 'tst-a', title: 'Stale', labels: ['execution:hitl'], rice: rice({ strategyVersion: 2 }) }],
    });

    const row = rowFor(report, 'tst-a');
    assert.equal(row.stale, true);
    // An older score is still a score: it takes a total and a rank, not an unscored slot.
    assert.equal(row.total, 4.2);
    assert.equal(row.rank, 1);
    assert.equal(report.counts.ranked, 1);
    assert.match(
      renderQueue(report),
      /\(scored at strategy v2, current v3\)/,
    );
  });
});

describe('what the queue leaves out', () => {
  it('leaves ideas out by default, counts them, and ranks them when asked', async () => {
    const beads = [
      { id: 'tst-a', title: 'Decision', labels: ['execution:hitl'], rice: rice() },
      { id: 'tst-i', title: 'Idea', labels: ['execution:hitl', 'kind:idea'] },
    ];
    const without = await queue({ beads });
    assert.deepEqual(without.rows.map((row) => row.id), ['tst-a']);
    assert.equal(without.counts.excludedIdeas, 1);
    assert.match(renderQueue(without), /excluded: 1 kind:idea bead \(--include-ideas ranks them\)/);

    const with_ = await queue({ beads, includeIdeas: true });
    assert.deepEqual(with_.rows.map((row) => row.id), ['tst-a', 'tst-i']);
    assert.equal(with_.counts.excludedIdeas, 0);
  });

  it('leaves a deferred bead out and counts it', async () => {
    const report = await queue({
      beads: [
        { id: 'tst-a', title: 'Decision', labels: ['execution:hitl'], rice: rice() },
        { id: 'tst-d', title: 'Parked', status: 'deferred', labels: ['execution:hitl'], rice: rice() },
      ],
    });

    assert.deepEqual(report.rows.map((row) => row.id), ['tst-a']);
    assert.equal(report.counts.excludedDeferred, 1);
    assert.match(renderQueue(report), /excluded: 1 deferred bead/);
  });
});

describe('the emitted format', () => {
  it('prints one block per row: rank, id, total, components, multipliers, title, unblocks', async () => {
    const report = await queue({
      beads: [
        { id: 'tst-a', title: 'Ship the queue', labels: ['execution:hitl'], rice: rice() },
        { id: 'tst-1', title: 'waits 1', labels: ['execution:afk'], dependsOn: ['tst-a'] },
        { id: 'tst-2', title: 'waits 2', labels: ['execution:afk'], dependsOn: ['tst-a'] },
        { id: 'tst-3', title: 'waits 3', labels: ['execution:afk'], dependsOn: ['tst-a'] },
        { id: 'tst-b', title: 'Decide the API shape', labels: ['execution:hitl'], rice: rice({ score: 2 }) },
        { id: 'tst-c', title: 'Decide the vendor', labels: ['execution:hitl'] },
      ],
    });

    assert.equal(
      renderQueue(report),
      [
        'HITL decision queue · 2 ranked, 1 unscored · strategy v2',
        'total = rice × (1 + ln(1 + dependents)) × 1.5 in-progress × deadline tier · ties break on rice, then id · unscored last',
        '',
        '1  tst-a  10.0  rice 4.2 = R4 · I3 · C0.7 · E2  ×2.39 dependents(3)  ×1.0',
        '    Ship the queue — unblocks tst-1, tst-2, tst-3',
        '2  tst-b   2.0  rice 2.0 = R4 · I3 · C0.7 · E2  ×1.00 dependents(0)  ×1.0',
        '    Decide the API shape — unblocks nothing',
        '-  tst-c     —  unscored — no rice metadata (score it with score-bead)',
        '    Decide the vendor — unblocks nothing',
        '',
      ].join('\n'),
    );
  });
});

describe('the command line', () => {
  /**
   * A stub `bd` reporting one graph, plus the launcher that puts it on PATH.
   * @param {string} workspace @param {GraphBead[]} beads
   */
  async function makeStubBd(workspace, beads) {
    const binDir = join(workspace, 'bin');
    await mkdir(binDir, { recursive: true });
    const graphFile = join(workspace, 'graph.json');
    await writeFile(graphFile, JSON.stringify(beads), 'utf8');

    const stub = join(workspace, 'stub-bd.mjs');
    await writeFile(
      stub,
      `import { readFile } from 'node:fs/promises';\n` +
        `import { fakeBd } from ${JSON.stringify(pathToFileURL(HELPER).href)};\n` +
        `const beads = JSON.parse(await readFile(process.env.BD_GRAPH, 'utf8'));\n` +
        `process.stdout.write(await fakeBd(beads)(process.argv.slice(2)));\n`,
      'utf8',
    );
    const launcher = join(binDir, 'bd');
    await writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${stub}" "$@"\n`, 'utf8');
    await chmod(launcher, 0o755);
    return { binDir, graphFile };
  }

  /** Run the real CLI in a workspace with the stub on PATH.
   * @param {object} options
   * @param {string} options.workspace
   * @param {{ binDir: string, graphFile: string }} options.stub
   * @param {string[]} [options.argv] */
  async function run({ workspace, stub, argv = [] }) {
    const env = {
      ...process.env,
      PATH: `${stub.binDir}:${process.env.PATH ?? ''}`,
      BD_GRAPH: stub.graphFile,
    };
    return await execFileAsync(
      process.execPath,
      [SCRIPT, 'queue', ...argv, '--file', 'strategy.md', '--cwd', workspace],
      { cwd: workspace, env },
    );
  }

  it('prints byte-identical output on two identical runs', async () => {
    const workspace = await tempRoot.createWorkspace();
    await writeStrategy(workspace);
    const stub = await makeStubBd(workspace, [
      { id: 'tst-a', title: 'Ship the queue', labels: ['execution:hitl'], rice: rice() },
      { id: 'tst-b', title: 'Decide the API shape', labels: ['execution:hitl'], rice: rice() },
      { id: 'tst-c', title: 'Decide the vendor', labels: ['execution:hitl'] },
    ]);

    const first = await run({ workspace, stub });
    const second = await run({ workspace, stub });

    assert.equal(first.stdout.split('\n').length, second.stdout.split('\n').length);
    assert.equal(first.stdout, second.stdout);
    assert.match(first.stdout, /HITL decision queue · 2 ranked, 1 unscored · strategy v2/);
  });

  it('rejects an unknown command with exit 2 and an empty queue with exit 0', async () => {
    const workspace = await tempRoot.createWorkspace();
    await writeStrategy(workspace);
    const stub = await makeStubBd(workspace, []);

    const unknown = await execFileAsync(process.execPath, [SCRIPT, 'rank', '--cwd', workspace], {
      cwd: workspace,
      env: { ...process.env, PATH: `${stub.binDir}:${process.env.PATH ?? ''}`, BD_GRAPH: stub.graphFile },
    }).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: '' }),
      (error) => ({ code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
    );
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /unknown command "rank"/);

    const empty = await run({ workspace, stub });
    assert.equal(empty.stdout, 'HITL decision queue · no open execution:hitl beads\n');
  });

  it('loads the queue script from the flat plugin layout', async () => {
    const workspace = await tempRoot.createWorkspace();
    const flat = join(workspace, 'skills');
    await mkdir(flat, { recursive: true });
    for (const name of ['hitl-queue', 'score-bead', 'prioritise-work']) {
      await cp(join(REPO_ROOT, 'skills', 'workflow', name), join(flat, name), { recursive: true });
    }

    const { stdout } = await execFileAsync(process.execPath, [join(flat, 'hitl-queue', 'scripts', 'queue.mjs'), '--help']);

    assert.match(stdout, /Rank the open execution:hitl beads into one list/);
  });
});

describe('the planner wiring', () => {
  // The queue is reported before the first thing a planner does, in every entry point.
  // A mention after the dispatch point would be a reminder, not a report.
  const WIRINGS = /** @type {const} */ ([
    {
      file: join('skills', 'workflow', 'plan', 'SKILL.md'),
      queue: 'Phase 0 — Report the HITL queue',
      firstAction: '### Phase 1 — Understand and specify',
    },
    {
      file: join('agents', 'plan', 'agent.md'),
      queue: 'Phase 0 — Report the HITL queue',
      firstAction: '### Phase 1 — Understand and specify',
    },
    {
      file: join('agents', 'ralph-plan', 'agent.md'),
      queue: 'report the HITL queue',
      firstAction: 'Dispatch parallel **explore** sub-agents',
    },
  ]);

  it('reports the queue before the first dispatch in all three planner entry points', async () => {
    assert.equal(WIRINGS.length, 3);

    for (const wiring of WIRINGS) {
      const text = await readFile(join(REPO_ROOT, wiring.file), 'utf8');
      const queueAt = text.indexOf(wiring.queue);
      const actionAt = text.indexOf(wiring.firstAction);
      assert.notEqual(queueAt, -1, `${wiring.file} does not report the queue`);
      assert.notEqual(actionAt, -1, `${wiring.file} lost its first action "${wiring.firstAction}"`);
      assert.ok(queueAt < actionAt, `${wiring.file} reports the queue after it acts`);
      assert.match(
        text.slice(queueAt, actionAt),
        /hitl-queue/,
        `${wiring.file} reports a queue without naming the skill that prints it`,
      );
    }
  });
});
