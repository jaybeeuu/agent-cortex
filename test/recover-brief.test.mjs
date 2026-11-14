// Tests for skills/workflow/run-pipeline-stage/scripts/recover-brief.mjs — the read side
// of the bead trail.
//
// Two layers. The shape, budget, empty-section and read-only cases drive the module with an
// in-memory `bd`, so an exact call sequence and an exact line count are assertable. The last
// group runs the real CLI against a real `bd` workspace in a temp repository, because the
// acceptance criteria are about what a session sees: a bounded brief for a bead carrying 20
// trail entries, and a tracker that was not written to.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import { buildEntry } from '../skills/workflow/run-pipeline-stage/scripts/trail-entry.mjs';
import {
  DEFAULT_MAX_LINES,
  MAX_FIELD_CHARS,
  blockingDeps,
  dedupeTrail,
  isReadOnlyCall,
  makeReadOnlyBd,
  parseArgs,
  renderBrief,
  runCli,
  splitTrail,
} from '../skills/workflow/run-pipeline-stage/scripts/recover-brief.mjs';

const tempRoot = createTempRoot('recover-brief-');
const execFileAsync = promisify(execFile);

const testDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(testDir, '..');
const SCRIPT = join(REPO_ROOT, 'skills', 'workflow', 'run-pipeline-stage', 'scripts', 'recover-brief.mjs');
const WRITER = join(REPO_ROOT, 'skills', 'workflow', 'run-pipeline-stage', 'scripts', 'trail-entry.mjs');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** One trail entry in the writer's shape: header, three fields, optional refs.
 * @param {number} index
 * @param {{ stage?: string, outcome?: string, evidence?: string, remaining?: string, refs?: string }} [overrides]
 * @returns {string} */
function entryText(index, { stage = 'code', outcome = 'partial', evidence, remaining, refs } = {}) {
  const lines = [
    `[2026-05-01T10:00:${String(index % 60).padStart(2, '0')}Z] [${stage}] trail:${String(index).padStart(4, '0')}aaaaaaaaaaaa`,
    `Outcome: ${outcome}`,
    `Evidence: ${evidence ?? `pnpm test — ${index} passing, checkpoint ${index} of the stage recorded`}`,
    `What is left: ${remaining ?? `finish checkpoint ${index}`}`,
  ];
  if (refs !== undefined) lines.push(`Refs: ${refs}`);
  return lines.join('\n');
}

/** A note carrying `count` entries, the way `bd note` accumulates them: newline-joined.
 * @param {number} count @returns {string} */
function notesWith(count) {
  return Array.from({ length: count }, (_, i) => entryText(i + 1)).join('\n');
}

/** The bd JSON for a bead, as `bd show <id> --json` prints it (a one-element array).
 * @param {object} [overrides] @returns {Record<string, unknown>[]} */
function beadJson(overrides = {}) {
  return [{
    id: 'bd-1.1',
    title: 'Add a bounded recovery brief',
    status: 'in_progress',
    priority: 2,
    issue_type: 'chore',
    labels: ['execution:afk', 'stage:code'],
    parent: 'bd-1',
    description: 'Recover a half-finished bead in one command.',
    notes: '',
    dependencies: [],
    ...overrides,
  }];
}

/** Provenance events as `bd provenance log <id> --json` prints them, newest first.
 * @returns {Record<string, unknown>[]} */
function provenanceJson() {
  return [
    { ref: 'https://example.test/pr/7', ref_kind: 'pr', created_at: '2026-05-01T10:00:03Z' },
    { ref: 'feature/brief', ref_kind: 'branch', created_at: '2026-05-01T10:00:02Z' },
    { ref: 'b'.repeat(40), ref_kind: 'git-sha', created_at: '2026-05-01T10:00:01Z' },
  ];
}

/**
 * An in-memory `bd` that records every call. `strict` refuses anything outside the read
 * subcommands, so a write reaching the runner fails the case that drives it.
 * @param {object} [options]
 * @param {Record<string, unknown>[]} [options.bead]
 * @param {Record<string, unknown>[]} [options.provenance]
 * @param {boolean} [options.strict]
 * @param {Error} [options.failure]
 * @returns {{ bd: (args: string[]) => Promise<string>, calls: string[][] }}
 */
