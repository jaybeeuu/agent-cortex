// Tests for skills/workflow/run-pipeline-stage/scripts/trail-entry.mjs — the one
// writer for the bead trail.
//
// Two layers. The shape, retry and idempotency cases drive the module with an in-memory
// `bd`/`git`, so a transient failure can be injected at an exact call. The last case runs
// the real CLI against a real `bd` workspace in a temp repository, because the point of
// the script is what `bd show` and `bd provenance log` report afterwards — a fake cannot
// answer that.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import {
  TRAIL_SOURCE,
  UsageError,
  buildEntry,
  fingerprintEntry,
  isTransient,
  recordTrailEntry,
  resolveCommitSha,
  runCli,
  validateFields,
} from '../skills/workflow/run-pipeline-stage/scripts/trail-entry.mjs';

const tempRoot = createTempRoot('trail-entry-');
const execFileAsync = promisify(execFile);

const testDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(testDir, '..');
const SCRIPT = join(REPO_ROOT, 'skills', 'workflow', 'run-pipeline-stage', 'scripts', 'trail-entry.mjs');

const FULL_SHA = /^[0-9a-f]{40}$/;
const SHORT_SHA = '2610b78';
const RESOLVED_SHA = '2610b780a0c7c3b9f0e0d1c2b3a4958687788990';

/** A bd failure with the shape embeddeddolt reports when two writers collide. */
function transientError() {
  return new Error('failed to open database: context canceled');
}

/** A bd failure that no retry can fix. */
function permanentError() {
  return new Error('issue not found');
}

/**
 * An in-memory `bd` that records what it was asked, so a case can assert the note count
 * as well as the entry's shape.
 * @param {object} [options]
 * @param {string} [options.notes]
 * @param {Array<{ error: Error, afterWrite?: boolean } | null>} [options.noteFailures]  Per-attempt failure for the note append.
 * @param {Array<{ error: Error } | null>} [options.provenanceFailures]
 * @returns {{ bd: (args: string[]) => Promise<string>, state: { notes: string, noteAttempts: number, provenance: Array<{ refKind: string, ref: string }>, calls: string[][], sleepCalls: number[] } }}
 */
function makeFakeBd({ notes = '', noteFailures = [], provenanceFailures = [] } = {}) {
  const state = {
    notes,
    noteAttempts: 0,
    provenance: /** @type {Array<{ refKind: string, ref: string }>} */ ([]),
    calls: /** @type {string[][]} */ ([]),
    sleepCalls: /** @type {number[]} */ ([]),
  };

  /** @param {string[]} args */
  const bd = async (args) => {
    state.calls.push(args);

    if (args[0] === 'show') {
      return JSON.stringify([{ id: args[1], notes: state.notes }]);
    }

    if (args[0] === 'note') {
      const text = args[2];
      const failure = noteFailures[state.noteAttempts];
      state.noteAttempts += 1;
      if (failure) {
        if (failure.afterWrite) state.notes = append(state.notes, text);
        throw failure.error;
      }
      state.notes = append(state.notes, text);
      return '';
    }

    if (args[0] === 'provenance') {
      const refKind = valueOf(args, '--ref-kind');
      const ref = valueOf(args, '--ref');
      const failure = provenanceFailures.filter(Boolean)[state.provenance.length];
      if (failure) throw failure.error;
      // bd's own idempotency: the same event is recorded once.
      if (!state.provenance.some((entry) => entry.refKind === refKind && entry.ref === ref)) {
        state.provenance.push({ refKind, ref });
      }
      return '';
    }

    throw new Error(`unexpected bd call: ${args.join(' ')}`);
  };

  return { bd, state };
}

/** Read a `--flag value` pair out of an argv array.
 * @param {string[]} args @param {string} flag @returns {string} */
function valueOf(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? '' : args[index + 1];
}

/** Append a note the way bd does: separated from the previous one by a newline.
 * @param {string} notes @param {string} text @returns {string} */
function append(notes, text) {
  return notes === '' ? text : `${notes}\n${text}`;
}

/** Every trail entry in a notes string.
 * @param {string} notes @returns {string[]} */
function entriesIn(notes) {
  return [...notes.matchAll(/\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[[a-z-]+\] trail:[0-9a-f]{16}/g)].map((match) => match[0]);
}

/** A git runner that resolves any ref to a fixed full SHA.
 * @param {string} [sha] @returns {{ git: (args: string[]) => Promise<string>, calls: string[][] }} */
