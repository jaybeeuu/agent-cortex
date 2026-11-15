// Tests for skills/workflow/prioritise-work/scripts/strategy.mjs — the one validator and
// versioner for the prioritisation strategy file.
//
// The strategy is a file, and this script is the gate in front of it: a scorer reads the
// rubric only through a passing `validate`. The cases below drive the CLI through that
// gate — a filled file, a missing section, a broken version, a broken date, an empty
// section — then prove the two facts the design rests on: the shipped template is
// completable into a valid file, and no subcommand reaches the tracker.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import {
  DEFAULT_DEADLINE_TIERS,
  REQUIRED_SECTIONS,
  parseDeadlineTiers,
  runCli,
} from '../skills/workflow/prioritise-work/scripts/strategy.mjs';

const tempRoot = createTempRoot('strategy-');
const execFileAsync = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'skills', 'workflow', 'prioritise-work', 'scripts', 'strategy.mjs');
const DEFAULT_FILE = '.agent-cortex/working-docs/strategy.md';

/**
 * A filled strategy, built from the sections the validator requires, so each case names
 * only the value it breaks.
 * @param {object} [options]
 * @param {string} [options.version]
 * @param {string} [options.updated]
 * @param {Record<string, string>} [options.answers]  Body text per section title.
 * @param {string[]} [options.omit]                   Sections to leave out of the file.
 * @param {[string, string][]} [options.deadlineTiers]  Rows for a `## Deadline tiers` table.
 * @param {string} [options.changeLog]                A change-log entry; omit for no section.
 * @returns {string}
 */
function createStrategy({
  version = '2',
  updated = '2026-11-14',
  answers = {},
  omit = [],
  deadlineTiers,
  changeLog,
} = {}) {
  const sections = REQUIRED_SECTIONS.filter((title) => !omit.includes(title)).map((title) => {
    const answer = answers[title] ?? `- the answer for ${title}.`;
    return `## ${title}\n\n${answer}\n`;
  });
  const tiers =
    deadlineTiers === undefined
      ? ''
      : `\n## Deadline tiers\n\n| Remaining | Factor |\n|---|---|\n${deadlineTiers
          .map(([when, factor]) => `| ${when} | ${factor} |`)
          .join('\n')}\n`;
  const log = changeLog === undefined ? '' : `\n## Change log\n\n${changeLog}\n`;
  return `# Prioritisation strategy\n\n- **Version:** ${version}\n- **Updated:** ${updated}\n\n${sections.join('\n')}${tiers}${log}`;
}

/**
 * Answer every section of a template, restoring the blank line the template puts before
 * a body. An insertion lands under the heading the validator looks for, so a misspelled
 * heading leaves its section empty and fails — which is what proves the template usable.
 * @param {string} text @returns {string}
 */
function answerEverySection(text) {
  /** @type {string[]} */
  const lines = [];
  for (const line of text.split('\n')) {
    lines.push(line);
    const title = /^\s*##\s+(.*?)\s*$/.exec(line)?.[1];
    if (title !== undefined && REQUIRED_SECTIONS.includes(title)) lines.push('', `- the answer for ${title}.`);
  }
  return lines.join('\n');
}

/**
 * Run the CLI with captured sinks, so a case asserts what the caller sees.
 * @param {string[]} argv
 * @param {{ cwd?: string, today?: string }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function run(argv, { cwd, today } = {}) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const code = await runCli({
    argv,
    ...(cwd === undefined ? {} : { cwd }),
    ...(today === undefined ? {} : { today }),
    write: (chunk) => out.push(chunk),
    writeError: (chunk) => err.push(chunk),
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

/**
 * Write a strategy into a fresh workspace and return its absolute path.
 * @param {string} text @returns {Promise<string>}
 */
