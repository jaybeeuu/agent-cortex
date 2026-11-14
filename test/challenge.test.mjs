// Tests for skills/workflow/prioritise-work/scripts/challenge.mjs — the recorder that turns
// a priority challenge into a strategy review and refuses a silent reorder.
//
// The failure this file exists to prevent is the tempting one: the human says "this should
// be higher", and the score is edited. So every case below drives the two outcomes that are
// allowed — the rubric changed and moved, or the rubric stood and nothing moved — and then
// drives the two that are refused: a resolution that contradicts the file, and an order that
// moved while the version stayed put.
//
// It also pins this script's trail entry to `run-pipeline-stage`'s trail writer, so the repo
// keeps one trail shape and not two.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import { REQUIRED_SECTIONS } from '../skills/workflow/prioritise-work/scripts/strategy.mjs';
import {
  buildEntry,
  fingerprintEntry,
} from '../skills/workflow/run-pipeline-stage/scripts/trail-entry.mjs';
import {
  ChallengeError,
  buildEntry as buildChallengeEntry,
  describeMoves,
  diffOrder,
  parseOrder,
  reviewChallenge,
  runCli,
} from '../skills/workflow/prioritise-work/scripts/challenge.mjs';

const tempRoot = createTempRoot('challenge-');
const execFileAsync = promisify(execFile);

/** A timestamp the entries can be compared against without depending on the clock. */
const AT = '2026-12-01T09:30:00.000Z';

/**
 * A valid strategy at `version`, built from the sections the validator requires, so a case
 * names only the value it cares about.
 * @param {object} [options]
 * @param {number} [options.version]
 * @param {string} [options.updated]
 * @param {string} [options.changeLog]  A change-log entry, or '' for none.
 * @returns {string}
 */
function createStrategy({ version = 3, updated = '2026-11-14', changeLog = `- ${updated} v${version}: the rubric as it stands.` } = {}) {
  const sections = REQUIRED_SECTIONS.map((title) => `## ${title}\n\n- the answer for ${title}.\n`);
  const log = changeLog === '' ? '' : `## Change log\n\n${changeLog}\n`;
  return `# Prioritisation strategy\n\n- **Version:** ${version}\n- **Updated:** ${updated}\n\n${sections.join('\n')}${log}`;
}

/**
 * Write a strategy into a fresh workspace and return its path and that workspace.
 * @param {string} text
 * @returns {Promise<{ workspace: string, file: string }>}
 */
async function writeStrategy(text) {
  const workspace = await tempRoot.createWorkspace();
  const file = join(workspace, 'strategy.md');
  await writeFile(file, text, 'utf8');
  return { workspace, file };
}

/**
 * Run the challenge CLI in-process and capture both streams.
 * @param {string[]} argv
 * @param {{ cwd?: string, now?: string }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function run(argv, { cwd, now = AT } = {}) {
  let stdout = '';
  let stderr = '';
  const code = await runCli({
    argv,
    ...(cwd === undefined ? {} : { cwd }),
    now,
    write: (chunk) => {
      stdout += chunk;
    },
    writeError: (chunk) => {
      stderr += chunk;
    },
  });
  return { code, stdout, stderr };
}

/**
 * The argv for a `record` run against `file`, with `overrides` replacing any default.
 * @param {string} file
 * @param {Record<string, string>} [overrides]
 * @returns {string[]}
 */
function recordArgs(file, overrides = {}) {
  const values = {
    bead: 'agnt-ctx-demo.1',
    challenge: 'this should be higher',
    resolution: 'no-change',
    reason: 'the rubric already ranks it this way',
    'from-version': '3',
    ...overrides,
  };
  const argv = ['record'];
  for (const [key, value] of Object.entries(values)) {
    if (value === '') continue;
    argv.push(`--${key}`, value);
  }
  argv.push('--file', file);
  return argv;
}