function makeFakeBd({ bead = beadJson(), provenance = provenanceJson(), strict = true, failure } = {}) {
  /** @type {string[][]} */
  const calls = [];
  /** @param {string[]} args */
  const bd = async (args) => {
    calls.push(args);
    if (failure) throw failure;
    if (strict && !isReadOnlyCall(args)) throw new Error(`write reached bd: ${args.join(' ')}`);
    if (args[0] === 'show') return JSON.stringify(bead);
    if (args[0] === 'provenance' && args[1] === 'log') return JSON.stringify(provenance);
    throw new Error(`unexpected bd call: ${args.join(' ')}`);
  };
  return { bd, calls };
}

/** The output as an array of lines. @param {string} output @returns {string[]} */
function linesOf(output) {
  return output.trimEnd().split('\n');
}

/** Run the CLI against a fake bd and return its output.
 * @param {object} options
 * @param {Record<string, unknown>[]} [options.bead]
 * @param {Record<string, unknown>[]} [options.provenance]
 * @param {string[]} [options.argv]
 * @param {boolean} [options.strict]
 * @param {Error} [options.failure]
 * @returns {Promise<{ code: number, output: string, errors: string, calls: string[][] }>} */
async function runFake({ bead, provenance, argv = [], strict, failure }) {
  const { bd, calls } = makeFakeBd({
    ...(bead === undefined ? {} : { bead }),
    ...(provenance === undefined ? {} : { provenance }),
    ...(strict === undefined ? {} : { strict }),
    ...(failure === undefined ? {} : { failure }),
  });
  let output = '';
  let errors = '';
  const code = await runCli({
    argv: ['--bead', 'bd-1.1', ...argv],
    write: (chunk) => { output += chunk; },
    writeError: (chunk) => { errors += chunk; },
    deps: { bd, sleep: async () => {} },
  });
  return { code, output, errors, calls };
}

// ─── Bounded read ─────────────────────────────────────────────────────────────

describe('recover-brief: bounded read', () => {
  it('prints the newest entries and summarises the rest by count', async () => {
    const { code, output } = await runFake({ bead: beadJson({ notes: notesWith(20) }) });
    const lines = linesOf(output);

    assert.equal(code, 0);
    assert.ok(lines.length <= DEFAULT_MAX_LINES, `brief printed ${lines.length} lines, budget is ${DEFAULT_MAX_LINES}`);
    assert.match(output, /trail \(newest 3 of 20; 17 earlier not shown\):/);
    // The latest entry, and only the latest: the reader needs the newest checkpoint.
    assert.match(output, /evidence: pnpm test — 20 passing/);
    assert.match(output, /left: finish checkpoint 20/);
    assert.doesNotMatch(output, /finish checkpoint 1\b/);
  });

  it('holds the budget when the caller widens the window', async () => {
    const { output } = await runFake({ bead: beadJson({ notes: notesWith(20) }), argv: ['--trail', '20'] });
    const lines = linesOf(output);

    assert.ok(lines.length <= DEFAULT_MAX_LINES, `--trail 20 printed ${lines.length} lines`);
    assert.match(output, /left: finish checkpoint 20/);
  });

  it('holds an explicit budget, down to a single entry', async () => {
    const { output } = await runFake({ bead: beadJson({ notes: notesWith(20) }), argv: ['--trail', '20', '--max-lines', '18'] });
    const lines = linesOf(output);

    assert.ok(lines.length <= 18, `--max-lines 18 printed ${lines.length} lines`);
    assert.match(output, /trail \(newest 1 of 20; 19 earlier not shown\):/);
  });

  it('never exceeds the budget, even when it cannot shrink a section further', async () => {
    const { output } = await runFake({
      bead: beadJson({ notes: notesWith(20), dependencies: [{ id: 'bd-9', status: 'open', title: 'Blocker', dependency_type: 'blocks' }] }),
      argv: ['--max-lines', '10'],
    });

    assert.equal(linesOf(output).length, 10);
    assert.match(output, /truncated at 10 lines/);
  });

  it('clips one very long field instead of spending the budget on it', async () => {
    const long = 'x'.repeat(2000);
    const { output } = await runFake({ bead: beadJson({ notes: entryText(1, { evidence: long, remaining: long }) }) });
    const lines = linesOf(output);
    const evidenceLine = lines.find((line) => line.includes('evidence:')) ?? '';

    assert.ok(evidenceLine.length <= MAX_FIELD_CHARS + 20, `evidence line was ${evidenceLine.length} characters`);
    assert.ok(evidenceLine.trimEnd().endsWith('…'));
  });
});