async function writeStrategy(text) {
  const workspace = await tempRoot.createWorkspace();
  const file = join(workspace, DEFAULT_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
  return file;
}

describe('validate', () => {
  it('prints the rubric to stdout when the file is valid', async () => {
    const text = createStrategy();
    const file = await writeStrategy(text);

    const result = await run(['validate', '--file', file]);

    assert.equal(result.code, 0);
    assert.equal(result.stdout, text);
    assert.match(result.stderr, /version 2, updated 2026-11-14, 5 required sections present/);
  });

  it('names the missing section and prints no rubric', async () => {
    const file = await writeStrategy(createStrategy({ omit: ['How to calibrate effort'] }));

    const result = await run(['validate', '--file', file]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing required section: "## How to calibrate effort"/);
    assert.equal(result.stdout, '');
  });

  it('rejects a section that carries only the template guidance', async () => {
    const file = await writeStrategy(
      createStrategy({ answers: { 'Current themes': '<!-- what are you optimising this month? -->' } }),
    );

    const result = await run(['validate', '--file', file]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /required section is empty: "## Current themes"/);
  });

  it('rejects a version that is not an integer', async () => {
    const file = await writeStrategy(createStrategy({ version: 'two' }));

    const result = await run(['validate', '--file', file]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /version must be an integer, got "two"/);
  });

  it('rejects a date that is not YYYY-MM-DD', async () => {
    const file = await writeStrategy(createStrategy({ updated: '14/11/2026' }));

    const result = await run(['validate', '--file', file]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /updated must be a calendar date \(YYYY-MM-DD\), got "14\/11\/2026"/);
  });

  // `2026-02-31` is well formed, so a shape check passes it; V8's parser rolls it into
  // 3 March, so a `Date.parse` check passes it too.
  it('rejects a well-formed date that no calendar has', async () => {
    const file = await writeStrategy(createStrategy({ updated: '2026-02-31' }));

    const result = await run(['validate', '--file', file]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /updated must be a calendar date \(YYYY-MM-DD\), got "2026-02-31"/);
  });

  it('reports every defect in one run', async () => {
    const file = await writeStrategy(createStrategy({ version: 'one', omit: ['Current themes'] }));

    const result = await run(['validate', '--file', file]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /version must be an integer/);
    assert.match(result.stderr, /missing required section: "## Current themes"/);
  });
});

describe('init', () => {
  it('writes a template that a filled interview turns into a valid strategy', async () => {
    const workspace = await tempRoot.createWorkspace();

    const init = await run(['init'], { cwd: workspace, today: '2026-11-14' });
    assert.equal(init.code, 0);

    const file = join(workspace, DEFAULT_FILE);
    const template = await readFile(file, 'utf8');
    const unanswered = await run(['validate'], { cwd: workspace });
    assert.equal(unanswered.code, 1, 'a copied but unanswered template must not pass');

    await writeFile(file, answerEverySection(template), 'utf8');
    const filled = await run(['validate'], { cwd: workspace });

    assert.equal(filled.code, 0);
    assert.match(filled.stderr, /version 1, updated 2026-11-14/);
  });

  it('stamps the date it was given and refuses to overwrite the file', async () => {
    const workspace = await tempRoot.createWorkspace();

    await run(['init'], { cwd: workspace, today: '2026-12-01' });
    const file = join(workspace, DEFAULT_FILE);
    assert.match(await readFile(file, 'utf8'), /- \*\*Updated:\*\* 2026-12-01/);

    await writeFile(file, createStrategy({ version: '7' }), 'utf8');

    const second = await run(['init'], { cwd: workspace, today: '2026-12-02' });

    assert.equal(second.code, 1);
    assert.match(second.stderr, /already exists/);
    assert.equal(await readFile(file, 'utf8'), createStrategy({ version: '7' }));
  });

  it('refuses a --today that no calendar has, and writes nothing', async () => {
    const workspace = await tempRoot.createWorkspace();

    const init = await run(['init', '--today', '2026-02-31'], { cwd: workspace });

    assert.equal(init.code, 2);
    assert.match(init.stderr, /--today must be a calendar date \(YYYY-MM-DD\), got "2026-02-31"/);
    assert.deepEqual(await readdir(workspace), []);
  });

  it('accepts a leap day and a month end as --today', async () => {
    const leapWorkspace = await tempRoot.createWorkspace();
    const monthEndWorkspace = await tempRoot.createWorkspace();

    const leap = await run(['init', '--today', '2024-02-29'], { cwd: leapWorkspace });
    const monthEnd = await run(['init', '--today', '2026-04-30'], { cwd: monthEndWorkspace });

    assert.equal(leap.code, 0);
    assert.match(await readFile(join(leapWorkspace, DEFAULT_FILE), 'utf8'), /- \*\*Updated:\*\* 2024-02-29/);
    assert.equal(monthEnd.code, 0);
    assert.match(await readFile(join(monthEndWorkspace, DEFAULT_FILE), 'utf8'), /- \*\*Updated:\*\* 2026-04-30/);
  });

  it('writes the default path at the repository root when run from a subdirectory', async () => {
    const repository = await tempRoot.createWorkspace();
    await mkdir(join(repository, '.git'), { recursive: true });
    const subdirectory = join(repository, 'packages', 'app');
    await mkdir(subdirectory, { recursive: true });

    const init = await run(['init'], { cwd: subdirectory, today: '2026-11-14' });

    assert.equal(init.code, 0);
    assert.match(await readFile(join(repository, DEFAULT_FILE), 'utf8'), /- \*\*Updated:\*\* 2026-11-14/);
    assert.deepEqual(await readdir(subdirectory), [], 'a second strategy must not appear beside the caller');
  });

  it('falls back to the cwd when no ancestor is a repository', async () => {
    const workspace = await tempRoot.createWorkspace();

    const init = await run(['init'], { cwd: workspace, today: '2026-11-14' });

    assert.equal(init.code, 0);
    assert.match(await readFile(join(workspace, DEFAULT_FILE), 'utf8'), /- \*\*Updated:\*\* 2026-11-14/);
  });
});

describe('summary', () => {
  /** A strategy whose sections carry the bullets a digest has to quote, and a change log. */
  const FILLED = {
    version: '3',
    updated: '2026-12-01',
    answers: {
      'Current themes': '- shorter review turnaround\n- fewer manual release steps',
      'What counts as value': '- unblocks a human gate\n- removes a manual step',
      'Explicitly out of scope': '- new integrations\n- UI polish that changes no outcome',
    },
    changeLog: '- 2026-11-14 v2: the rubric as it stands.\n- 2026-12-01 v3: review speed is the theme now',
  };

  /**
   * The shipped tier table, written the way the template writes it.
   * @type {[string, string][]}
   */
  const TIER_TABLE = [
    ['within 1d', '4'],
    ['within 2d', '2'],
    ['within 7d', '1.5'],
    ['more than 7d', '1'],
    ['overdue', '8'],
  ];

  it('summarises an existing strategy: the path, the version, the themes, the admissibility lists and the last change', async () => {
    const file = await writeStrategy(createStrategy(FILLED));

    const result = await run(['summary', '--file', file]);

    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes(`${file} — strategy v3`), `the digest must cite the file it read: ${result.stdout}`);
    assert.match(result.stdout, /last change: 2026-12-01 v3: review speed is the theme now/);
    assert.match(result.stdout, /themes: shorter review turnaround · fewer manual release steps/);
    assert.match(result.stdout, /admissibility — what counts as value: unblocks a human gate · removes a manual step/);
    assert.match(result.stdout, /admissibility — out of scope: new integrations · UI polish that changes no outcome/);
    assert.doesNotMatch(result.stdout, /precedence/, 'these lists admit or rule out a bead; nothing here ranks one');
  });

  it('summarises the deadline tiers in the order the queue applies them', async () => {
    const file = await writeStrategy(createStrategy({ ...FILLED, deadlineTiers: TIER_TABLE }));

    const result = await run(['summary', '--file', file]);

    assert.equal(result.code, 0);
    assert.match(
      result.stdout,
      /deadline factors: within 1d ×4 · within 2d ×2 · within 7d ×1.5 · more than 7d ×1 · overdue ×8/,
      `the tiers print narrowest first, with their factors: ${result.stdout}`,
    );
    assert.equal(result.stdout.trimEnd().split('\n').length, 6, 'the deadline line joins the five');
  });

  it('says nothing about deadlines when the strategy states no tier table', async () => {
    const file = await writeStrategy(createStrategy(FILLED));

    const result = await run(['summary', '--file', file]);

    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /deadline/i, 'no table means no line, never an empty one');
    assert.equal(result.stdout.trimEnd().split('\n').length, 5);
  });

  it('prints a handful of lines, not a re-print of the file', async () => {
    const many = Array.from({ length: 6 }, (_, index) => `- rule number ${index + 1}`).join('\n');
    const file = await writeStrategy(createStrategy({ ...FILLED, answers: { ...FILLED.answers, 'Current themes': many } }));

    const result = await run(['summary', '--file', file]);

    assert.equal(result.code, 0);
    assert.equal(result.stdout.trimEnd().split('\n').length, 5, 'five lines, or six with a tier table, however long the file is');
    assert.match(result.stdout, /rule number 1 · rule number 2 · \(\+4 more in the file\)/);
    assert.doesNotMatch(result.stdout, /## /, 'the digest must not re-print the headings it read');
  });

  it('says there is no strategy instead of printing an empty digest', async () => {
    const workspace = await tempRoot.createWorkspace();
    const file = join(workspace, DEFAULT_FILE);

    const result = await run(['summary', '--file', file]);

    assert.equal(result.code, 3);
    assert.equal(result.stdout, '', 'a first run must print no digest at all');
    assert.equal(result.stderr, `${file} does not exist — run "init" and interview the owner, or pass --file <path>\n`);
  });

  it('names the empty section rather than presenting the file as current', async () => {
    const file = await writeStrategy(createStrategy({ ...FILLED, answers: { ...FILLED.answers, 'Current themes': '<!-- still the guidance -->' } }));

    const result = await run(['summary', '--file', file]);

    assert.equal(result.code, 1);
    assert.equal(result.stdout, '', 'an invalid strategy must never be summarised');
    assert.match(result.stderr, /is not a valid strategy:/);
    assert.match(result.stderr, /required section is empty: "## Current themes"/);
  });

  it('names a version the change log disagrees with', async () => {
    const file = await writeStrategy(
      createStrategy({ ...FILLED, version: '4', changeLog: '- 2026-12-01 v3: review speed is the theme now' }),
    );

    const result = await run(['summary', '--file', file]);

    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /the newest "## Change log" entry names v3 but the version is v4/);
  });

  it('reads the file it summarises, so it cannot describe a strategy that is not on disk', async () => {
    const file = await writeStrategy(createStrategy(FILLED));

    await writeFile(
      file,
      createStrategy({
        ...FILLED,
        answers: { ...FILLED.answers, 'Current themes': '- a cold start under a minute' },
        changeLog: '- 2026-12-01 v3: cold starts matter more than review now',
      }),
      'utf8',
    );

    const result = await run(['summary', '--file', file]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /themes: a cold start under a minute/);
    assert.match(result.stdout, /last change: 2026-12-01 v3: cold starts matter more than review now/);
    assert.doesNotMatch(result.stdout, /review turnaround|review speed/);
  });

  it('says no reason is on file when the strategy carries no change-log entry', async () => {
    const file = await writeStrategy(createStrategy({ ...FILLED, changeLog: undefined }));

    const result = await run(['summary', '--file', file]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /last change: 2026-12-01 — no change-log entry, so no reason is on file/);
  });
});