describe('the order diff', () => {
  it('reports both items of a swap with their old and new positions', () => {
    const diff = diffOrder(['a', 'b', 'c'], ['b', 'a', 'c']);

    assert.equal(diff.moved.length, 2);
    assert.deepEqual(diff.moved, [
      { id: 'b', from: 2, to: 1, delta: 1 },
      { id: 'a', from: 1, to: 2, delta: -1 },
    ]);
    assert.equal(diff.identical, false);
  });

  it('reports arrivals and departures, and calls an unchanged order identical', () => {
    const diff = diffOrder(['a', 'b'], ['a', 'c']);

    assert.deepEqual(diff.added, [{ id: 'c', to: 2 }]);
    assert.deepEqual(diff.dropped, [{ id: 'b', from: 2 }]);
    assert.equal(diffOrder(['a', 'b'], ['a', 'b']).identical, true);
  });

  it('renders the same clause for the same two lists', () => {
    const first = describeMoves(diffOrder(['a', 'b', 'c', 'd'], ['d', 'b', 'a', 'c']));
    const second = describeMoves(diffOrder(['a', 'b', 'c', 'd'], ['d', 'b', 'a', 'c']));

    assert.equal(first, 'd #4→#1, a #1→#3, c #3→#4');
    assert.equal(first, second);
  });

  // A repeated id is the only input whose map fill order differs from its position order: `a`
  // is keyed first but sits at position 3, so iteration alone would name it first. parseOrder
  // rejects a repeated id, so the CLI never sends one, and the sorts in diffOrder are what keep
  // the guarantee independent of the fill order even so.
  it('reports moves in new-position order when the maps fill out of position order', () => {
    const diff = diffOrder(['b', 'a'], ['a', 'b', 'a']);

    assert.equal(describeMoves(diff), 'b #1→#2, a #2→#3');
  });

  it('rejects an order that names one bead twice', () => {
    assert.throws(() => parseOrder('a,b,a'), /names "a" twice/);
  });
});

describe('the silent reorder', () => {
  it('refuses to record an order that moved while the version stayed at 3', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 3 }));

    const result = await run([...recordArgs(file), '--before', 'a,b,c', '--after', 'b,a,c']);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /the order moved \(b #2→#1, a #1→#2\) but the strategy stayed at v3/);
    assert.equal(result.stdout, '');
  });

  it('still refuses a moved order when the change log is emptied', async () => {
    const { file } = await writeStrategy(
      createStrategy({ version: 3, changeLog: '<!-- oldest first, one line per bump -->' }),
    );

    const result = await run([...recordArgs(file), '--before', 'a,b,c', '--after', 'b,a,c']);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /the order moved \(b #2→#1, a #1→#2\) but the strategy stayed at v3/);
  });

  it('leaves the strategy file byte-identical when it refuses', async () => {
    const text = createStrategy({ version: 3 });
    const { file } = await writeStrategy(text);

    await run([...recordArgs(file), '--before', 'a,b,c', '--after', 'b,a,c']);

    assert.equal(await readFile(file, 'utf8'), text);
  });

  it('refuses a "changed" resolution when the version did not rise', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 3 }));

    const result = await run(
      recordArgs(file, { resolution: 'changed', reason: 'the theme is review speed now' }).concat([
        '--before',
        'a,b,c',
        '--after',
        'a,b,c',
      ]),
    );

    assert.equal(result.code, 1);
    assert.match(result.stderr, /version did not rise \(v3 → v3\)/);
  });

  it('refuses a "no-change" resolution when the version rose', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 4 }));

    const result = await run(recordArgs(file, { 'from-version': '3' }));

    assert.equal(result.code, 1);
    assert.match(result.stderr, /version moved \(v3 → v4\), so the resolution is "changed"/);
  });
});

