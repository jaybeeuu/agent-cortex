// Tests for skills/workflow/hitl-queue/scripts/recommend.mjs — the one-item recommendation.
//
// The contract is a format and a refusal, so both are asserted literally. A fixture queue is
// rendered and the block compared line for line: the bead, its score components, both
// multipliers, what the answer unblocks, and the strategy line that justifies it. The three
// degraded states are compared to each other as well as to their own text, because "a distinct
// condition" is the claim, and one state that reads like another has failed it. The refusal is
// asserted too: a quote the strategy file does not contain is rejected, so a recommendation
// cannot carry an invented reason.
//
// The tracker is the in-memory `bd` the queue's own tests use, so the graph is data and the real
// database is never touched. The command line is exercised once through a stub binary, so the
// exit codes guppi's step reads are the exit codes the script really returns.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import { fakeBd } from './helpers/fake-bd-queue.mjs';
import { REQUIRED_SECTIONS } from '../skills/workflow/prioritise-work/scripts/strategy.mjs';
import { UsageError } from '../skills/workflow/hitl-queue/scripts/queue.mjs';
import {
  RECOMMEND_STATE,
  buildRecommendation,
  findQuote,
  renderRecommendation,
} from '../skills/workflow/hitl-queue/scripts/recommend.mjs';

const tempRoot = createTempRoot('hitl-recommend-');
const execFileAsync = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'skills', 'workflow', 'hitl-queue', 'scripts', 'recommend.mjs');
const HELPER = join(REPO_ROOT, 'test', 'helpers', 'fake-bd-queue.mjs');

/** The one line of the fixture strategy that justifies the top of the fixture queue. */
const THEME = 'shorter review turnaround for human-gated work.';

/**
 * One bead in the graph a test writes down.
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
    rationale: 'recommend test',
    ...overrides,
  };
}

/**
 * A valid strategy at version 2, written into a workspace, whose "Current themes" section holds
 * THEME.
 * @param {string} workspace @param {string} [name]
 * @returns {Promise<string>} the strategy path
 */
async function writeStrategy(workspace, name = 'strategy.md') {
  const sections = REQUIRED_SECTIONS.map((title) =>
    title === 'Current themes' ? `## ${title}\n\n- ${THEME}\n` : `## ${title}\n\n- the answer for ${title}.\n`,
  );
  const file = join(workspace, name);
  await writeFile(
    file,
    `# Prioritisation strategy\n\n- **Version:** 2\n- **Updated:** 2026-11-14\n\n${sections.join('\n')}`,
    'utf8',
  );
  return file;
}

/**
 * Two scored beads — one of which unblocks three — plus the three beads that wait on it.
 * `tst-a` wins on the dependent multiplier; `tst-b` is in progress and scores lower.
 * @returns {GraphBead[]}
 */
function queueFixture() {
  return [
    { id: 'tst-a', title: 'Ship the decision queue', labels: ['execution:hitl'], rice: rice() },
    { id: 'tst-b', title: 'Decide the API shape', status: 'in_progress', labels: ['execution:hitl'], rice: rice() },
    { id: 'tst-c', title: 'Wire the queue into plan', labels: ['execution:hitl'], dependsOn: ['tst-a'] },
    { id: 'tst-d', title: 'Report the queue from the agent', labels: ['execution:hitl'], dependsOn: ['tst-a'] },
    { id: 'tst-e', title: 'Score the backlog', labels: ['execution:hitl'], dependsOn: ['tst-a'] },
  ];
}

/**
 * Recommend from one fixture queue.
 * @param {object} options
 * @param {GraphBead[]} options.beads
 * @param {string} [options.file]
 * @param {string} [options.why]
 * @param {string} [options.bead]
 * @returns {Promise<string>}
 */
async function recommend({ beads, file, why = THEME, bead }) {
  const workspace = await tempRoot.createWorkspace();
  const strategyFile = file ?? (await writeStrategy(workspace));
  const recommendation = await buildRecommendation({
    bd: fakeBd(beads),
    file: strategyFile,
    cwd: workspace,
    why,
    bead,
  });
  return renderRecommendation(recommendation);
}