// ─── Sections ─────────────────────────────────────────────────────────────────

describe('recover-brief: empty and missing sections', () => {
  it('states plainly that a bead carries no trail', async () => {
    const { code, output } = await runFake({ bead: beadJson({ notes: '' }) });

    assert.equal(code, 0);
    assert.match(output, /^trail: no entries yet — this bead carries no trail$/m);
    assert.doesNotMatch(output, /^trail .*:$/m, 'no section heading is printed with nothing under it');
    assert.match(output, /^next: no trail entry/m);
  });

  it('says so for provenance, acceptance criteria and blockers alike', async () => {
    const { output } = await runFake({ bead: beadJson({ notes: '' }), provenance: [] });

    assert.match(output, /^provenance: none$/m);
    assert.match(output, /^acceptance criteria: none recorded$/m);
    assert.match(output, /^blocked by: none$/m);
  });

  it('reads acceptance criteria from the description when the field is empty', async () => {
    const description = [
      'Recover a half-finished bead.',
      '',
      '## Scope',
      '',
      '- the brief',
      '',
      '## Acceptance Criteria',
      '',
      '- One invocation prints what is needed.',
      '- Output stays under about 40 lines.',
      '',
      '## Notes',
      '',
      '- not acceptance',
    ].join('\n');
    const { output } = await runFake({ bead: beadJson({ notes: '', description }) });

    assert.match(output, /^acceptance criteria:$/m);
    assert.match(output, /^ {2}- One invocation prints what is needed\.$/m);
    assert.match(output, /^ {2}- Output stays under about 40 lines\.$/m);
    assert.doesNotMatch(output, /not acceptance/);
  });

  it('prefers the acceptance field over the description section', async () => {
    const description = '## Acceptance Criteria\n\n- from the description\n';
    const { output } = await runFake({ bead: beadJson({ notes: '', description, acceptance_criteria: 'from the field' }) });

    assert.match(output, /from the field/);
    assert.doesNotMatch(output, /from the description/);
  });
});

describe('recover-brief: dependencies', () => {
  it('lists an unsatisfied blocking dependency and hides a satisfied one', () => {
    const blockedBy = blockingDeps([
      { id: 'bd-9', status: 'open', title: 'Decide the API', dependency_type: 'blocks' },
      { id: 'bd-8', status: 'closed', title: 'Already merged', dependency_type: 'blocks' },
      { id: 'bd-1', status: 'in_progress', title: 'The parent', dependency_type: 'parent-child' },
    ]);

    assert.deepEqual(blockedBy.map((dep) => dep.id), ['bd-9']);
  });

  it('prints the blocker with its id, status and title', async () => {
    const { output } = await runFake({
      bead: beadJson({
        notes: notesWith(2),
        dependencies: [
          { id: 'bd-9', status: 'blocked', title: 'Decide the upstream API', dependency_type: 'blocks' },
          { id: 'bd-8', status: 'closed', title: 'Already merged', dependency_type: 'blocks' },
        ],
      }),
    });

    assert.match(output, /^blocked by 1:$/m);
    assert.match(output, /^ {2}bd-9 {2}blocked {2}Decide the upstream API$/m);
    assert.doesNotMatch(output, /Already merged/);
  });

  it('tolerates a bead with no dependencies array at all', async () => {
    const { output } = await runFake({ bead: beadJson({ notes: '', dependencies: undefined }) });
    assert.match(output, /^blocked by: none$/m);
  });
});

