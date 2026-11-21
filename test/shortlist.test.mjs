// Tests for the `shortlist` command of skills/workflow/hitl-queue/scripts/recommend.mjs — the
// top ten rows of the queue, with the top one marked as the recommendation.
//
// A single recommendation has no surface to be challenged on: a wrong top pick reads exactly
// like a right one when the runner-up is hidden. So the contract under test is a shape and two
// sentences. The shape: one line per bead, every line carrying the rank, the scope, the id, the
// total, the title, the four components, the due moment where one exists and what answering the
// bead unblocks, with the marker on the first row only. The sentences: how many rows were left
// out and the command that shows them, or that the list is complete. Each is asserted literally
// — a name claiming "states how many were omitted" asserts the number and the hint, and a name
// claiming the list is complete asserts that sentence.
//
// The rows are the queue's own, so the tests also pin that: nothing is re-sorted, and every
// degraded state renders the one-item path's own text rather than a second version of it.
//
// The tracker is the in-memory `bd` the queue's own tests use, so the graph is data and a real
// database is never touched.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createTempRoot } from './helpers/temp-root.mjs';
import { fakeBd } from './helpers/fake-bd-queue.mjs';
import { REQUIRED_SECTIONS } from '../skills/workflow/strategise/scripts/strategy.mjs';
import { UsageError, buildQueue } from '../skills/workflow/hitl-queue/scripts/queue.mjs';
import {
  FULL_QUEUE_COMMAND,
  SHORTLIST_DEFAULT_TOP,
  buildRecommendation,
  buildShortlist,
  parseArgs,
  renderRecommendation,
  renderShortlist,
} from '../skills/workflow/hitl-queue/scripts/recommend.mjs';

const tempRoot = createTempRoot('hitl-shortlist-');

/** The one line of the fixture strategy that justifies the top of the fixture queue. */
const THEME = 'shorter review turnaround for human-gated work.';

/** A due moment a fixed distance from now, so no tier boundary is crossed by when the suite runs. */
const DUE_IN_THREE_DAYS = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

/**
 * A stored `rice` record, as `score-bead score` writes it. @param {number} score
 */
function rice(score) {
  return {
    reach: 4,
    impact: 3,
    confidence: 0.7,
    effort: 2,
    score,
    strategyVersion: 2,
    assessedAt: '2026-11-14T09:00:00.000Z',
    rationale: 'shortlist test',
  };
}

/**
 * A valid strategy at version 2, whose "Current themes" section holds THEME.
 * @param {string} workspace
 * @returns {Promise<string>} the strategy path
 */
async function writeStrategy(workspace) {
  const sections = REQUIRED_SECTIONS.map((title) =>
    title === 'Current themes' ? `## ${title}\n\n- ${THEME}\n` : `## ${title}\n\n- the answer for ${title}.\n`,
  );
  const file = join(workspace, 'strategy.md');
  await writeFile(
    file,
    `# Prioritisation strategy\n\n- **Version:** 2\n- **Updated:** 2026-11-14\n\n${sections.join('\n')}`,
    'utf8',
  );
  return file;
}

/**
 * A workspace the queue reads as a scope: the directory carries its own `.beads`, because bd
 * resolves a workspace by walking up, so a directory without one is not a workspace at all.
 * @returns {Promise<string>}
 */
async function makeWorkspace() {
  const workspace = await tempRoot.createWorkspace();
  await mkdir(join(workspace, '.beads'), { recursive: true });
  return workspace;
}

/**
 * Fourteen eligible beads: twelve scored, two unscored, one of them due in three days. Ten rows
 * are shown by default, so the list is cut and the omission line is the one under test.
 * `tst-b` leads because its deadline lifts it above the higher-scoring `tst-a`.
 * @returns {import('./helpers/fake-bd-queue.mjs').GraphBead[]}
 */
function longQueueFixture() {
  const beads = [];
  for (let i = 0; i < 12; i++) {
    beads.push({
      id: `tst-${String.fromCharCode(97 + i)}`,
      title: `Decide thing ${i}`,
      labels: ['execution:hitl'],
      rice: rice(12 - i),
      ...(i === 1 ? { dueAt: DUE_IN_THREE_DAYS } : {}),
    });
  }
  // `tst-w` waits on the top two, so at least one row shows what answering it unblocks.
  beads.push({ id: 'tst-w', title: 'Wire the queue into plan', labels: ['execution:hitl'], dependsOn: ['tst-a', 'tst-b'] });
  beads.push({ id: 'tst-x', title: 'An unshaped decision', labels: ['execution:hitl'] });
  return beads;
}