describe('bump', () => {
  /** The reason every bump in this block records, so a case names only what it varies. */
  const REASON = 'review speed is the theme now';

  it('raises the version by one and records the date', async () => {
    const file = await writeStrategy(createStrategy({ version: '2', updated: '2026-11-14' }));

    const bump = await run(['bump', '--file', file, '--reason', REASON], { today: '2026-12-01' });

    assert.equal(bump.code, 0);
    assert.match(bump.stderr, /version 2 → 3, updated 2026-12-01/);
    const check = await run(['validate', '--file', file]);
    assert.match(check.stderr, /version 3, updated 2026-12-01/);
  });

  it('refuses an invalid strategy and leaves the file untouched', async () => {
    const broken = createStrategy({ version: 'two' });
    const file = await writeStrategy(broken);

    const bump = await run(['bump', '--file', file, '--reason', REASON], { today: '2026-12-01' });

    assert.equal(bump.code, 1);
    assert.match(bump.stderr, /refusing to bump an invalid strategy/);
    assert.equal(await readFile(file, 'utf8'), broken);
  });

  it('refuses to bump without a reason, leaving the version where it was', async () => {
    const file = await writeStrategy(createStrategy({ version: '2' }));

    const bump = await run(['bump', '--file', file], { today: '2026-12-01' });

    assert.equal(bump.code, 2);
    assert.match(bump.stderr, /"bump" needs --reason/);
    assert.match(await readFile(file, 'utf8'), /- \*\*Version:\*\* 2/);
  });
});