// ─── Read-only ────────────────────────────────────────────────────────────────

describe('recover-brief: never writes', () => {
  it('makes read calls only, each carrying --readonly', async () => {
    const { code, calls } = await runFake({ bead: beadJson({ notes: notesWith(3) }) });

    assert.equal(code, 0);
    assert.ok(calls.length > 0);
    for (const args of calls) {
      assert.ok(isReadOnlyCall(args), `not a read call: ${args.join(' ')}`);
      assert.ok(args.includes('--readonly'), `call did not ask bd for read-only mode: ${args.join(' ')}`);
      assert.ok(!['note', 'update', 'close', 'create', 'dep'].includes(args[0]), `write subcommand: ${args.join(' ')}`);
    }
  });

  it('refuses a write before it reaches the binary', async () => {
    /** @type {string[][]} */
    const calls = [];
    const guarded = makeReadOnlyBd(async (args) => {
      calls.push(args);
      return '[]';
    });

    for (const args of [['note', 'bd-1.1', 'text'], ['update', 'bd-1.1', '--status', 'closed'], ['provenance', 'record', '--issue', 'bd-1.1']]) {
      await assert.rejects(guarded(args), /refusing a non-read bd call/);
    }
    assert.deepEqual(calls, [], 'no write reached the runner');
  });

  it('accepts the two reads it makes', () => {
    assert.equal(isReadOnlyCall(['show', 'bd-1.1', '--json']), true);
    assert.equal(isReadOnlyCall(['provenance', 'log', 'bd-1.1', '--json']), true);
    assert.equal(isReadOnlyCall(['provenance', 'record', '--issue', 'bd-1.1']), false);
    assert.equal(isReadOnlyCall(['note', 'bd-1.1', 'x']), false);
  });
});

// ─── Parsing ──────────────────────────────────────────────────────────────────