function makeFakeGit(sha = RESOLVED_SHA) {
  /** @type {string[][]} */
  const calls = [];
  /** @param {string[]} args */
  const git = async (args) => {
    calls.push(args);
    return `${sha}\n`;
  };
  return { git, calls };
}

/** @typedef {'done' | 'blocked' | 'partial'} Outcome */

/** The arguments every well-formed case needs.
 * @type {{ beadId: string, stage: string, outcome: Outcome, evidence: string, remaining: string, at: string }} */
const BASE = {
  beadId: 'bd-1.1',
  stage: 'code',
  outcome: 'done',
  evidence: 'pnpm test — 412 passing, 0 failing',
  remaining: 'none',
  at: '2026-05-01T10:00:00Z',
};

describe('entry shape', () => {
  it('carries the three mandatory fields, one per line, under a fingerprint header', () => {
    const text = buildEntry({
      at: BASE.at,
      stage: 'code',
      outcome: 'blocked',
      evidence: 'pnpm test — 3 failing\nin test/a.test.mjs',
      remaining: 'fix the parser, then re-run',
      refs: { commit: RESOLVED_SHA, branch: 'feature/proj-1' },
      fingerprint: '0123456789abcdef',
    });

    const lines = text.split('\n');
    assert.equal(lines.length, 5);
    assert.equal(lines[0], '[2026-05-01T10:00:00Z] [code] trail:0123456789abcdef');
    assert.equal(lines[1], 'Outcome: blocked');
    // Multi-line command output is collapsed, so a field never breaks the shape.
    assert.equal(lines[2], 'Evidence: pnpm test — 3 failing in test/a.test.mjs');
    assert.equal(lines[3], 'What is left: fix the parser, then re-run');
    assert.equal(lines[4], `Refs: git-sha:${RESOLVED_SHA}, branch:feature/proj-1`);
  });

  it('omits the refs line when the caller named no refs', () => {
    const text = buildEntry({
      at: BASE.at,
      stage: 'housekeeping',
      outcome: 'done',
      evidence: 'prune-worktrees.mjs exit 0',
      remaining: 'none',
      refs: {},
      fingerprint: '0123456789abcdef',
    });

    assert.equal(text.includes('Refs:'), false);
  });

  it('fingerprints identical transitions identically and different ones apart', () => {
    const refs = { commit: RESOLVED_SHA };
    const first = fingerprintEntry({ ...BASE, refs });
    const again = fingerprintEntry({ ...BASE, refs });
    const other = fingerprintEntry({ ...BASE, refs, evidence: 'pnpm test — 1 failing' });

    assert.equal(first, again);
    assert.notEqual(first, other);
    assert.match(first, /^[0-9a-f]{16}$/);
  });
});

describe('field validation', () => {
  it('rejects an outcome outside done|blocked|partial', () => {
    assert.throws(() => validateFields({ ...BASE, outcome: 'great', refs: {} }), UsageError);
  });

  it('rejects an empty evidence or remaining field', () => {
    assert.throws(() => validateFields({ ...BASE, evidence: '   ', refs: {} }), UsageError);
    assert.throws(() => validateFields({ ...BASE, remaining: '', refs: {} }), UsageError);
  });

  it('rejects a pr ref that is not a full URL', () => {
    assert.throws(() => validateFields({ ...BASE, refs: { pr: '42' } }), /full URL/);
  });
});

describe('SHA resolution', () => {
  it('resolves a short ref to the full 40-character lowercase SHA', async () => {
    const { git, calls } = makeFakeGit();

    const sha = await resolveCommitSha({ ref: SHORT_SHA, git });

    assert.equal(sha, RESOLVED_SHA);
    assert.match(sha, FULL_SHA);
    assert.deepEqual(calls[0], ['rev-parse', '--verify', `${SHORT_SHA}^{commit}`]);
  });

  it('refuses an abbreviated SHA and records nothing', async () => {
    const { git } = makeFakeGit(SHORT_SHA);
    const { bd, state } = makeFakeBd();

    await assert.rejects(
      recordTrailEntry({ ...BASE, refs: { commit: SHORT_SHA }, deps: { bd, git, sleep: async () => {} } }),
      /40-character lowercase SHA/,
    );

    assert.equal(state.calls.length, 0, 'no bead call may happen before the ref resolves');
  });

  it('records the resolved SHA, never the ref the caller typed', async () => {
    const { git } = makeFakeGit();
    const { bd, state } = makeFakeBd();

    const report = await recordTrailEntry({
      ...BASE,
      refs: { commit: SHORT_SHA },
      deps: { bd, git, sleep: async () => {} },
    });

    assert.equal(report.provenance[0].refKind, 'git-sha');
    assert.equal(report.provenance[0].ref, RESOLVED_SHA);
    // The full SHA begins with the short ref, so compare the whole line.
    assert.match(state.notes, new RegExp(`^Refs: git-sha:${RESOLVED_SHA}$`, 'm'));
  });
});