describe('one recommendation, from the queue and the strategy', () => {
  it('names one bead with its breakdown, what it unblocks, and the strategy line', async () => {
    const rendered = await recommend({ beads: queueFixture() });

    assert.equal(
      rendered,
      [
        'Recommendation · tst-a · total 10.0 · strategy v2',
        'Ship the decision queue',
        'rice 4.2 = R4 · I3 · C0.7 · E2  ×2.39 dependents(3)  ×1.0',
        'unblocks tst-c, tst-d, tst-e',
        `why: "${THEME}" · Current themes`,
        '',
      ].join('\n'),
    );
  });

  it('recommends one row, never the list it was read from', async () => {
    const rendered = await recommend({ beads: queueFixture() });

    assert.equal(rendered.split('\n').filter((line) => line.startsWith('Recommendation')).length, 1);
    assert.doesNotMatch(rendered, /tst-b/);
    assert.doesNotMatch(rendered, /tst-c · total/);
  });

  it('reports the queue’s own total instead of computing one from the components', async () => {
    // The stored total is 9.9 while the four components would multiply out to 4.2, so a
    // recommendation that recomputed the score could not print what this asserts.
    const beads = [
      { id: 'tst-a', title: 'Ship the decision queue', labels: ['execution:hitl'], rice: rice({ score: 9.9 }) },
    ];
    const rendered = await recommend({ beads });

    assert.match(rendered, /^Recommendation · tst-a · total 9\.9 · strategy v2$/m);
    assert.match(rendered, /^rice 9\.9 = R4 · I3 · C0\.7 · E2 {2}×1\.00 dependents\(0\) {2}×1\.0$/m);
    assert.doesNotMatch(rendered, /4\.2/);
  });

  it('gives the bead the human named, with one line naming the queue’s own top choice', async () => {
    const rendered = await recommend({ beads: queueFixture(), bead: 'tst-b' });

    assert.equal(
      rendered,
      [
        'Recommendation · tst-b · total 6.3 · strategy v2',
        'Decide the API shape',
        'rice 4.2 = R4 · I3 · C0.7 · E2  ×1.00 dependents(0)  ×1.5 in-progress',
        'unblocks nothing',
        `why: "${THEME}" · Current themes`,
        'queue top: tst-a · total 10.0 · Ship the decision queue',
        '',
      ].join('\n'),
    );
  });

  it('adds no disagreement line when the bead named is the queue’s top choice', async () => {
    const rendered = await recommend({ beads: queueFixture(), bead: 'tst-a' });

    assert.match(rendered, /^Recommendation · tst-a · total 10\.0/m);
    assert.doesNotMatch(rendered, /queue top:/);
  });
});