describe('recover-brief: parsing the note', () => {
  it('splits on the writer header, not on blank lines inside a body', () => {
    const notes = [
      entryText(1, { remaining: 'next' }),
      '',
      entryText(2),
    ].join('\n');

    const entries = splitTrail(notes);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].stage, 'code');
    assert.equal(entries[0].remaining, 'next');
    assert.equal(entries[1].fingerprint, '0002aaaaaaaaaaaa');
  });

  it('ends a stamped entry at the first line that is not one of its fields', () => {
    const notes = entryText(1, { evidence: 'pnpm test — 412 passing\nsecond line', remaining: 'next' });

    const entries = splitTrail(notes);
    assert.equal(entries.length, 2);
    // A field is one line: the writer collapses its values, so a stray line is its own note.
    assert.equal(entries[0].evidence, 'pnpm test — 412 passing');
    assert.equal(entries[1].at, null);
    assert.equal(entries[1].text, 'second line');
  });

  it('keeps a free-form note as an entry rather than dropping it', () => {
    const entries = splitTrail('hand written note, no header\nsecond line');

    assert.equal(entries.length, 1);
    assert.equal(entries[0].at, null);
    assert.equal(entries[0].text, 'hand written note, no header');
  });

  it('collapses a duplicate fingerprint, keeping the later occurrence', () => {
    const notes = [entryText(1, { remaining: 'first fire' }), entryText(1, { remaining: 'second fire' })].join('\n');
    const trail = dedupeTrail(splitTrail(notes));

    assert.equal(trail.length, 1);
    assert.equal(trail[0].remaining, 'second fire');
  });

  it('reads a header the writer did not stamp with a fingerprint', () => {
    const entries = splitTrail('[2026-05-01T10:00:00Z] [verify]\nOutcome: done\nEvidence: lint clean\nWhat is left: none');

    assert.equal(entries.length, 1);
    assert.equal(entries[0].fingerprint, null);
    assert.equal(entries[0].outcome, 'done');
  });

  it('prints a stopped-work note as free text rather than dropping it', async () => {
    const note = '[2026-05-01T10:00:00Z] stopped: API choice open; decision bead filed';
    const { output } = await runFake({ bead: beadJson({ notes: note }) });

    assert.match(output, /^ {2}\(note\) \[2026-05-01T10:00:00Z\] stopped: API choice open/m);
  });

  it('counts a hand-written note that follows a stamped entry, and prints it', async () => {
    const notes = [
      entryText(1, { remaining: 'wire the CLI' }),
      '[2026-05-01T11:00:00Z] stopped: API choice open; decision bead filed',
    ].join('\n');
    const { output } = await runFake({ bead: beadJson({ notes, status: 'blocked' }) });

    assert.match(output, /^trail \(newest 2 of 2\):$/m);
    assert.match(output, /^ {2}\(note\) \[2026-05-01T11:00:00Z\] stopped: API choice open; decision bead filed$/m);
    assert.match(output, /^ {2}\[2026-05-01T10:00:01Z\] \[code\] partial$/m);
  });

  it('keeps two hand-written notes apart instead of collapsing them into one', () => {
    const notes = [
      entryText(1),
      '[2026-05-01T11:00:00Z] stopped: API choice open; decision bead filed',
      '[2026-05-01T12:00:00Z] resumed: upstream API chosen',
    ].join('\n');
    const entries = splitTrail(notes);

    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((entry) => entry.text), [
      'Outcome: partial',
      '[2026-05-01T11:00:00Z] stopped: API choice open; decision bead filed',
      '[2026-05-01T12:00:00Z] resumed: upstream API chosen',
    ]);
  });

  it('keeps a hand-written note that sits between two stamped entries', () => {
    const notes = [
      entryText(1),
      '[2026-05-01T11:00:00Z] stopped: API choice open',
      entryText(2, { remaining: 'open the PR' }),
    ].join('\n');
    const entries = splitTrail(notes);

    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((entry) => entry.stage), ['code', null, 'code']);
    assert.equal(entries[2].remaining, 'open the PR');
  });

  it('counts a Refs line as part of its entry and prints no note for it', async () => {
    const notes = entryText(1, { refs: `git-sha:${'a'.repeat(40)}, branch:feature/brief` });
    const { output } = await runFake({ bead: beadJson({ notes }) });

    assert.match(output, /^trail \(newest 1 of 1\):$/m);
    assert.doesNotMatch(output, /\(note\) Refs:/);
  });

  it('parses every field buildEntry emits as part of its entry, not as a note of its own', () => {
    const entry = buildEntry({
      at: '2026-05-01T10:00:01Z',
      stage: 'code',
      outcome: 'partial',
      evidence: 'pnpm test — 412 passing',
      remaining: 'open the PR',
      refs: { commit: 'a'.repeat(40), branch: 'feature/brief', pr: 'https://example.test/pr/11' },
      fingerprint: '0001aaaaaaaaaaaa',
    });

    // The case only proves the field set if the writer actually stamps a Refs line.
    assert.match(entry, /^Refs: git-sha:/m);
    const entries = splitTrail(entry);
    assert.equal(entries.length, 1, `the writer's fields were read as notes: ${JSON.stringify(entries.map((e) => e.text))}`);
    assert.equal(entries[0].outcome, 'partial');
    assert.equal(entries[0].evidence, 'pnpm test — 412 passing');
    assert.equal(entries[0].remaining, 'open the PR');
  });

  it('says the entries record no next step rather than that there is no trail', async () => {
    const notes = entryText(1, { outcome: 'done' }).split('\n')
      .filter((line) => !line.startsWith('What is left:'))
      .join('\n');
    const { output } = await runFake({ bead: beadJson({ notes }) });

    assert.equal(splitTrail(notes).length, 1);
    assert.doesNotMatch(output, /^next: no trail entry/m);
    assert.match(output, /^next: no entry records what is left — read the trail below$/m);
  });
});

