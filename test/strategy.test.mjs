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
import { REQUIRED_SECTIONS, runCli } from '../skills/workflow/prioritise-work/scripts/strategy.mjs';

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
 * @param {string} [options.changeLog]                A change-log entry; omit for no section.
 * @returns {string}
 */
function createStrategy({ version = '2', updated = '2026-11-14', answers = {}, omit = [], changeLog } = {}) {
  const sections = REQUIRED_SECTIONS.filter((title) => !omit.includes(title)).map((title) => {
    const answer = answers[title] ?? `- the answer for ${title}.`;
    return `## ${title}\n\n${answer}\n`;
  });
  const log = changeLog === undefined ? '' : `\n## Change log\n\n${changeLog}\n`;
  return `# Prioritisation strategy\n\n- **Version:** ${version}\n- **Updated:** ${updated}\n\n${sections.join('\n')}${log}`;
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

describe('the tracker', () => {
  it('is never invoked by init, validate or bump', async () => {
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
    await exec(['bump', '--reason', 'tracker check']);

    assert.equal(await readFile(marker, 'utf8'), '');
  });
});