describe('the change log', () => {
  it('appends one line naming the new version and the reason, and validates', async () => {
    const file = await writeStrategy(
      createStrategy({ version: '2', changeLog: '- 2026-11-14 v2: the rubric as it stands.' }),
    );

    const bump = await run(['bump', '--file', file, '--reason', 'review speed is the theme now'], {
      today: '2026-12-01',
    });

    assert.equal(bump.code, 0);
    assert.match(bump.stderr, /change log: - 2026-12-01 v3: review speed is the theme now/);
    const text = await readFile(file, 'utf8');
    assert.match(text, /- 2026-11-14 v2: the rubric as it stands\.\n- 2026-12-01 v3: review speed is the theme now\n/);
    assert.equal((await run(['validate', '--file', file])).code, 0);
  });

  it('adds the section to a file that has none', async () => {
    const file = await writeStrategy(createStrategy({ version: '2' }));

    await run(['bump', '--file', file, '--reason', 'first recorded change'], { today: '2026-12-01' });

    assert.match(await readFile(file, 'utf8'), /## Change log\n\n- 2026-12-01 v3: first recorded change\n$/);
  });

  it('passes validation with a change log emptied of every entry at v2', async () => {
    const file = await writeStrategy(
      createStrategy({ version: '2', changeLog: '<!-- oldest first, one line per bump -->' }),
    );

    const check = await run(['validate', '--file', file]);

    assert.equal(check.code, 0);
    assert.match(check.stderr, /version 2/);
  });

  it('passes validation with no change-log section at v2', async () => {
    const file = await writeStrategy(createStrategy({ version: '2' }));

    const check = await run(['validate', '--file', file]);

    assert.equal(check.code, 0);
    assert.match(check.stderr, /version 2/);
  });

  it('fails validation when the newest line names a version the header does not', async () => {
    const file = await writeStrategy(createStrategy({ version: '3', changeLog: '- 2026-11-14 v2: not bumped.' }));

    const check = await run(['validate', '--file', file]);

    assert.equal(check.code, 1);
    assert.match(check.stderr, /names v2 but the version is v3/);
  });

  it('accepts a file whose change log names the version it carries', async () => {
    const file = await writeStrategy(createStrategy({ version: '3', changeLog: '- 2026-11-14 v3: the rubric as it stands.' }));

    assert.equal((await run(['validate', '--file', file])).code, 0);
  });

  it('separates the first entry from the template guidance comment above it', async () => {
    const workspace = await tempRoot.createWorkspace();
    const file = join(workspace, 'strategy.md');

    await run(['init', '--file', file]);
    await writeFile(file, answerEverySection(await readFile(file, 'utf8')), 'utf8');
    await run(['bump', '--file', file, '--reason', 'first recorded change'], { today: '2026-12-01' });

    assert.match(await readFile(file, 'utf8'), /-->\n\n- 2026-12-01 v2: first recorded change\n$/);
  });
});

describe('the deadline tiers', () => {
  /** A strategy section carrying one table, in the order the rows are written. */
  /** @param {[string, string][]} rows @returns {string} */
  const table = (rows) =>
    `## Deadline tiers\n\n| Remaining | Factor |\n|---|---|\n${rows.map(([when, factor]) => `| ${when} | ${factor} |`).join('\n')}\n`;

  it('uses the documented default when the strategy carries no table', () => {
    const parsed = parseDeadlineTiers(createStrategy());

    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.tiers, DEFAULT_DEADLINE_TIERS);
  });

  it('reads the shipped table and orders its within rows narrowest first', () => {
    const parsed = parseDeadlineTiers(
      table([
        ['within 7d', '1.5'],
        ['overdue', '8'],
        ['within 1d', '4'],
        ['more than 7d', '1'],
        ['within 2d', '2'],
      ]),
    );

    assert.equal(parsed.ok, true, parsed.errors.join('; '));
    assert.deepEqual(parsed.tiers, DEFAULT_DEADLINE_TIERS);
  });

  it('names a row it cannot read instead of falling back in silence', () => {
    const parsed = parseDeadlineTiers(
      table([
        ['soonish', '4'],
        ['within 2d', '2'],
        ['within 7d', '1.5'],
        ['more than 7d', '1'],
        ['overdue', '8'],
      ]),
    );

    assert.equal(parsed.ok, false);
    assert.match(parsed.errors.join('\n'), /"soonish" is not "overdue", "within <time>" or "more than <time>"/);
  });

  it('names a table that is missing a kind or repeats one', () => {
    const noOverdue = parseDeadlineTiers(
      table([['within 1d', '4'], ['within 7d', '1.5'], ['more than 7d', '1']]),
    );
    assert.equal(noOverdue.ok, false);
    assert.match(noOverdue.errors.join('\n'), /needs exactly one "overdue" row, found 0/);

    const twoOverdue = parseDeadlineTiers(
      table([['within 1d', '4'], ['more than 7d', '1'], ['overdue', '8'], ['overdue', '2']]),
    );
    assert.equal(twoOverdue.ok, false);
    assert.match(twoOverdue.errors.join('\n'), /needs exactly one "overdue" row, found 2/);
  });

  it('fails validate with the tier defect, so a scorer never reads a table it cannot parse', async () => {
    const file = await writeStrategy(
      `${createStrategy()}\n${table([
        ['soonish', '4'],
        ['within 2d', '2'],
        ['within 7d', '1.5'],
        ['more than 7d', '1'],
        ['overdue', '8'],
      ])}`,
    );

    const check = await run(['validate', '--file', file]);

    assert.equal(check.code, 1);
    assert.match(check.stderr, /Deadline tiers: row "\| soonish \| 4 \|"/);
  });

  it('ships a template whose table is the documented default', async () => {
    const template = await readFile(
      join(REPO_ROOT, 'skills', 'workflow', 'prioritise-work', 'templates', 'strategy.md'),
      'utf8',
    );

    const parsed = parseDeadlineTiers(template);

    assert.equal(parsed.ok, true, parsed.errors.join('; '));
    assert.deepEqual(parsed.tiers, DEFAULT_DEADLINE_TIERS);
  });
});