describe('retry', () => {
  it('retries a transient database failure and records exactly once', async () => {
    const { bd, state } = makeFakeBd({ noteFailures: [{ error: transientError() }] });
    const sleepCalls = /** @type {number[]} */ ([]);

    const report = await recordTrailEntry({
      ...BASE,
      deps: { bd, git: makeFakeGit().git, sleep: async (ms) => { sleepCalls.push(ms); } },
    });

    assert.equal(report.recorded, true);
    assert.equal(report.attempts, 2);
    assert.equal(entriesIn(state.notes).length, 1);
    assert.deepEqual(sleepCalls, [100], 'the first retry waits one backoff step');
  });

  it('doubles the backoff on each retry', async () => {
    const { bd } = makeFakeBd({
      noteFailures: [{ error: transientError() }, { error: transientError() }, { error: transientError() }],
    });
    const sleepCalls = /** @type {number[]} */ ([]);

    const report = await recordTrailEntry({
      ...BASE,
      deps: { bd, git: makeFakeGit().git, sleep: async (ms) => { sleepCalls.push(ms); } },
    });

    assert.equal(report.attempts, 4);
    assert.deepEqual(sleepCalls, [100, 200, 400]);
  });

  it('does not append twice when the failed call had already written the note', async () => {
    const { bd, state } = makeFakeBd({ noteFailures: [{ error: transientError(), afterWrite: true }] });

    const report = await recordTrailEntry({
      ...BASE,
      deps: { bd, git: makeFakeGit().git, sleep: async () => {} },
    });

    assert.equal(report.recorded, false, 'the retry found the entry already present');
    assert.equal(entriesIn(state.notes).length, 1);
  });

  it('gives up on a permanent failure and leaves the bead intact', async () => {
    const { bd, state } = makeFakeBd({ notes: 'an earlier note', noteFailures: [{ error: permanentError() }] });

    await assert.rejects(
      recordTrailEntry({ ...BASE, deps: { bd, git: makeFakeGit().git, sleep: async () => {} } }),
      /trail append on bd-1\.1 failed and is not transient: issue not found/,
    );

    assert.equal(state.noteAttempts, 1, 'a permanent failure is not retried');
    assert.equal(state.notes, 'an earlier note');
    assert.deepEqual(state.provenance, [], 'nothing is recorded when the note failed');
  });

  it('reports without corrupting the bead when provenance fails permanently', async () => {
    const { bd, state } = makeFakeBd({ provenanceFailures: [{ error: permanentError() }] });

    await assert.rejects(
      recordTrailEntry({
        ...BASE,
        refs: { branch: 'feature/proj-1' },
        deps: { bd, git: makeFakeGit().git, sleep: async () => {} },
      }),
      /bd provenance record branch:feature\/proj-1 failed and is not transient/,
    );

    // The note is the recovery contract, so it survives; the failure is reported instead.
    assert.equal(entriesIn(state.notes).length, 1);
  });

  it('classifies the retry shape by message, not by exit code alone', () => {
    assert.equal(isTransient('failed to open database: context canceled'), true);
    assert.equal(isTransient('database is locked'), true);
    assert.equal(isTransient('issue not found'), false);
  });
});

describe('idempotency', () => {
  it('records one entry and one provenance event when fired twice', async () => {
    const { bd, state } = makeFakeBd();
    const deps = { bd, git: makeFakeGit().git, sleep: async () => {} };
    const options = { ...BASE, refs: { commit: SHORT_SHA }, deps };

    const first = await recordTrailEntry(options);
    const second = await recordTrailEntry(options);

    assert.equal(first.recorded, true);
    assert.equal(second.recorded, false);
    assert.equal(entriesIn(state.notes).length, 1);
    assert.equal(state.provenance.length, 1);
  });

  it('keeps two genuinely different transitions apart', async () => {
    const { bd, state } = makeFakeBd();
    const deps = { bd, git: makeFakeGit().git, sleep: async () => {} };

    await recordTrailEntry({ ...BASE, deps });
    await recordTrailEntry({ ...BASE, outcome: 'blocked', evidence: 'pnpm test — 2 failing', deps });

    assert.equal(entriesIn(state.notes).length, 2);
  });
});