describe('recover-brief: CLI contract', () => {
  it('exits 2 on a malformed call', async () => {
    const { code, errors } = await runFake({ argv: ['--trail', 'many'] });

    assert.equal(code, 2);
    assert.match(errors, /--trail must be an integer/);
  });

  it('requires a bead id', () => {
    assert.throws(() => parseArgs([]), /--bead is required/);
  });

  it('exits 1 when bd fails for good', async () => {
    const { code, errors } = await runFake({ failure: new Error('issue not found') });

    assert.equal(code, 1);
    assert.match(errors, /recover-brief failed: bd show bd-1\.1/);
  });

  it('prints the bead id, status and state labels first', async () => {
    const { output } = await runFake({ bead: beadJson({ notes: notesWith(1) }) });
    const lines = linesOf(output);

    assert.match(lines[0], /^bd-1\.1 {2}in_progress {2}chore {2}P2$/);
    assert.match(output, /^labels: execution:afk, stage:code$/m);
    assert.match(output, /^parent: bd-1$/m);
  });
});

// ─── Real bd ──────────────────────────────────────────────────────────────────

// The one group that talks to a real `bd`. embeddeddolt costs about a second per call, so
// the seed is skippable (RECOVER_BRIEF_REAL_BD=0 for a fast local loop) and skipped
// anywhere bd is not installed. Nothing else here touches a real bead database.
const BD_AVAILABLE = process.env.RECOVER_BRIEF_REAL_BD !== '0'
  && await execFileAsync('bd', ['version'], { encoding: 'utf-8' })
    .then(() => true)
    .catch(() => false);

