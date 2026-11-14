// Tests for skills/review/review-report/scripts/report.mjs — the aggregate that turns
// `defect:<class>` labels into one report, and files it only when asked to.
//
// Every case drives the module through `runCli` with an in-memory tracker, so the report a
// project sees is the thing asserted. The one subprocess case proves the CLI path itself:
// the two tracker reads reach a `bd` binary as argv arrays, and both carry `--all`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import {
  DEFECT_OWNERS,
  DEFECT_QUERY,
  parseSlug,
  readVocabulary,
  runCli,
} from '../skills/review/review-report/scripts/report.mjs';

const tempRoot = createTempRoot('review-report-');
const execFileAsync = promisify(execFile);

const testDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(testDir, '..');
const SKILLS = join(REPO_ROOT, 'skills');
const SCRIPT = join(SKILLS, 'review', 'review-report', 'scripts', 'report.mjs');

const NOW = new Date('2026-05-01T10:00:00Z');

/** A child-process call that returns stdout. @typedef {(args: string[]) => Promise<string>} Runner */

/** One bead, with only the fields this report reads.
 * @typedef {object} Bead
 * @property {string} id
 * @property {string[]} labels
 * @property {string | null} parent
 * @property {{ depends_on_id: string, type: string }[]} dependencies
 */

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Build one bead, with only the fields this report reads.
 * @param {Partial<Bead>} [overrides] @returns {Bead}
 */
function createBead(overrides = {}) {
  return { id: 'bd-1', labels: [], parent: null, dependencies: [], ...overrides };
}

/**
 * A tracker double: answers the bulk read with `beads` and the defect read with `defects`,
 * and records the argv of every call.
 * @param {{ beads?: Bead[], defects?: Bead[] }} [seed]
 * @returns {{ runner: Runner, calls: string[][] }}
 */
function createTracker({ beads = [], defects = [] } = {}) {
  /** @type {string[][]} */
  const calls = [];
  /** @type {Runner} */
  const runner = async (args) => {
    calls.push(args);
    return JSON.stringify(args.includes('--label-pattern') ? defects : beads);
  };
  return { runner, calls };
}

/**
 * A `gh` double that records only what it was called with — nothing here reaches a network.
 * @param {string} [url] @returns {{ runner: Runner, calls: string[][] }}
 */
function createGh(url = 'https://github.com/acme/widgets/issues/7\n') {
  /** @type {string[][]} */
  const calls = [];
  /** @type {Runner} */
  const runner = async (args) => {
    calls.push(args);
    return url;
  };
  return { runner, calls };
}

/** A git double that reports one remote, as a repository with an origin does.
 * @type {Runner} */
const gitWithRemote = async () => 'git@github.com:acme/widgets.git\n';

/**
 * Run a report against a tracker double and return everything the caller can observe.
 * @param {{ beads?: Bead[], defects?: Bead[], argv?: string[], gh?: { runner: Runner, calls: string[][] } | null, git?: Runner, cwd?: string }} [input]
 */
async function report({ beads = [], defects = [], argv = [], gh = null, git = gitWithRemote, cwd } = {}) {
  const tracker = createTracker({ beads, defects });
  const filer = gh ?? createGh();
  const result = await runCli(argv, {
    bd: tracker.runner,
    gh: filer.runner,
    git,
    now: NOW,
    scriptPath: SCRIPT,
    cwd: cwd ?? REPO_ROOT,
  });
  return { ...result, bdCalls: tracker.calls, ghCalls: filer.calls };
}

// ─── Vocabulary and mapping ───────────────────────────────────────────────────

describe('vocabulary', () => {
  it('reads the eight classes review-defects owns', async () => {
    const vocabulary = await readVocabulary(SCRIPT);

    assert.deepEqual(vocabulary.sort(), [
      'criteria-unmet',
      'docs-drift',
      'missing-proof',
      'regression',
      'scope-creep',
      'style-violation',
      'test-cannot-fail',
      'test-unproven',
    ]);
  });

  it('maps every class to a skill that exists on disk', async () => {
    const vocabulary = await readVocabulary(SCRIPT);
    const entries = await readdir(SKILLS, { recursive: true, withFileTypes: true });
    const skillsPresent = new Set(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );

    for (const name of vocabulary) {
      const owners = DEFECT_OWNERS[name];
      assert.ok(owners !== undefined && owners.length > 0, `${name} has no owning skill`);
      for (const owner of owners) {
        assert.ok(skillsPresent.has(owner), `${name} is mapped to ${owner}, which has no skill directory`);
      }
    }
  });

  it('counts a class the vocabulary does not name as drift, not as a class', async () => {
    const { stdout, model } = await report({
      beads: [],
      defects: [createBead({ id: 'bd-2.1', labels: ['defect:flaky-test'], parent: 'bd-2' })],
    });

    assert.deepEqual(model.defects.unknownClasses, ['flaky-test']);
    assert.equal(model.defects.labelled, 0);
    assert.match(stdout, /Unknown class in the labels: defect:flaky-test/);
  });
});