/**
 * Three beads only, so nothing is left out of a list of ten.
 * @returns {import('./helpers/fake-bd-queue.mjs').GraphBead[]}
 */
function shortQueueFixture() {
  return [
    { id: 'tst-a', title: 'Ship the decision queue', labels: ['execution:hitl'], rice: rice(4.2) },
    { id: 'tst-b', title: 'Decide the API shape', labels: ['execution:hitl'], rice: rice(3.1) },
    { id: 'tst-c', title: 'Report the queue', labels: ['execution:hitl'], rice: rice(2.2) },
  ];
}

/**
 * Render a shortlist from one fixture queue.
 * @param {object} options
 * @param {import('./helpers/fake-bd-queue.mjs').GraphBead[]} options.beads
 * @param {string} [options.file]
 * @param {string} [options.why]
 * @param {number} [options.top]
 * @returns {Promise<string>}
 */
async function shortlist({ beads, file, why, top }) {
  const workspace = await makeWorkspace();
  const strategyFile = file ?? (await writeStrategy(workspace));
  const built = await buildShortlist({
    bd: fakeBd(beads),
    file: strategyFile,
    cwd: workspace,
    why,
    ...(top === undefined ? {} : { top }),
  });
  return renderShortlist(built);
}

/**
 * The row lines of a rendered shortlist: the lines that sit between the header and the blank
 * line before the truncation sentence.
 * @param {string} rendered
 * @returns {string[]}
 */
function bodyLines(rendered) {
  const lines = rendered.split('\n');
  const start = lines.indexOf('') + 1;
  return lines.slice(start, lines.indexOf('', start));
}

describe('the top ten, as one ranked list', () => {
  it('shows ten rows, one line each, with the recommendation marked on the first row only', async () => {
    const rendered = await shortlist({ beads: longQueueFixture() });
    const body = bodyLines(rendered);

    assert.equal(body.length, 10);
    for (const line of body) assert.match(line, /^\s*\d+\s{2}\S+\s{2}tst-\S+\s{2,}[\d.]+\s{2}Decide thing \d+\s{2}·\s{2}rice /);
    assert.equal(rendered.match(/← recommendation/g)?.length, 1);
    assert.match(body[0], /← recommendation$/);
    for (const line of body.slice(1)) assert.doesNotMatch(line, /recommendation/);
  });

  it('states how many rows it omitted, and the command that shows them', async () => {
    const rendered = await shortlist({ beads: longQueueFixture() });

    assert.match(rendered, /^4 omitted, see them with node <skill-scripts>\/queue\.mjs queue$/m);
    assert.equal(rendered.match(/omitted/g)?.length, 1);
    assert.equal(FULL_QUEUE_COMMAND, 'node <skill-scripts>/queue.mjs queue');
  });

  it('says the list is complete when the queue holds fewer beads than the count', async () => {
    const rendered = await shortlist({ beads: shortQueueFixture() });
    const body = bodyLines(rendered);

    assert.equal(body.length, 3);
    assert.match(rendered, /^the list is complete — all 3 eligible beads$/m);
    assert.doesNotMatch(rendered, /omitted/);
  });

  it('says the list is complete when the queue holds exactly the count', async () => {
    const beads = Array.from({ length: 10 }, (_, i) => ({
      id: `tst-${String.fromCharCode(97 + i)}`,
      title: `Decide thing ${i}`,
      labels: ['execution:hitl'],
      rice: rice(10 - i),
    }));
    const rendered = await shortlist({ beads });

    assert.equal(bodyLines(rendered).length, 10);
    assert.match(rendered, /^the list is complete — all 10 eligible beads$/m);
  });

  it('carries the components, the unblocked beads, the scope tag and the due time on the row', async () => {
    const rendered = await shortlist({ beads: longQueueFixture() });
    const body = bodyLines(rendered);
    const due = /** @type {string} */ (body.find((line) => line.includes('tst-b')));
    const undated = /** @type {string} */ (body.find((line) => line.includes('tst-a')));

    assert.match(due, /\s{2}code\s{2}tst-b\s{2,}/);
    assert.match(due, /rice 11\.0 = R4 · I3 · C0\.7 · E2 {2}×[\d.]+ dependents\(\d+\) {2}×[\d.]+/);
    assert.match(due, /deadline ×[\d.]+ in \d+d \d+h \(due \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z\)/);
    assert.match(due, /·\s{2}unblocks tst-w/);
    assert.doesNotMatch(undated, /deadline/);
    assert.match(undated, /·\s{2}unblocks tst-w$/);
  });

  it('takes the count from --top, whose default is ten', async () => {
    assert.equal(SHORTLIST_DEFAULT_TOP, 10);

    const rendered = await shortlist({ beads: longQueueFixture(), top: 3 });

    assert.equal(bodyLines(rendered).length, 3);
    assert.match(rendered, /^HITL shortlist · 3 of 14 eligible/m);
    assert.match(rendered, /^11 omitted, see them with node <skill-scripts>\/queue\.mjs queue$/m);
  });

  it('prints the queue’s own order and numbers, re-sorting and recomputing nothing', async () => {
    const workspace = await makeWorkspace();
    const file = await writeStrategy(workspace);
    const beads = longQueueFixture();
    const built = await buildShortlist({ bd: fakeBd(beads), file, cwd: workspace });
    const queue = await buildQueue({ bd: fakeBd(beads), file, cwd: workspace });

    assert.deepEqual(built.rows?.map((row) => row.id), queue.rows.slice(0, 10).map((row) => row.id));
    assert.deepEqual(built.rows?.map((row) => row.total), queue.rows.slice(0, 10).map((row) => row.total));
    assert.equal(renderShortlist(built).includes('← recommendation'), true);
  });

  it('routes a row other than the top to the strategy review, never to a reorder', async () => {
    const rendered = await shortlist({ beads: longQueueFixture() });

    assert.match(rendered, /^a row other than the top is a priority challenge — run strategise, never a reorder$/m);
    // The list is presented as ranked and left alone: the marker moves no row and no total.
    const body = bodyLines(rendered);
    assert.match(body[0], /tst-b/);
    assert.match(body[1], /tst-a/);
  });

  it('states the justification it was given, and none when it was given none', async () => {
    const quoted = await shortlist({ beads: longQueueFixture(), why: THEME });
    const unquoted = await shortlist({ beads: longQueueFixture() });

    assert.match(quoted, new RegExp(`^why: "${THEME}" · Current themes$`, 'm'));
    assert.doesNotMatch(unquoted, /^why: /m);
  });

  it('refuses a justification the strategy file does not contain', async () => {
    const workspace = await makeWorkspace();
    const file = await writeStrategy(workspace);

    await assert.rejects(
      buildShortlist({ bd: fakeBd(longQueueFixture()), file, cwd: workspace, why: 'the vendor migration matters most' }),
      (error) => error instanceof UsageError && /no line of .* contains "the vendor migration matters most"/.test(error.message),
    );
  });
});

