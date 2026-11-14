// Tests for skills/workflow/score-bead/scripts/rice.mjs — RICE scoring and priority
// banding for one bead.
//
// Four facts the design rests on, each driven through the real CLI against a stub `bd`
// that records every invocation as an argv line: the stored arithmetic reproduces the
// stated formula, a refusal reaches the tracker zero times, re-scoring keeps the
// superseded score in the rationale trail, and `band` cannot touch a P0 bead. The last
// case copies both skill directories into the flat layout the Claude Code installer
// produces, so the cross-skill import is proven outside the grouped tree.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import { REQUIRED_SECTIONS } from '../skills/workflow/prioritise-work/scripts/strategy.mjs';
import {
  DEFAULT_BANDS,
  INCIDENT_PRIORITY,
  bandFor,
  computeScore,
} from '../skills/workflow/score-bead/scripts/rice.mjs';

const tempRoot = createTempRoot('rice-');
const execFileAsync = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'skills', 'workflow', 'score-bead', 'scripts', 'rice.mjs');
const DEFAULT_FILE = '.agent-cortex/working-docs/strategy.md';

/**
 * A filled strategy, built from the sections the prioritise-work validator requires.
 * @param {object} [options]
 * @param {string} [options.version]
 * @param {string[]} [options.omit]
 * @returns {string}
 */
function strategyText({ version = '2', omit = [] } = {}) {
  const sections = REQUIRED_SECTIONS.filter((title) => !omit.includes(title)).map(
    (title) => `## ${title}\n\n- the answer for ${title}.\n`,
  );
  return `# Prioritisation strategy\n\n- **Version:** ${version}\n- **Updated:** 2026-11-14\n\n${sections.join('\n')}`;
}

/**
 * A stub `bd`: records every invocation as one JSON argv line, and answers `show` from a
 * fixture file. A launcher shell script pins the running node binary, so the stub works
 * without relying on `node` being on PATH.
 * @param {string} workspace
 * @returns {Promise<{ binDir: string, log: string, showFile: string }>}
 */
async function makeStubBd(workspace) {
  const binDir = join(workspace, 'bin');
  await mkdir(binDir, { recursive: true });

  const stub = join(workspace, 'stub-bd.mjs');
  await writeFile(
    stub,
    `import { appendFile, readFile } from "node:fs/promises";
const args = process.argv.slice(2);
await appendFile(process.env.BD_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "show") process.stdout.write(await readFile(process.env.BD_SHOW_FILE, "utf8"));
`,
    'utf8',
  );
  const launcher = join(binDir, 'bd');
  await writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${stub}" "$@"\n`, 'utf8');
  await chmod(launcher, 0o755);

  return { binDir, log: join(workspace, 'bd-called.log'), showFile: join(workspace, 'bead.json') };
}

/**
 * Every invocation the stub recorded, oldest first. An absent log means "no call at all",
 * which is the assertion the refusal path turns on.
 * @param {string} log
 * @returns {Promise<string[][]>}
 */