// ─── Degradation ──────────────────────────────────────────────────────────────

describe('degradation', () => {
  it('reports no defect count when no label is set', async () => {
    const { stdout, model } = await report({ beads: [createBead({ id: 'bd-1.1', labels: ['stage:review'] })] });

    assert.equal(model.defects.labelled, 0);
    assert.match(stdout, /No defect label is set on any bead, closed beads included/);
    assert.doesNotMatch(stdout, /unconfirmed defects? across/);
  });

  it('reports a snapshot and no trend for a single labelled defect', async () => {
    const { stdout } = await report({
      beads: [],
      defects: [
        createBead({ id: 'bd-3.4', labels: ['defect:criteria-unmet'], parent: 'bd-3' }),
      ],
    });

    assert.match(stdout, /1 unconfirmed defect across 1 change\./);
    assert.match(stdout, /None — no previous report was named\. This is a snapshot, not a trend\./);
    assert.match(stdout, /example: bd-3\.4/);
  });

  it('reports no review rate when no review chore is recorded', async () => {
    const { stdout, model } = await report({ beads: [createBead({ id: 'bd-1.1' })] });

    assert.equal(model.reviews.rate, null);
    assert.match(stdout, /No review stage chore is recorded in this tracker, so no rate is reported/);
  });
});

// ─── Defect counts ────────────────────────────────────────────────────────────

describe('defect counts', () => {
  it('counts every class when the whole vocabulary is labelled', async () => {
    const vocabulary = await readVocabulary(SCRIPT);
    const defects = vocabulary.map((name, index) =>
      createBead({ id: `bd-5.${index + 1}`, labels: [`defect:${name}`], parent: `bd-5.${index + 1}` }),
    );

    const { stdout, model } = await report({ beads: [], defects });

    assert.equal(Object.keys(model.defects.byClass).length, 8);
    assert.equal(model.defects.labelled, 8);
    assert.match(stdout, /Top 3 of 8 classes\./);
    assert.match(stdout, /8 unconfirmed defects across 8 changes\./);
  });

  it('names the owning skill and two examples for each class it prints', async () => {
    const { stdout } = await report({
      beads: [],
      defects: [
        createBead({ id: 'bd-6.1', labels: ['defect:test-unproven'], parent: 'bd-6' }),
        createBead({ id: 'bd-6.2', labels: ['defect:test-unproven'], parent: 'bd-6' }),
        createBead({ id: 'bd-6.3', labels: ['defect:test-unproven'], parent: 'bd-7' }),
      ],
    });

    assert.match(stdout, /1\. test-unproven {2}3 defects in 2 changes · owners: style-tests\/SKILL\.md, implement-task\/SKILL\.md/);
    assert.match(stdout, /examples: bd-6\.1, bd-6\.2/);
  });

  it('attributes a fix round to the stage its fresh chore re-runs', async () => {
    const { stdout, model } = await report({
      beads: [
        createBead({ id: 'bd-4', labels: [] }),
        createBead({ id: 'bd-4.1', labels: ['stage:review'], parent: 'bd-4' }),
        createBead({ id: 'bd-4.2', labels: ['stage:fix'], parent: 'bd-4' }),
        createBead({
          id: 'bd-4.3',
          labels: ['stage:review'],
          parent: 'bd-4',
          dependencies: [{ depends_on_id: 'bd-4.2', type: 'blocks' }],
        }),
      ],
    });

    assert.equal(model.fixRounds.byStage.review, 1);
    assert.equal(model.fixRounds.unattributed, 0);
    assert.equal(model.reviews.cohorts, 1);
    assert.equal(model.reviews.firstPass, 0);
    assert.match(stdout, /0 of 1 review cohorts passed with no fix round — 0%/);
    assert.match(stdout, /1 in total across 1 change — review 1/);
  });

  it('reports a fix round that names no stage as unattributed', async () => {
    const { stdout, model } = await report({
      beads: [createBead({ id: 'bd-8.1', labels: ['stage:fix'], parent: 'bd-8' })],
    });

    assert.equal(model.fixRounds.unattributed, 1);
    assert.match(stdout, /1 in total across 1 change — unattributed 1/);
  });
});