describe('CLI', () => {
  it('prints a JSON report and exits 0', async () => {
    const { bd, state } = makeFakeBd();
    let output = '';
    let errors = '';

    const code = await runCli({
      argv: [
        '--bead', 'bd-1.1', '--stage', 'code', '--outcome', 'done',
        '--evidence', 'pnpm lint clean', '--remaining', 'none', '--json',
        '--at', BASE.at,
      ],
      write: (chunk) => { output += chunk; },
      writeError: (chunk) => { errors += chunk; },
      deps: { bd, git: makeFakeGit().git, sleep: async () => {} },
    });

    assert.equal(code, 0, errors);
    const report = JSON.parse(output);
    assert.equal(report.bead, 'bd-1.1');
    assert.equal(report.outcome, 'done');
    assert.equal(report.recorded, true);
    assert.equal(entriesIn(state.notes).length, 1);
  });

  it('exits 2 with usage on a malformed call, writing nothing', async () => {
    const { bd, state } = makeFakeBd();
    let errors = '';

    const code = await runCli({
      argv: ['--bead', 'bd-1.1', '--stage', 'code', '--outcome', 'great', '--evidence', 'x', '--remaining', 'y'],
      write: () => {},
      writeError: (chunk) => { errors += chunk; },
      deps: { bd, git: makeFakeGit().git, sleep: async () => {} },
    });

    assert.equal(code, 2);
    assert.match(errors, /--outcome must be one of done\|blocked\|partial/);
    assert.equal(state.calls.length, 0);
  });

  it('exits 1 when bd refuses for good', async () => {
    const { bd } = makeFakeBd({ noteFailures: [{ error: permanentError() }] });
    let errors = '';

    const code = await runCli({
      argv: ['--bead', 'bd-1.1', '--stage', 'code', '--outcome', 'done', '--evidence', 'x', '--remaining', 'none'],
      write: () => {},
      writeError: (chunk) => { errors += chunk; },
      deps: { bd, git: makeFakeGit().git, sleep: async () => {} },
    });

    assert.equal(code, 1);
    assert.match(errors, /trail-entry failed: trail append on bd-1\.1/);
  });
});