describe('a rubric change', () => {
  it('records the challenge, the new version and the two moved items', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 4, updated: '2026-12-01' }));

    const result = await run(
      recordArgs(file, {
        resolution: 'changed',
        reason: 'the theme is review speed this month',
        'from-version': '3',
      }).concat(['--before', 'a,b,c', '--after', 'b,a,c']),
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /^\[2026-12-01T09:30:00\.000Z\] \[challenge\] trail:[0-9a-f]{16}$/m);
    assert.match(result.stdout, /^Outcome: done$/m);
    assert.match(result.stdout, /strategy v3 → v4 \(updated 2026-12-01\)/);
    assert.match(result.stdout, /order 3 items, 2 moved: b #2→#1, a #1→#2/);
    assert.match(result.stdout, /^What is left: nothing — scores are re-ranked against strategy v4$/m);
  });

  it('prints the same entry text on a repeated run with the same timestamp', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 4, updated: '2026-12-01' }));
    const argv = recordArgs(file, { resolution: 'changed', 'from-version': '3' }).concat([
      '--before',
      'a,b,c',
      '--after',
      'b,a,c',
    ]);

    const first = await run(argv);
    const second = await run(argv);

    assert.equal(first.code, 0);
    assert.equal(first.stdout, second.stdout);
  });

  it('carries the diff in the --json report', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 4, updated: '2026-12-01' }));

    const result = await run(
      recordArgs(file, { resolution: 'changed', 'from-version': '3' }).concat([
        '--before',
        'a,b,c',
        '--after',
        'b,a,c',
        '--json',
      ]),
    );

    assert.equal(result.code, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.version, 4);
    assert.equal(report.fromVersion, 3);
    assert.equal(report.order.moved.length, 2);
    assert.deepEqual(report.order.moved, [
      { id: 'b', from: 2, to: 1, delta: 1 },
      { id: 'a', from: 1, to: 2, delta: -1 },
    ]);
  });
});

describe('a challenge the rubric answers unchanged', () => {
  it('still records the challenge, its reasoning and the standing order', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 3 }));

    const result = await run(
      recordArgs(file, { reason: 'the value section already requires a human gate' }).concat([
        '--before',
        'a,b,c',
        '--after',
        'a,b,c',
      ]),
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /challenged "this should be higher" against v3/);
    assert.match(result.stdout, /no rubric change: the value section already requires a human gate/);
    assert.match(result.stdout, /the order did not move/);
    assert.match(result.stdout, /^What is left: nothing — the queue stands and the challenge is answered$/m);
  });

  it('records without an order, and says nothing moved', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 3 }));

    const result = await run(recordArgs(file), { cwd: undefined });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /^Evidence: .*the order did not move$/m);
    assert.doesNotMatch(result.stdout, /moved:/);
  });

  it('writes nothing to the strategy file', async () => {
    const text = createStrategy({ version: 3 });
    const { file } = await writeStrategy(text);

    await run(recordArgs(file));

    assert.equal(await readFile(file, 'utf8'), text);
  });
});

describe('the trail shape', () => {
  it('renders exactly what the pipeline trail writer renders for the same fields', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 4, updated: '2026-12-01' }));

    const result = await run(
      recordArgs(file, { resolution: 'changed', 'from-version': '3' }).concat([
        '--before',
        'a,b,c',
        '--after',
        'b,a,c',
        '--json',
      ]),
    );

    const report = JSON.parse(result.stdout);
    /** @type {{ beadId: string, stage: string, outcome: 'done', evidence: string, remaining: string, refs: { commit?: string, branch?: string, pr?: string, workId?: string } }} */
    const fields = {
      beadId: report.bead,
      stage: 'challenge',
      outcome: 'done',
      evidence: report.evidence,
      remaining: report.remaining,
      refs: {},
    };
    const expected = buildEntry({ at: AT, ...fields, fingerprint: fingerprintEntry(fields) });

    assert.equal(report.entry, expected);
  });

  it('renders the entry outside the JSON report too, and both agree', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 3 }));
    const argv = recordArgs(file);

    const text = await run(argv);
    const json = await run([...argv, '--json']);

    assert.equal(JSON.parse(json.stdout).entry, text.stdout.trim());
  });
});