// ─── Change since the previous report ─────────────────────────────────────────

describe('change since the previous report', () => {
  it('records the report as the baseline when --record is passed', async () => {
    const dir = await tempRoot.createWorkspace();
    const baseline = join(dir, 'defect-report.json');

    await report({
      defects: [createBead({ id: 'bd-9.1', labels: ['defect:scope-creep'], parent: 'bd-9' })],
      argv: ['--baseline', baseline, '--record'],
    });

    const recorded = JSON.parse(await readFile(baseline, 'utf-8'));

    assert.equal(recorded.schema, 1);
    assert.equal(recorded.defects.byClass['scope-creep'].count, 1);
    assert.equal(recorded.generatedAt, '2026-05-01T10:00:00Z');
  });

  it('compares against the report kept at the baseline path', async () => {
    const dir = await tempRoot.createWorkspace();
    const baseline = join(dir, 'defect-report.json');
    await writeFile(
      baseline,
      JSON.stringify({
        schema: 1,
        generatedAt: '2026-04-01T10:00:00Z',
        defects: {
          labelled: 1,
          changes: 1,
          byClass: { 'scope-creep': { count: 1, changes: 1, beads: ['bd-1.1'] } },
          unknownClasses: [],
        },
        reviews: { cohorts: 2, firstPass: 1, rate: 0.5 },
        fixRounds: { total: 1, changes: 1, byStage: { review: 1 }, unattributed: 0 },
      }),
    );

    const { stdout } = await report({
      beads: [
        createBead({ id: 'bd-2.1', labels: ['stage:review'], parent: 'bd-2' }),
        createBead({ id: 'bd-2.2', labels: ['stage:review'], parent: 'bd-2' }),
      ],
      defects: [
        createBead({ id: 'bd-2.3', labels: ['defect:scope-creep'], parent: 'bd-2' }),
        createBead({ id: 'bd-2.4', labels: ['defect:test-unproven'], parent: 'bd-2' }),
      ],
      argv: ['--baseline', baseline],
    });

    assert.match(stdout, /test-unproven 1 \(\+1\)/);
    assert.match(stdout, /First-pass review rate 0% \(from 50%, -50 points\)/);
  });

  it('reports no trend when the baseline path holds no report', async () => {
    const dir = await tempRoot.createWorkspace();
    const baseline = join(dir, 'defect-report.json');

    const { stdout } = await report({
      defects: [createBead({ id: 'bd-10.1', labels: ['defect:regression'], parent: 'bd-10' })],
      argv: ['--baseline', baseline],
    });

    assert.match(stdout, /no report exists at .*defect-report\.json yet\. This is a snapshot, not a trend\./);
  });

  it('says there is no trend yet when the comparison holds one defect', async () => {
    const dir = await tempRoot.createWorkspace();
    const baseline = join(dir, 'defect-report.json');
    await writeFile(baseline, JSON.stringify({ schema: 1, defects: { labelled: 0, byClass: {} }, reviews: {}, fixRounds: {} }));

    const { stdout } = await report({
      defects: [createBead({ id: 'bd-11.1', labels: ['defect:missing-proof'], parent: 'bd-11' })],
      argv: ['--baseline', baseline],
    });

    assert.match(stdout, /1 labelled defect: a single data point, so there is no trend yet\./);
  });

  it('refuses a baseline file it did not write', async () => {
    const dir = await tempRoot.createWorkspace();
    const baseline = join(dir, 'defect-report.json');
    await writeFile(baseline, JSON.stringify({ schema: 99 }));

    await assert.rejects(
      report({ defects: [], argv: ['--baseline', baseline] }),
      /declares schema 99, this script writes 1/,
    );
  });

  it('refuses --record without a baseline path', async () => {
    await assert.rejects(report({ argv: ['--record'] }), /--record needs --baseline <path>/);
  });
});

// ─── Filing ───────────────────────────────────────────────────────────────────