describe('no shipped skill keeps a file-based progress log', () => {
  // The artefacts, not the words: a document may still explain what replaced the log.
  const BANNED = [
    /\.agent-cortex\/ralph\/ralph-/,   // the per-parent log path
    /ralph-[^\s`"'() ]*\.log/,         // any ralph-*.log filename
    /progress\.md/,                    // the retired rendered view
    /\blogLine\b/,                     // the state.json field that fed the tail
    /tail -n \+/,                      // the tail that polled one
  ];

  /** Every shipped document and script under skills/ and agents/.
   * @param {string} dir @returns {Promise<string[]>} */
  async function collect(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await collect(full)));
      else if (/\.(md|mjs|js|json|ts)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('mentions no writer anywhere in skills/ or agents/', async () => {
    const files = [
      ...(await collect(join(REPO_ROOT, 'skills'))),
      ...(await collect(join(REPO_ROOT, 'agents'))),
    ];

    /** @type {string[]} */
    const offenders = [];
    for (const file of files) {
      const source = await readFile(file, 'utf-8');
      for (const pattern of BANNED) {
        if (pattern.test(source)) offenders.push(`${relative(REPO_ROOT, file)} matches ${pattern}`);
      }
    }

    assert.deepEqual(offenders, []);
  });

  it('routes the stage runner and the orchestrator to the trail-entry script', async () => {
    for (const file of [
      join(REPO_ROOT, 'skills', 'workflow', 'run-pipeline-stage', 'prompts', 'stage-runner.md'),
      join(REPO_ROOT, 'skills', 'workflow', 'run-pipeline-stage', 'SKILL.md'),
      join(REPO_ROOT, 'skills', 'workflow', 'ralph', 'SKILL.md'),
      join(REPO_ROOT, 'skills', 'workflow', 'ralph', 'REFERENCE.md'),
    ]) {
      const source = await readFile(file, 'utf-8');
      assert.match(source, /trail-entry\.mjs/, `${relative(REPO_ROOT, file)} must name the trail writer`);
    }
  });
});

// The one case that talks to a real `bd`. bd's embedded dolt engine costs seconds per
// invocation, so the integration case is skippable (TRAIL_ENTRY_REAL_BD=0 for a fast local
// loop) and skipped anywhere bd is not installed. Nothing else here touches a real bead
// database: every other case drives an in-memory bd through the same argv contract.
const BD_AVAILABLE = process.env.TRAIL_ENTRY_REAL_BD !== '0'
  && await execFileAsync('bd', ['version'], { encoding: 'utf-8' })
    .then(() => true)
    .catch(() => false);

describe('real bd workspace', { skip: !BD_AVAILABLE }, () => {
  it('lands one visible entry per transition, with a full-length SHA', async () => {
    // A whole throwaway repository: its own .beads, its own HOME, never the real one.
    const workspace = await tempRoot.createWorkspace();
    const home = join(workspace, 'home');
    const repo = join(workspace, 'repo');
    await mkdir(home, { recursive: true });
    await mkdir(repo, { recursive: true });

    // HOME keeps bd's global state (and dolt's) inside the workspace.
    const env = { ...process.env, HOME: home, BD_NON_INTERACTIVE: '1' };

    /** Shell out with argv only. @param {string} bin @param {string[]} args @param {string} cwd */
    const run = async (bin, args, cwd) => {
      const { stdout } = await execFileAsync(bin, args, { cwd, env, encoding: 'utf-8' });
      return stdout;
    };

    await run('git', ['init', '--quiet'], repo);
    await writeFile(join(repo, 'README.md'), 'trail test\n');
    await run('git', ['add', 'README.md'], repo);
    await run('git', [
      '-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false',
      'commit', '-qm', 'init',
    ], repo);

    // The repo's own commit, abbreviated the way a caller would type it.
    const headSha = (await run('git', ['rev-parse', 'HEAD'], repo)).trim();
    const shortSha = headSha.slice(0, 7);

    await run('bd', ['init', '--prefix', 'trail'], repo);
    const beadId = (await run('bd', ['create', 'Trail test bead', '--type', 'chore', '--silent'], repo)).trim();

    /** Run the script the way a stage worker does. @param {string[]} args */
    const record = (args) => run(process.execPath, [SCRIPT, '--bead', beadId, '--at', '2026-05-01T10:00:00Z', ...args], repo);

    // A full transition carrying every ref, with the commit abbreviated.
    await record([
      '--stage', 'code', '--outcome', 'done',
      '--evidence', 'pnpm test — 412 passing', '--remaining', 'document the change',
      '--commit', shortSha,
      '--branch', 'feature/trail',
      '--pr', 'https://example.test/pr/1',
      '--work-id', '.agent-cortex/worktrees/trail',
    ]);

    // A second transition with no refs at all.
    await record(['--stage', 'code', '--outcome', 'partial', '--evidence', 'pnpm test — 3 failing', '--remaining', 'fix the parser']);

    const [bead] = JSON.parse(await run('bd', ['show', beadId, '--json'], repo));
    assert.equal(entriesIn(bead.notes).length, 2, 'one entry per transition, no more');

    const text = await run('bd', ['show', beadId], repo);
    assert.match(text, /Outcome: done/);
    assert.match(text, /Outcome: partial/);
    assert.match(text, /Evidence: pnpm test — 412 passing/);
    assert.match(text, /What is left: fix the parser/);

    const shaLine = /git-sha:([0-9a-f]+)/.exec(bead.notes);
    assert.ok(shaLine, 'the note names the commit');
    assert.equal(shaLine[1], headSha, 'the note carries the full SHA of the abbreviated ref');
    assert.equal(shaLine[1].length, 40);
    assert.match(shaLine[1], FULL_SHA);

    const provenance = JSON.parse(await run('bd', ['provenance', 'log', beadId, '--json'], repo));
    assert.deepEqual(
      provenance.map((/** @type {{ ref_kind: string, source: string }} */ event) => event.ref_kind).sort(),
      ['branch', 'git-sha', 'pr', 'work-id'],
    );
    assert.ok(provenance.every((/** @type {{ source: string }} */ event) => event.source === TRAIL_SOURCE));
    const recordedSha = provenance.find((/** @type {{ ref_kind: string }} */ event) => event.ref_kind === 'git-sha');
    assert.equal(recordedSha.ref, headSha, 'provenance records the resolved SHA, not the abbreviation');

    // A repeated fire (a second run after the first finished) must append nothing.
    await record(['--stage', 'code', '--outcome', 'partial', '--evidence', 'pnpm test — 3 failing', '--remaining', 'fix the parser']);
    const after = JSON.parse(await run('bd', ['show', beadId, '--json'], repo))[0];
    assert.equal(entriesIn(after.notes).length, 2, 'a repeat of an existing transition appends nothing');
  });
});