describe('the tracker', () => {
  it('is never invoked by init, validate, bump or summary', async () => {
    const workspace = await tempRoot.createWorkspace();
    const stubDir = join(workspace, 'bin');
    const marker = join(workspace, 'bd-called.log');
    await mkdir(stubDir, { recursive: true });
    await writeFile(join(stubDir, 'bd'), `#!/bin/sh\necho "$@" >> ${marker}\n`, 'utf8');
    await chmod(join(stubDir, 'bd'), 0o755);

    const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ''}` };
    const exec = (/** @type {string[]} */ args) =>
      execFileAsync(process.execPath, [SCRIPT, ...args], { cwd: workspace, env });

    // Prove the stub fires before relying on its silence: a stub that cannot run would
    // make the real assertion vacuous.
    await execFileAsync(join(stubDir, 'bd'), ['ready'], { cwd: workspace, env });
    assert.equal(await readFile(marker, 'utf8'), 'ready\n');
    await writeFile(marker, '', 'utf8');

    await exec(['init']);
    const file = join(workspace, DEFAULT_FILE);
    await writeFile(file, answerEverySection(await readFile(file, 'utf8')), 'utf8');
    await exec(['validate']);
    await exec(['summary']);
    await exec(['bump', '--reason', 'tracker check']);

    assert.equal(await readFile(marker, 'utf8'), '');
  });
});