describe('filing', () => {
  it('does not call gh unless --file is passed', async () => {
    const { ghCalls, stdout } = await report({
      defects: [createBead({ id: 'bd-12.1', labels: ['defect:docs-drift'], parent: 'bd-12' })],
    });

    assert.deepEqual(ghCalls, []);
    assert.match(stdout, /Defect report — acme\/widgets/);
  });

  it('files through gh issue create with the report as one argv element', async () => {
    const gh = createGh();
    const { ghCalls, filed, stdout } = await report({
      defects: [createBead({ id: 'bd-13.1', labels: ['defect:style-violation'], parent: 'bd-13' })],
      argv: ['--file', '--repo', 'acme/widgets'],
      gh,
    });

    assert.equal(ghCalls.length, 1);
    const [call] = ghCalls;
    assert.deepEqual(call.slice(0, 5), ['issue', 'create', '--repo', 'acme/widgets', '--title']);
    assert.equal(call[5], 'Defect report — acme/widgets — 2026-05-01T10:00:00Z');
    assert.equal(call[6], '--body');
    assert.match(call[7], /1 unconfirmed defect across 1 change\./);
    assert.equal(call.length, 8);
    assert.equal(filed, 'https://github.com/acme/widgets/issues/7');
    assert.match(stdout, /Filed: https:\/\/github\.com\/acme\/widgets\/issues\/7/);
  });

  it('files against the package manifest repository when no repo is configured', async () => {
    const { ghCalls } = await report({ defects: [], argv: ['--file'] });

    assert.equal(ghCalls[0]?.[3], 'jaybeeuu/agent-cortex');
  });

  it('normalises a repository URL from the flag to an owner/name slug', async () => {
    const { ghCalls } = await report({
      defects: [],
      argv: ['--file', '--repo', 'https://github.com/acme/widgets.git'],
    });

    assert.equal(ghCalls[0]?.[3], 'acme/widgets');
  });

  it('names a project with no git remote by its directory', async () => {
    const dir = await tempRoot.createWorkspace();
    /** @param {string[]} args */
    const gitWithoutRemote = async (args) => {
      if (args[0] === 'remote') throw new Error('no such remote origin');
      return `${dir}\n`;
    };

    const { model } = await report({ defects: [], git: gitWithoutRemote, cwd: dir });

    assert.match(model.project ?? '', /^workspace-\S+ \(no git remote\)$/);
  });
});

// ─── The query itself ─────────────────────────────────────────────────────────

describe('tracker query', () => {
  it('keeps --all on the defect read, which closed beads need', () => {
    assert.deepEqual(DEFECT_QUERY.slice(0, 4), ['list', '--label-pattern', 'defect:*', '--all']);
    assert.ok(DEFECT_QUERY.includes('--readonly'));
  });

  it('reads the tracker through the bd binary it is given, as argv arrays', async () => {
    const dir = await tempRoot.createWorkspace();
    const state = join(dir, 'state.json');
    const bin = join(dir, 'bd');
    await writeFile(
      state,
      JSON.stringify({
        calls: [],
        beads: [
          { id: 'bd-14', labels: ['execution:afk'], parent: null, dependencies: [] },
          { id: 'bd-14.1', labels: ['stage:review'], parent: 'bd-14', dependencies: [] },
        ],
        defects: [],
      }),
    );
    await writeFile(
      bin,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs/promises');",
        `const stateFile = ${JSON.stringify(state)};`,
        '(async () => {',
        '  const argv = process.argv.slice(2);',
        "  const current = JSON.parse(await fs.readFile(stateFile, 'utf8'));",
        '  current.calls.push(argv);',
        '  await fs.writeFile(stateFile, JSON.stringify(current));',
        "  const defect = argv.includes('--label-pattern');",
        "  process.stdout.write(JSON.stringify(defect ? current.defects : current.beads));",
        '})();',
      ].join('\n'),
    );
    await execFileAsync('chmod', ['755', bin]);

    const { stdout } = await execFileAsync(process.execPath, [SCRIPT], {
      env: { ...process.env, BD_PATH: bin },
      cwd: dir,
    });

    const recorded = JSON.parse(await readFile(state, 'utf-8'));
    assert.equal(recorded.calls.length, 2);
    for (const call of recorded.calls) assert.ok(call.includes('--all'));
    assert.ok(recorded.calls.some((/** @type {string[]} */ call) => call.includes('defect:*')));
    assert.match(stdout, /1 of 1 review cohorts passed with no fix round — 100%/);
    assert.match(stdout, /No defect label is set on any bead/);
  });
});
