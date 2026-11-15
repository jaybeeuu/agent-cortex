// Tests for skills/workflow/hitl-queue/scripts/boundary.mjs — the re-rank at an item boundary.
//
// The contract is a format, a refusal and a write, so all three are asserted literally. Every
// outcome is rendered from fixture data and compared line for line: the recommendation, *both*
// scores, and the reason that names them. The refusal is asserted too, because a decision that
// contradicts the scores must carry a reason of its own; and the write is asserted against the
// trail the in-memory tracker received, because a decision the next session cannot read back is
// not recorded.
//
// The tracker is the in-memory `bd` the queue's own tests use, so the graph is data and the real
// database is never touched. The command line is exercised once through a stub binary, so the
// exit codes the agent's step reads are the exit codes the script really returns.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import { fakeQueueBd } from './helpers/fake-bd-queue.mjs';
import { REQUIRED_SECTIONS } from '../skills/workflow/prioritise-work/scripts/strategy.mjs';
import { UsageError } from '../skills/workflow/hitl-queue/scripts/queue.mjs';
import {
  BOUNDARY_STATE,
  buildBoundary,
  renderBoundary,
} from '../skills/workflow/hitl-queue/scripts/boundary.mjs';

const tempRoot = createTempRoot('hitl-boundary-');
const execFileAsync = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'skills', 'workflow', 'hitl-queue', 'scripts', 'boundary.mjs');
const HELPER = join(REPO_ROOT, 'test', 'helpers', 'fake-bd-queue.mjs');

/**
 * One bead in the graph a test writes down.
 * @typedef {import('./helpers/fake-bd-queue.mjs').GraphBead} GraphBead
 */

/** @typedef {Awaited<ReturnType<typeof buildBoundary>>} BoundaryAnswer */

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
    rationale: 'boundary test',
    ...overrides,
  };
}

/**
 * A valid strategy at version 2, written into a workspace. The boundary adds no quote of its
 * own, so only the version reaches the block.
 * @param {string} workspace @param {string} [name]
 * @returns {Promise<string>} the strategy path
 */