async function calls(log) {
  const raw = await readFile(log, 'utf8').catch(() => '');
  return raw
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

/**
 * The `--metadata` payload of the one `update` call.
 * @param {string[][]} recorded
 * @returns {{ rice: Record<string, unknown> }}
 */
function writtenMetadata(recorded) {
  const update = recorded.find((argv) => argv[0] === 'update');
  assert.ok(update !== undefined, 'the run made no bd update call');
  const at = update.indexOf('--metadata');
  assert.notEqual(at, -1, `the update carried no --metadata: ${update.join(' ')}`);
  return JSON.parse(update[at + 1]);
}

/**
 * Run the real CLI in a workspace with the stub on PATH.
 * @param {object} options
 * @param {string} options.workspace
 * @param {{ binDir: string, log: string, showFile: string }} options.stub
 * @param {string[]} options.argv
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run({ workspace, stub, argv }) {
  const env = { ...process.env, PATH: `${stub.binDir}:${process.env.PATH ?? ''}`, BD_SHOW_FILE: stub.showFile, BD_LOG: stub.log };
  return execFileAsync(process.execPath, [SCRIPT, ...argv, '--cwd', workspace], { cwd: workspace, env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({
      code: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }),
  );
}

/**
 * Write the bead JSON the stub serves, then run the CLI.
 * @param {object} options
 * @param {string} options.workspace
 * @param {{ binDir: string, log: string, showFile: string }} options.stub
 * @param {string[]} options.argv
 * @param {object} [options.bead]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function runWithBead({ workspace, stub, argv, bead }) {
  if (bead !== undefined) await writeFile(stub.showFile, JSON.stringify([bead]), 'utf8');
  return run({ workspace, stub, argv });
}

/** A valid strategy written into the workspace, returning its path. @param {string} workspace
 * @param {object} [options] @returns {Promise<string>} */
async function writeStrategy(workspace, options) {
  const file = join(workspace, 'strategy.md');
  await writeFile(file, strategyText(options), 'utf8');
  return file;
}

describe('the formula', () => {
  it('stores the components and the total they produce, to one decimal', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stub = await makeStubBd(workspace);
    const file = await writeStrategy(workspace, { version: '2' });

    const result = await runWithBead({
      workspace,
      stub,
      bead: { id: 'tst-1', priority: 2 },
      argv: [
        'score', 'tst-1',
        '--reach', '4', '--impact', '3', '--confidence', '0.7', '--effort', '2',
        '--rationale', 'unblocks the messaging epic — Current themes',
        '--file', file,
        '--at', '2026-11-14T09:00:00.000Z',
      ],
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /score 4\.2 = reach 4 × impact 3 × confidence 0\.7 ÷ effort 2 \(strategy v2\)/);

    const { rice } = writtenMetadata(await calls(stub.log));
    assert.equal(rice.reach, 4);
    assert.equal(rice.impact, 3);
    assert.equal(rice.confidence, 0.7);
    assert.equal(rice.effort, 2);
    assert.equal(rice.score, 4.2);
    assert.equal(rice.strategyVersion, 2, 'the version recorded is the file\'s own version');
    assert.equal(rice.assessedAt, '2026-11-14T09:00:00.000Z');
    assert.equal(rice.rationale, 'unblocks the messaging epic — Current themes');
  });

  it('rounds once, on the total, so the stored components reproduce it', () => {
    /** @type {Array<[number, number, number, number, number]>} */
    const cases = [
      [4, 3, 0.7, 2, 4.2], // exact after rounding: 4.199…
      [5, 3, 0.8, 2, 6],
      [1, 1, 0.33, 3, 0.1], // 0.11 rounds down
      [5, 3, 1, 4, 3.8], // 3.75 rounds up
    ];
    for (const [reach, impact, confidence, effort, expected] of cases) {
      const score = computeScore({ reach, impact, confidence, effort });
      assert.equal(score, expected, `${reach}×${impact}×${confidence}/${effort}`);
      assert.equal(
        Math.round(((reach * impact * confidence) / effort) * 10) / 10,
        score,
        'the stored total must match the stated formula',
      );
    }
  });
});

describe('re-scoring', () => {
  it('records the new strategy version and keeps the replaced score in the rationale trail', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stub = await makeStubBd(workspace);
    const file = await writeStrategy(workspace, { version: '3' });

    const previous = {
      reach: 4, impact: 3, confidence: 0.7, effort: 2, score: 4.2,
      strategyVersion: 2,
      assessedAt: '2026-11-14T09:00:00.000Z',
      rationale:
        'first argument — Current themes\n' +
        '[prior] score 1 @ strategy v1, assessed 2026-10-01T00:00:00.000Z (reach 1, impact 1, confidence 0.5, effort 2)',
    };

    const result = await runWithBead({
      workspace,
      stub,
      bead: { id: 'tst-2', priority: 2, metadata: { rice: previous } },
      argv: [
        'score', 'tst-2',
        '--reach', '5', '--impact', '3', '--confidence', '0.8', '--effort', '2',
        '--rationale', 're-scored against the December rubric',
        '--file', file,
        '--at', '2026-12-01T10:00:00.000Z',
      ],
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /replaced score 4\.2 @ strategy v2 — kept in the rationale trail/);

    const { rice } = writtenMetadata(await calls(stub.log));
    assert.equal(rice.score, 6);
    assert.equal(rice.strategyVersion, 3);

    const rationale = /** @type {string} */ (rice.rationale);
    const lines = rationale.split('\n');
    assert.equal(lines[0], 're-scored against the December rubric');
    assert.match(rationale, /\[prior\] score 4\.2 @ strategy v2, assessed 2026-11-14T09:00:00\.000Z \(reach 4, impact 3, confidence 0\.7, effort 2\)/);
    // The oldest entry is carried through, ahead of the one just replaced.
    assert.ok(
      rationale.indexOf('[prior] score 1 ') < rationale.indexOf('[prior] score 4.2 '),
      'the trail must stay in date order',
    );
  });
});

describe('refusal', () => {
  it('fails on a missing strategy and makes no tracker call at all', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stub = await makeStubBd(workspace);

    const result = await runWithBead({
      workspace,
      stub,
      bead: { id: 'tst-3', priority: 2 },
      argv: ['score', 'tst-3', '--reach', '5', '--impact', '3', '--confidence', '0.8', '--effort', '2', '--rationale', 'x'],
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`${DEFAULT_FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} does not exist`));
    assert.deepEqual(await calls(stub.log), [], 'a refusal must not reach bd at all');
  });

  it('fails on an invalid strategy, naming the defect, and makes no tracker call', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stub = await makeStubBd(workspace);
    const file = join(workspace, 'strategy.md');
    await writeFile(file, strategyText({ omit: ['How to calibrate effort'] }), 'utf8');

    const result = await runWithBead({
      workspace,
      stub,
      bead: { id: 'tst-4', priority: 2 },
      argv: ['score', 'tst-4', '--reach', '5', '--impact', '3', '--confidence', '0.8', '--effort', '2', '--rationale', 'x', '--file', file],
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /is not a valid strategy/);
    assert.match(result.stderr, /missing required section: "## How to calibrate effort"/);
    assert.deepEqual(await calls(stub.log), [], 'a refusal must not reach bd at all');
  });

  it('refuses a confidence outside 0..1 and an effort of zero before touching the tracker', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stub = await makeStubBd(workspace);
    const file = await writeStrategy(workspace);

    const confidence = await runWithBead({
      workspace,
      stub,
      bead: { id: 'tst-5', priority: 2 },
      argv: ['score', 'tst-5', '--reach', '5', '--impact', '3', '--confidence', '1.4', '--effort', '2', '--rationale', 'x', '--file', file],
    });
    const effort = await runWithBead({
      workspace,
      stub,
      bead: { id: 'tst-5', priority: 2 },
      argv: ['score', 'tst-5', '--reach', '5', '--impact', '3', '--confidence', '0.8', '--effort', '0', '--rationale', 'x', '--file', file],
    });

    assert.equal(confidence.code, 2);
    assert.match(confidence.stderr, /--confidence is a probability between 0 and 1 \(got 1\.4\)/);
    assert.equal(effort.code, 2);
    assert.match(effort.stderr, /--effort must be greater than zero \(got 0\)/);
    assert.deepEqual(await calls(stub.log), []);
  });
});