describe('the states that are stated instead of guessed', () => {
  it('states a missing strategy, names the file, and offers the strategy interview', async () => {
    const workspace = await tempRoot.createWorkspace();
    const rendered = await recommend({ beads: queueFixture(), file: join(workspace, 'absent.md') });

    assert.equal(
      rendered,
      [
        'No recommendation · no usable strategy',
        `  file: ${join(workspace, 'absent.md')}`,
        '  - no file at that path — write one with prioritise-work',
        'next: write or fix the strategy with prioritise-work, then run this again',
        '',
      ].join('\n'),
    );
  });

  it('states that nothing is scored, and offers to score one bead', async () => {
    const beads = queueFixture().map(({ rice: _rice, ...bead }) => bead);
    const rendered = await recommend({ beads });

    assert.equal(
      rendered,
      [
        'No recommendation · nothing is scored',
        '  5 open execution:hitl beads, none carrying a RICE score',
        'next: score one with score-bead, then run this again',
        '',
      ].join('\n'),
    );
  });

  it('states an empty queue, reports what it excluded, and offers the next step', async () => {
    const beads = [
      { id: 'tst-i', title: 'An idea not yet shaped', labels: ['execution:hitl', 'kind:idea'] },
      { id: 'tst-p', title: 'A parked decision', status: 'deferred', labels: ['execution:hitl'] },
    ];
    const rendered = await recommend({ beads });

    assert.equal(
      rendered,
      [
        'No recommendation · the queue is empty',
        '  no open execution:hitl beads',
        '  excluded: 1 kind:idea bead (--include-ideas ranks them); 1 deferred bead',
        'next: file the decision as an execution:hitl bead, or lift a deferral with bd update <id> --status open',
        '',
      ].join('\n'),
    );
  });

  it('states a named bead the queue does not hold, with the top choice beside it', async () => {
    const rendered = await recommend({ beads: queueFixture(), bead: 'tst-zz' });

    assert.equal(
      rendered,
      [
        'No recommendation · tst-zz is not in the queue',
        '  tst-zz is not an open execution:hitl bead — check it with bd show tst-zz',
        '  queue top: tst-a · total 10.0 · Ship the decision queue',
        'next: name a bead from the queue, or file this one as execution:hitl',
        '',
      ].join('\n'),
    );
  });

  it('keeps the four conditions distinct: no state reads like another', async () => {
    const workspace = await tempRoot.createWorkspace();
    const states = [
      await recommend({ beads: queueFixture(), file: join(workspace, 'absent.md') }),
      await recommend({ beads: queueFixture().map(({ rice: _rice, ...bead }) => bead) }),
      await recommend({ beads: [] }),
      await recommend({ beads: queueFixture(), bead: 'tst-zz' }),
    ];

    const firstLines = states.map((rendered) => rendered.split('\n')[0]);
    assert.equal(new Set(firstLines).size, states.length);
    for (const rendered of states) {
      assert.doesNotMatch(rendered, /^Recommendation ·/m);
      assert.match(rendered, /^next: /m);
    }
    assert.match(states[2], /^No recommendation · the queue is empty$/m);
    assert.match(states[3], /^No recommendation · tst-zz is not in the queue$/m);
  });
});

describe('the justification is quoted, never invented', () => {
  it('refuses a quote the strategy file does not contain', async () => {
    const workspace = await tempRoot.createWorkspace();
    const strategyFile = await writeStrategy(workspace);

    await assert.rejects(
      buildRecommendation({
        bd: fakeBd(queueFixture()),
        file: strategyFile,
        cwd: workspace,
        why: 'the vendor migration matters most',
      }),
      (error) => error instanceof UsageError && /no line of .* contains "the vendor migration matters most"/.test(error.message),
    );
  });

  it('refuses to render a recommendation with no line at all', async () => {
    const workspace = await tempRoot.createWorkspace();
    const strategyFile = await writeStrategy(workspace);

    const recommendation = await buildRecommendation({
      bd: fakeBd(queueFixture()),
      file: strategyFile,
      cwd: workspace,
    });

    assert.equal(recommendation.state, RECOMMEND_STATE.recommend);
    assert.throws(() => renderRecommendation(recommendation), (error) =>
      error instanceof UsageError && /--why needs the line of .* that justifies tst-a/.test(error.message));
  });

  it('quotes the file’s own line and the section it sits under', () => {
    const text = `## Current themes

- ${THEME}

## Explicitly out of scope

- ${THEME} for the internal tools.
`;

    assert.deepEqual(findQuote(text, 'shorter review turnaround'), {
      line: THEME,
      section: 'Current themes',
    });
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
      [SCRIPT, 'recommend', ...argv, '--file', 'strategy.md', '--cwd', workspace],
      { cwd: workspace, env },
    ).then(
      ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
      (error) => ({ exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
    );
  }

  it('prints the block and exits 0, and exits 2 on a quote the file does not hold', async () => {
    const workspace = await tempRoot.createWorkspace();
    await writeStrategy(workspace);
    const stub = await makeStubBd(workspace, queueFixture());

    const quoted = await run({ workspace, stub, argv: ['--why', THEME] });
    assert.equal(quoted.exitCode, 0, quoted.stderr);
    assert.match(quoted.stdout, /^Recommendation · tst-a · total 10\.0 · strategy v2$/m);
    assert.match(quoted.stdout, new RegExp(`^why: "${THEME}" · Current themes$`, 'm'));

    const invented = await run({ workspace, stub, argv: ['--why', 'the vendor migration matters most'] });
    assert.equal(invented.exitCode, 2);
    assert.equal(invented.stdout, '');
    assert.match(invented.stderr, /no line of .* contains "the vendor migration matters most"/);
  });
});