describe('a shortlist that cannot be ranked states the one-item path’s condition', () => {
  it('renders the same sentence recommend does, so the two never drift apart', async () => {
    const workspace = await makeWorkspace();
    const file = await writeStrategy(workspace);
    const unscored = longQueueFixture().map(({ rice: _rice, ...bead }) => bead);
    const cases = [
      { beads: [], file },
      { beads: unscored, file },
      { beads: shortQueueFixture(), file: join(workspace, 'absent.md') },
      {
        beads: [
          { id: 'tst-gate', title: 'Gate: merge the change', labels: ['execution:hitl'], rice: rice(9.9), dependsOn: ['tst-doc'] },
          { id: 'tst-doc', title: 'Document the change', labels: ['execution:afk'] },
        ],
        file,
      },
    ];

    for (const each of cases) {
      const viaShortlist = renderShortlist(await buildShortlist({ bd: fakeBd(each.beads), file: each.file, cwd: workspace }));
      const viaRecommend = renderRecommendation(
        await buildRecommendation({ bd: fakeBd(each.beads), file: each.file, cwd: workspace }),
      );
      assert.equal(viaShortlist, viaRecommend);
      assert.match(viaShortlist, /^No recommendation · /);
    }
  });
});

describe('the shortlist command line', () => {
  it('accepts --top on shortlist and refuses it on recommend', () => {
    assert.equal(parseArgs(['shortlist', '--top', '3']).top, 3);
    assert.equal(parseArgs(['shortlist']).top, undefined);
    assert.throws(() => parseArgs(['recommend', '--top', '3']), (error) =>
      error instanceof UsageError && /--top belongs to shortlist/.test(error.message));
    assert.throws(() => parseArgs(['shortlist', '--top', '0']), (error) =>
      error instanceof UsageError && /--top needs a positive whole number, got "0"/.test(error.message));
  });
});