describe('band', () => {
  it('proposes the banded priority, prints the command, and applies nothing', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stub = await makeStubBd(workspace);

    const result = await runWithBead({
      workspace,
      stub,
      bead: { id: 'tst-6', priority: 3, metadata: { rice: { score: 4.2 } } },
      argv: ['band', 'tst-6'],
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /score 4\.2 → P2 \(currently P3\)/);
    assert.match(result.stdout, /proposal only .* bd update tst-6 -p 2/);

    const recorded = await calls(stub.log);
    assert.deepEqual(recorded, [['show', 'tst-6', '--json']], 'band reads and never writes');
  });

  it('never proposes P0, for any score or any table entry', () => {
    for (let score = -1; score <= 60; score += 0.1) {
      const priority = bandFor(score);
      assert.ok(priority >= INCIDENT_PRIORITY + 1, `score ${score} produced P${priority}`);
    }
    assert.ok(bandFor(1e6) >= 1);
    assert.ok(DEFAULT_BANDS.every((band) => band.priority > INCIDENT_PRIORITY));

    // The guard is live, not merely true of today's table: a table entry that would file a
    // computed score as an incident is refused.
    assert.throws(
      () => bandFor(9, [{ minScore: 0, priority: 0 }]),
      /banding never produces P0/,
    );
  });

  it('refuses a bead already at P0 and writes nothing', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stub = await makeStubBd(workspace);

    const result = await runWithBead({
      workspace,
      stub,
      bead: { id: 'tst-7', priority: 0, metadata: { rice: { score: 9.9 } } },
      argv: ['band', 'tst-7'],
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /refusing to band tst-7: it is already P0/);
    const recorded = await calls(stub.log);
    assert.deepEqual(recorded, [['show', 'tst-7', '--json']], 'a P0 bead is not touched');
  });

  it('refuses a bead with no score', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stub = await makeStubBd(workspace);

    const result = await runWithBead({
      workspace,
      stub,
      bead: { id: 'tst-8', priority: 2, metadata: { rice: {} } },
      argv: ['band', 'tst-8'],
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no RICE score on tst-8 — run "score tst-8" first/);
    assert.deepEqual(await calls(stub.log), [['show', 'tst-8', '--json']]);
  });
});

describe('the install layout', () => {
  // The Claude Code plugin copies every skill flat into skills/<name>/, so a script that
  // imports its neighbour two directories up must still resolve there. Copy both trees the
  // way the installer does and load the script from that tree.
  it('loads the strategy module from the flat plugin layout', async () => {
    const workspace = await tempRoot.createWorkspace();
    const flat = join(workspace, 'skills');
    await mkdir(flat, { recursive: true });
    await cp(join(REPO_ROOT, 'skills', 'workflow', 'score-bead'), join(flat, 'score-bead'), { recursive: true });
    await cp(join(REPO_ROOT, 'skills', 'workflow', 'prioritise-work'), join(flat, 'prioritise-work'), { recursive: true });

    const { stdout } = await execFileAsync(process.execPath, [join(flat, 'score-bead', 'scripts', 'rice.mjs'), '--help']);

    assert.match(stdout, /never touches a bead already at P0/);
  });
});