async function writeStrategy(workspace, name = 'strategy.md') {
  const sections = REQUIRED_SECTIONS.map((title) => `## ${title}\n\n- the answer for ${title}.\n`);
  const file = join(workspace, name);
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

/** The theme epic, one item inside it, and one item outside it. */
const THEME = 'tst-t';

/**
 * Two scored items: `tst-a` sits under the theme, `tst-b` does not. The stored scores decide
 * which one the queue puts first, so a test states the order by stating the numbers.
 * @param {{ inside?: number, outside?: number }} [scores]
 * @returns {GraphBead[]}
 */
function themeFixture({ inside = 4.2, outside = 8.0 } = {}) {
  return [
    { id: THEME, title: 'The theme being worked' },
    { id: 'tst-a', title: 'Decide the theme question', parent: THEME, labels: ['execution:hitl'], rice: rice({ score: inside }) },
    { id: 'tst-b', title: 'Decide the outside question', labels: ['execution:hitl'], rice: rice({ score: outside }) },
  ];
}

/**
 * A fixed clock, so a trail entry is compared rather than matched loosely.
 * @returns {number} epoch milliseconds
 */
function fixedNow() {
  return Date.parse('2026-11-15T09:30:00.000Z');
}

/**
 * One workspace, one strategy and one in-memory tracker, with the trail the tracker received. A
 * case reads what the boundary wrote instead of the shape of the call, so a refusal is proven by
 * an empty trail and not by the absence of an assertion.
 * @param {GraphBead[]} beads
 * @returns {Promise<{
 *   bd: (args: string[]) => Promise<string>,
 *   notes: { id: string, text: string }[],
 *   theme: string,
 *   file: string,
 *   cwd: string,
 *   now: number,
 * }>}
 */
async function harness(beads) {
  const cwd = await makeWorkspace();
  const file = await writeStrategy(cwd);
  const { bd, state } = fakeQueueBd(beads);
  return { bd, notes: state.notes, theme: THEME, file, cwd, now: fixedNow() };
}

/**
 * Build one boundary answer from a fixture graph.
 * @param {object} options
 * @param {GraphBead[]} options.beads
 * @param {string} [options.theme]
 * @param {string} [options.next]
 * @param {'stay' | 'switch' | 'move'} [options.decide]
 * @param {string} [options.reason]
 * @returns {Promise<BoundaryAnswer>}
 */
async function boundary({ beads, theme = THEME, next, decide, reason }) {
  const { bd, file, cwd, now } = await harness(beads);
  return await buildBoundary({
    bd,
    theme,
    file,
    cwd,
    now,
    ...(next === undefined ? {} : { next }),
    ...(decide === undefined ? {} : { decide }),
    ...(reason === undefined ? {} : { reason }),
  });
}

/**
 * Build one boundary answer together with the tracker it wrote to, so a case can read the trail.
 * @param {object} options
 * @param {GraphBead[]} options.beads
 * @param {'stay' | 'switch' | 'move'} [options.decide]
 * @param {string} [options.reason]
 * @returns {Promise<{ rendered: string, notes: { id: string, text: string }[] }>}
 */
async function record({ beads, decide, reason }) {
  const { bd, notes, theme, file, cwd, now } = await harness(beads);
  const answer = await buildBoundary({
    bd,
    theme,
    file,
    cwd,
    now,
    ...(decide === undefined ? {} : { decide }),
    ...(reason === undefined ? {} : { reason }),
  });
  return { rendered: renderBoundary(answer), notes };
}

/**
 * Build one boundary answer that is expected to be refused, keeping the tracker it wrote to, so a
 * case asserts what the refusal left behind and not only the message it carried.
 * @param {object} options
 * @param {GraphBead[]} options.beads
 * @param {'stay' | 'switch' | 'move'} options.decide
 * @param {string} [options.reason]
 * @returns {Promise<{ error: unknown, notes: { id: string, text: string }[] }>}
 */
async function refuse({ beads, decide, reason }) {
  const { bd, notes, theme, file, cwd, now } = await harness(beads);
  const error = await buildBoundary({
    bd,
    theme,
    file,
    cwd,
    now,
    decide,
    ...(reason === undefined ? {} : { reason }),
  }).then(
    () => undefined,
    (caught) => caught,
  );
  return { error, notes };
}

describe('the boundary comparison', () => {
  it('renders the comparison with both scores, the recommendation and its reason', async () => {
    const rendered = renderBoundary(await boundary({ beads: themeFixture() }));

    assert.equal(
      rendered,
      [
        'Boundary · theme tst-t · strategy v2',
        "recommendation: switch — the queue's top item scores 8.0 against the theme's next 4.2, so higher-priority work waits elsewhere",
        'theme next  tst-a · total 4.2 · Decide the theme question',
        'queue top   tst-b · total 8.0 · Decide the outside question',
        "next: stay, switch or move is the human's call — nothing is recorded until they answer",
        '',
      ].join('\n'),
    );
  });

  it('shows both scores, so the recommendation is inspectable rather than asserted', async () => {
    const rendered = renderBoundary(await boundary({ beads: themeFixture() }));

    assert.match(rendered, /^recommendation: switch — /m);
    assert.match(rendered, /^theme next {2}tst-a · total 4\.2 · Decide the theme question$/m);
    assert.match(rendered, /^queue top {3}tst-b · total 8\.0 · Decide the outside question$/m);
    assert.match(rendered, /scores 8\.0 against the theme's next 4\.2/);
  });

  it('recommends staying when the theme’s next item is the queue’s top item', async () => {
    const rendered = renderBoundary(await boundary({ beads: themeFixture({ inside: 8.0, outside: 4.2 }) }));

    assert.equal(
      rendered,
      [
        'Boundary · theme tst-t · strategy v2',
        "recommendation: stay — the theme's next item is the queue's top item at 8.0, so higher-priority work waits nowhere else",
        'theme next  tst-a · total 8.0 · Decide the theme question',
        'queue top   tst-a · total 8.0 · Decide the theme question',
        "next: stay, switch or move is the human's call — nothing is recorded until they answer",
        '',
      ].join('\n'),
    );
  });

  it('renders a move with both scores and the reason the contributor gave', async () => {
    const { rendered } = await record({
      beads: themeFixture(),
      decide: 'move',
      reason: 'a break from the theme improves the next item',
    });

    assert.match(rendered, /^recommendation: switch — /m);
    assert.match(rendered, /^theme next {2}tst-a · total 4\.2 · /m);
    assert.match(rendered, /^queue top {3}tst-b · total 8\.0 · /m);
    assert.match(rendered, /^decision: move — a break from the theme improves the next item$/m);
  });

  it('prints the stored total instead of computing one from the components', async () => {
    // The stored totals are 9.9 and 9.8 while both records' components multiply out to 4.2, so
    // a block that recomputed a score could not print what this asserts.
    const rendered = renderBoundary(await boundary({ beads: themeFixture({ inside: 9.9, outside: 9.8 }) }));

    assert.match(rendered, /^recommendation: stay — the theme's next item is the queue's top item at 9\.9/m);
    assert.match(rendered, /^theme next {2}tst-a · total 9\.9 · /m);
    assert.match(rendered, /^queue top {3}tst-a · total 9\.9 · /m);
    assert.doesNotMatch(rendered, /4\.2/);
  });

  it('writes nothing until the human answers', async () => {
    const { notes } = await record({ beads: themeFixture() });

    assert.deepEqual(notes, []);
  });
});

describe('the recorded decision', () => {
  it('writes one timestamped trail entry on the theme bead, carrying both scores and the reason', async () => {
    const { notes } = await record({ beads: themeFixture(), decide: 'switch' });

    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, THEME);
    assert.equal(
      notes[0].text,
      '[2026-11-15T09:30:00.000Z] boundary: switch · theme next tst-a total 4.2 vs queue top tst-b total 8.0' +
        ' · reason: the queue\'s top item scores 8.0 against the theme\'s next 4.2, so higher-priority work waits elsewhere',
    );
    assert.match(notes[0].text, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] /);
  });

  it('shows the trail entry in the block, so the decision and its record are read together', async () => {
    const { rendered, notes } = await record({
      beads: themeFixture(),
      decide: 'move',
      reason: 'the next item reads better after a break',
    });

    assert.equal(notes.length, 1);
    assert.match(rendered, new RegExp(`^trail: ${THEME} · \\[2026-11-15T09:30:00\\.000Z\\] boundary: move · .*total 4\\.2 vs queue top tst-b total 8\\.0.*reason: the next item reads better after a break$`, 'm'));
  });

  it('records the reason given for a stay that agrees with the recommendation', async () => {
    const { notes } = await record({
      beads: themeFixture({ inside: 8.0, outside: 4.2 }),
      decide: 'stay',
      reason: 'the theme closes this week',
    });

    assert.equal(notes.length, 1);
    assert.match(notes[0].text, /boundary: stay · theme next tst-a total 8\.0 vs queue top tst-a total 8\.0 · reason: the theme closes this week/);
  });

  it('refuses a decision against the recommendation with no reason, and writes no trail entry', async () => {
    const { error, notes } = await refuse({ beads: themeFixture(), decide: 'move' });

    assert.ok(error instanceof UsageError);
    assert.match(error.message, /--decide move contradicts the recommendation \(switch\), so it needs --reason/);
    assert.deepEqual(notes, []);
  });

  it('refuses a decision outside the three outcomes, and writes no trail entry', async () => {
    const { error, notes } = await refuse({
      beads: themeFixture(),
      // @ts-expect-error — 'wander' is outside the union; this case calls the builder directly, so the builder's runtime check refuses it.
      decide: 'wander',
    });

    assert.ok(error instanceof UsageError);
    assert.match(error.message, /--decide takes stay, switch, move/);
    assert.deepEqual(notes, []);
  });
});