describe('recover-brief against a real bd workspace', { skip: !BD_AVAILABLE }, () => {
  it('prints a bead mid-pipeline in at most 40 lines, and writes nothing', async () => {
    // A whole throwaway repository: its own .beads, its own HOME, never the real one.
    const workspace = await tempRoot.createWorkspace();
    const home = join(workspace, 'home');
    const repo = join(workspace, 'repo');
    await mkdir(home, { recursive: true });
    await mkdir(repo, { recursive: true });

    const env = { ...process.env, HOME: home, BD_NON_INTERACTIVE: '1' };

    /** Shell out with argv only. @param {string} bin @param {string[]} args @param {string} cwd */
    const run = async (bin, args, cwd) => {
      const { stdout } = await execFileAsync(bin, args, { cwd, env, encoding: 'utf-8' });
      return stdout;
    };

    await run('git', ['init', '--quiet'], repo);
    await writeFile(join(repo, 'README.md'), 'brief test\n');
    await run('git', ['add', 'README.md'], repo);
    await run('git', [
      '-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false',
      'commit', '-qm', 'init',
    ], repo);

    await run('bd', ['init', '--prefix', 'brief'], repo);
    const beadId = (await run('bd', ['create', 'Mid-pipeline bead', '--type', 'chore', '--acceptance',
      'One invocation prints what is needed.\nOutput stays under about 40 lines.', '--silent'], repo)).trim();

    // A blocker that is not closed, and one that is: only the first holds the bead back.
    const blockerId = (await run('bd', ['create', 'Decide: which upstream API?', '--type', 'task', '--silent'], repo)).trim();
    const settledId = (await run('bd', ['create', 'Settled prerequisite', '--type', 'task', '--silent'], repo)).trim();
    await run('bd', ['dep', 'add', beadId, blockerId], repo);
    await run('bd', ['dep', 'add', beadId, settledId], repo);
    await run('bd', ['close', settledId, '--reason=done'], repo);

    // The refs the writer records, through the writer itself.
    const headSha = (await run('git', ['rev-parse', 'HEAD'], repo)).trim();
    await run(process.execPath, [
      WRITER, '--bead', beadId, '--stage', 'code', '--outcome', 'partial',
      '--evidence', 'pnpm test — 412 passing', '--remaining', 'write the renderer',
      '--commit', headSha.slice(0, 7),
      '--branch', 'feature/brief',
      '--pr', 'https://example.test/pr/11',
    ], repo);

    // 19 more checkpoints, so the bead carries 20 trail entries in total.
    for (let i = 2; i <= 20; i++) {
      await run('bd', [
        'note', beadId,
        entryText(i, { evidence: `checkpoint ${i} of 20`, remaining: i === 20 ? 'open the PR' : `checkpoint ${i + 1}` }),
      ], repo);
    }

    // The stop AGENTS.md documents: a hand-written note appended after a stamped entry.
    await run('bd', ['update', beadId, '--status', 'blocked'], repo);
    await run('bd', ['note', beadId, '[2026-05-01T11:00:00Z] stopped: API choice open; decision bead filed'], repo);

    const before = JSON.parse(await run('bd', ['show', beadId, '--json'], repo))[0];
    const dumpLines = (await run('bd', ['show', beadId], repo)).trimEnd().split('\n').length;

    const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT, '--bead', beadId], {
      cwd: repo, env, encoding: 'utf-8',
    });
    const lines = linesOf(stdout);

    assert.equal(stderr, '');
    assert.ok(lines.length <= DEFAULT_MAX_LINES, `brief printed ${lines.length} lines against a ${dumpLines}-line bd show`);
    assert.ok(dumpLines > lines.length * 2, `bd show printed ${dumpLines} lines: the bound is the point`);

    // Everything needed to continue: what was done, what is blocked, what is left.
    assert.match(stdout, new RegExp(`^${beadId} {2}blocked {2}chore`));
    assert.match(stdout, /trail \(newest 3 of 21; 18 earlier not shown\):/);
    assert.match(stdout, /^ {2}\(note\) \[2026-05-01T11:00:00Z\] stopped: API choice open; decision bead filed$/m);
    assert.match(stdout, /left: open the PR/);
    assert.match(stdout, /git-sha {2}[0-9a-f]{40}/);
    assert.match(stdout, /feature\/brief/);
    assert.match(stdout, /https:\/\/example\.test\/pr\/11/);
    assert.match(stdout, new RegExp(`^blocked by 1:$`, 'm'));
    assert.match(stdout, new RegExp(`^ {2}${blockerId} {2}open`, 'm'));
    assert.doesNotMatch(stdout, new RegExp(settledId));
    assert.match(stdout, /^acceptance criteria:$/m);
    assert.match(stdout, /Output stays under about 40 lines\./);

    // Read-only, observed rather than promised: the bead's revision and trail are unmoved.
    const after = JSON.parse(await run('bd', ['show', beadId, '--json'], repo))[0];
    assert.equal(after.revision, before.revision);
    assert.equal(after.updated_at, before.updated_at);
    assert.equal(after.notes, before.notes);

    // A bead that never recorded a checkpoint says so, rather than printing an empty section.
    const freshId = (await run('bd', ['create', 'Fresh bead', '--type', 'chore', '--silent'], repo)).trim();
    const fresh = await execFileAsync(process.execPath, [SCRIPT, '--bead', freshId], {
      cwd: repo, env, encoding: 'utf-8',
    });
    assert.match(fresh.stdout, /^trail: no entries yet — this bead carries no trail$/m);
    assert.match(fresh.stdout, /^provenance: none$/m);
    assert.match(fresh.stdout, /^acceptance criteria: none recorded$/m);
    assert.match(fresh.stdout, /^next: no trail entry/m);
  });
});
// ─── Documentation ────────────────────────────────────────────────────────────

describe('the pipeline documents the read sequence beside the writer', () => {
  it('names the recovery brief in the stage SKILL, the stage runner prompt and the ralph reference', async () => {
    for (const file of [
      join(REPO_ROOT, 'skills', 'workflow', 'run-pipeline-stage', 'SKILL.md'),
      join(REPO_ROOT, 'skills', 'workflow', 'run-pipeline-stage', 'prompts', 'stage-runner.md'),
      join(REPO_ROOT, 'skills', 'workflow', 'ralph', 'REFERENCE.md'),
    ]) {
      const source = await readFile(file, 'utf-8');
      assert.match(source, /recover-brief\.mjs/, `${file} must name the recovery brief`);
    }
  });
});