describe('the entry file', () => {
  it('writes the entry to --out and points the caller at it, not at a quoted string', async () => {
    const { workspace, file } = await writeStrategy(createStrategy({ version: 3 }));
    const out = join(workspace, 'entry.txt');

    const result = await run(recordArgs(file).concat(['--out', out]));

    assert.equal(result.code, 0);
    assert.equal(await readFile(out, 'utf8'), result.stdout, 'the tracker must append the entry the caller saw');
    assert.ok(
      result.stderr.includes(`next: bd note agnt-ctx-demo.1 --file ${out}`),
      'the hint names the file, so the entry reaches the tracker as data',
    );
  });

  it('carries a challenge with a substitution and a quote into the file verbatim', async () => {
    const { workspace, file } = await writeStrategy(createStrategy({ version: 3 }));
    const out = join(workspace, 'entry.txt');
    const words = 'raise it $(touch /tmp/pwned) and keep "quotes"';

    const result = await run(recordArgs(file, { challenge: words }).concat(['--out', out]));

    assert.equal(result.code, 0);
    assert.ok((await readFile(out, 'utf8')).includes(`challenged "${words}"`), 'the words survive as data');
  });
});

describe('the CLI', () => {
  it('rejects a resolution outside changed and no-change', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 3 }));

    const result = await run(recordArgs(file, { resolution: 'maybe' }));

    assert.equal(result.code, 2);
    assert.match(result.stderr, /--resolution must be changed or no-change/);
  });

  it('rejects a missing --from-version', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 3 }));

    const result = await run(recordArgs(file, { 'from-version': '' }));

    assert.equal(result.code, 2);
    assert.match(result.stderr, /--from-version is required/);
  });

  it('refuses a challenge against a missing strategy file', async () => {
    const workspace = await tempRoot.createWorkspace();

    const result = await run(recordArgs(join(workspace, 'strategy.md')), { cwd: workspace });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not exist — there is no rubric to challenge/);
  });

  it('refuses a challenge against an invalid strategy', async () => {
    const { file } = await writeStrategy(createStrategy({ version: 3, changeLog: '- 2026-11-14 v2: stale line.' }));

    const result = await run(recordArgs(file));

    assert.equal(result.code, 1);
    assert.match(result.stderr, /the strategy is not valid/);
    assert.match(result.stderr, /names v2 but the version is v3/);
  });
});

describe('the guard in-process', () => {
  it('throws rather than returning a report when the order moved with no bump', () => {
    assert.throws(
      () =>
        reviewChallenge({
          text: createStrategy({ version: 3 }),
          beadId: 'agnt-ctx-demo.1',
          challenge: 'this should be higher',
          resolution: 'changed',
          reason: 'someone wanted it higher',
          fromVersion: 3,
          before: ['a', 'b'],
          after: ['b', 'a'],
          at: AT,
        }),
      (error) => error instanceof ChallengeError && /version did not rise/.test(error.message),
    );
  });

  it('builds an entry with the three mandatory fields and a 16-character fingerprint', () => {
    const entry = buildChallengeEntry({
      at: AT,
      stage: 'challenge',
      outcome: 'done',
      evidence: 'challenged "x"',
      remaining: 'nothing',
      fingerprint: 'a'.repeat(16),
    });

    assert.equal(entry.split('\n').length, 4);
    assert.match(entry, /^\[2026-12-01T09:30:00\.000Z\] \[challenge\] trail:a{16}$/m);
  });
});

describe('the tracker', () => {
  it('is never invoked by record', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stubDir = join(workspace, 'bin');
    const marker = join(workspace, 'bd-called.log');
    await mkdir(stubDir, { recursive: true });
    await writeFile(join(stubDir, 'bd'), `#!/bin/sh\necho "$@" >> ${marker}\n`, 'utf8');
    await chmod(join(stubDir, 'bd'), 0o755);

    const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ''}` };
    const file = join(workspace, 'strategy.md');
    await writeFile(file, createStrategy({ version: 3 }), 'utf8');

    // Prove the stub fires before relying on its silence: a stub that cannot run would
    // make the real assertion vacuous.
    await execFileAsync(join(stubDir, 'bd'), ['ready'], { cwd: workspace, env });
    assert.equal(await readFile(marker, 'utf8'), 'ready\n');
    await writeFile(marker, '', 'utf8');

    const script = fileURLToPath(new URL('../skills/workflow/prioritise-work/scripts/challenge.mjs', import.meta.url));
    await execFileAsync(process.execPath, [script, ...recordArgs(file)], { cwd: workspace, env });

    assert.equal(await readFile(marker, 'utf8'), '');
  });
});