describe('the states that are stated instead of guessed', () => {
  it('states a theme with no ranked item, and offers the step that clears it', async () => {
    const rendered = renderBoundary(await boundary({ beads: themeFixture(), theme: 'tst-empty' }));

    assert.equal(
      rendered,
      [
        'No boundary · theme tst-empty has no ranked item',
        '  no scored execution:hitl bead sits under tst-empty',
        '  queue top   tst-b · total 8.0 · Decide the outside question',
        "next: name the theme's next item with --next <id>, or score it with score-bead",
        '',
      ].join('\n'),
    );
  });

  it('states a named next item the queue does not hold, with the top choice beside it', async () => {
    const rendered = renderBoundary(await boundary({ beads: themeFixture(), next: 'tst-zz' }));

    assert.equal(
      rendered,
      [
        'No boundary · tst-zz is not in the queue',
        '  tst-zz is not an open execution:hitl bead carrying a score — check it with bd show tst-zz',
        '  queue top   tst-b · total 8.0 · Decide the outside question',
        'next: name a scored bead from the queue, or score tst-zz with score-bead',
        '',
      ].join('\n'),
    );
  });

  it('compares the item the caller names when the theme’s own item is not the one in mind', async () => {
    const answer = await boundary({ beads: themeFixture(), next: 'tst-b' });

    assert.equal(answer.state, BOUNDARY_STATE.boundary);
    assert.equal(answer.row?.id, 'tst-b');
    assert.equal(answer.recommendation, 'stay');
  });

  it('states an empty queue, and offers the step that clears it', async () => {
    const rendered = renderBoundary(await boundary({ beads: [{ id: THEME, title: 'The theme being worked' }] }));

    assert.equal(
      rendered,
      [
        'No boundary · the queue is empty',
        '  no open execution:hitl beads',
        "next: file the theme's next item as an execution:hitl bead, or lift a deferral with bd update <id> --status open",
        '',
      ].join('\n'),
    );
  });

  it('keeps the three conditions distinct: no state reads like another', async () => {
    const states = [
      renderBoundary(await boundary({ beads: themeFixture(), theme: 'tst-empty' })),
      renderBoundary(await boundary({ beads: themeFixture(), next: 'tst-zz' })),
      renderBoundary(await boundary({ beads: [{ id: THEME, title: 'The theme being worked' }] })),
    ];

    assert.equal(new Set(states.map((rendered) => rendered.split('\n')[0])).size, states.length);
    for (const rendered of states) {
      assert.match(rendered, /^No boundary · /m);
      assert.match(rendered, /^next: /m);
    }
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

  /**
   * Run the real CLI in a workspace with the stub on PATH.
   * @param {object} options
   * @param {string} options.workspace
   * @param {{ binDir: string, graphFile: string }} options.stub
   * @param {string[]} [options.argv]
   * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
   */
  async function run({ workspace, stub, argv = [] }) {
    const env = { ...process.env, PATH: `${stub.binDir}:${process.env.PATH ?? ''}`, BD_GRAPH: stub.graphFile };
    return await execFileAsync(
      process.execPath,
      [SCRIPT, 'boundary', '--theme', THEME, ...argv, '--file', 'strategy.md', '--cwd', workspace],
      { cwd: workspace, env },
    ).then(
      ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
      (error) => ({ exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
    );
  }

  it('prints the comparison and exits 0, and exits 2 on a decision against the scores', async () => {
    const workspace = await makeWorkspace();
    await writeStrategy(workspace);
    const stub = await makeStubBd(workspace, themeFixture());

    const compared = await run({ workspace, stub });
    assert.equal(compared.exitCode, 0, compared.stderr);
    assert.match(compared.stdout, /^recommendation: switch — /m);
    assert.match(compared.stdout, /^theme next {2}tst-a · total 4\.2 · /m);
    assert.match(compared.stdout, /^queue top {3}tst-b · total 8\.0 · /m);

    const refused = await run({ workspace, stub, argv: ['--decide', 'move'] });
    assert.equal(refused.exitCode, 2);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /--decide move contradicts the recommendation \(switch\)/);
  });

  it('requires the theme, because a boundary belongs to one', async () => {
    const workspace = await makeWorkspace();
    await writeStrategy(workspace);
    const stub = await makeStubBd(workspace, themeFixture());

    const env = { ...process.env, PATH: `${stub.binDir}:${process.env.PATH ?? ''}`, BD_GRAPH: stub.graphFile };
    const refused = await execFileAsync(process.execPath, [SCRIPT, 'boundary'], { cwd: workspace, env }).then(
      ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
      (error) => ({ exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
    );

    assert.equal(refused.exitCode, 2);
    assert.match(refused.stderr, /--theme is required/);
  });
});
