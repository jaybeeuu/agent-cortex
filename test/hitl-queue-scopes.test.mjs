// Tests for the scope-aware HITL queue — skills/workflow/hitl-queue/scripts/scopes.mjs and
// the parts of queue.mjs that read more than one workspace.
//
// The design rests on facts this file drives directly: every configured scope contributes
// its own rows, each tagged with its scope; a missing or uninitialised workspace is reported
// unavailable and the rest of the queue still answers; one workspace is writable and every
// other one receives nothing but the two read calls the queue issues; the daily note sits
// above the ranked list and quotes the strategy line it came from; and a shared invocation
// neither reads nor prints personal work.
//
// The tracker is an in-memory `bd` keyed by scope, and the one CLI test runs the real script
// against a stub binary, so the argv it issues is the argv the guard is tested with. No test
// reads the machine's own tracker or its user-level scope list.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import { fakeBdByScope } from './helpers/fake-bd-queue.mjs';
import { REQUIRED_SECTIONS } from '../skills/workflow/prioritise-work/scripts/strategy.mjs';
import { buildQueue, renderQueue } from '../skills/workflow/hitl-queue/scripts/queue.mjs';
import {
  ScopeError,
  ScopeWriteError,
  guardRunner,
  isReadCall,
  parseScopeList,
  readDailyNote,
  readScopeConfig,
} from '../skills/workflow/hitl-queue/scripts/scopes.mjs';

const tempRoot = createTempRoot('hitl-queue-scopes-');
const execFileAsync = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'skills', 'workflow', 'hitl-queue', 'scripts', 'queue.mjs');
const HELPER = join(REPO_ROOT, 'test', 'helpers', 'fake-bd-queue.mjs');
const DAILY_LINE = 'daily: personal, code — Monday and Tuesday are the personal objectives';

// The scope list falls back to the user-level file, so point that at the temp root: the
// suite must never read, or depend on, the machine's own ~/.agent-cortex.
process.env.AGENT_CORTEX_HOME = await tempRoot.createWorkspace();

/** A stored `rice` record, as `score-bead score` writes it. */
function rice(score = 4.2) {
  return {
    reach: 4,
    impact: 3,
    confidence: 0.7,
    effort: 2,
    score,
    strategyVersion: 2,
    assessedAt: '2026-11-14T09:00:00.000Z',
    rationale: 'scope test',
  };
}

/**
 * A workspace: a directory marked as a bd workspace, so the queue reads it as a scope.
 * @param {object} [options]
 * @param {boolean} [options.initialised]  Write the `.beads` marker (default: yes).
 * @param {boolean} [options.repository]   Write a `.git` entry, making it a repo root.
 * @param {string} [options.daily]         A daily line to put in the strategy.
 * @param {number} [options.strategyVersion]
 * @returns {Promise<string>}
 */
async function makeWorkspace({ initialised = true, repository = false, daily, strategyVersion = 3 } = {}) {
  const workspace = await tempRoot.createWorkspace();
  if (initialised) await mkdir(join(workspace, '.beads'), { recursive: true });
  if (repository) await mkdir(join(workspace, '.git'), { recursive: true });
  if (daily !== undefined) await writeStrategy(workspace, { daily, version: strategyVersion });
  return workspace;
}

/**
 * Write a valid strategy into a workspace, optionally carrying a daily line.
 * @param {string} workspace @param {object} [options]
 * @param {string} [options.daily] @param {number} [options.version]
 * @returns {Promise<string>} the strategy path
 */
async function writeStrategy(workspace, { daily, version = 3 } = {}) {
  const sections = REQUIRED_SECTIONS.map((title) => {
    const body = title === 'Current themes' && daily !== undefined ? `- ${daily}\n` : `- the answer for ${title}.\n`;
    return `## ${title}\n\n${body}\n`;
  });
  const file = join(workspace, '.agent-cortex', 'working-docs', 'strategy.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `# Prioritisation strategy\n\n- **Version:** ${version}\n- **Updated:** 2026-11-14\n\n${sections.join('\n')}`,
    'utf8',
  );
  return file;
}

/**
 * Write a scope list into a workspace, returning its path.
 * @param {string} workspace @param {object[]} scopes @returns {Promise<string>}
 */
async function writeScopes(workspace, scopes) {
  const file = join(workspace, 'scopes.json');
  await writeFile(file, JSON.stringify({ scopes }, null, 2), 'utf8');
  return file;
}

/** A `bd` that records every call it is asked to answer, per scope.
 * @param {Record<string, import('./helpers/fake-bd-queue.mjs').GraphBead[]>} graphs */
function recordingBd(graphs) {
  const inner = fakeBdByScope(graphs);
  /** @type {{ scope: string, args: string[] }[]} */
  const calls = [];
  return {
    calls,
    /** @param {string[]} args @param {{ name: string }} scope */
    bd: async (args, scope) => {
      calls.push({ scope: scope.name, args });
      return await inner(args, scope);
    },
    /** @param {string} name */
    for: (name) => calls.filter((call) => call.scope === name).map((call) => call.args),
  };
}

/** The row for one bead in one scope, or a failure naming what the queue did return.
 * @param {Awaited<ReturnType<typeof buildQueue>>} report @param {string} scope @param {string} id */
function rowFor(report, scope, id) {
  const row = report.rows.find((candidate) => candidate.scope === scope && candidate.id === id);
  assert.ok(
    row !== undefined,
    `the queue does not list ${scope}:${id}; it lists ` +
      report.rows.map((each) => `${each.scope}:${each.id}`).join(', '),
  );
  return row;
}

/**
 * Three scopes as a person would configure them: the code workspace the run is in, a
 * personal one, and an ops one.
 * @param {object} [options]
 * @param {string} [options.daily]         A daily line for the personal strategy, when given.
 * @param {boolean} [options.initialised]  Mark the personal workspace as a bd workspace.
 */
async function threeScopes({ daily = DAILY_LINE, initialised = true } = {}) {
  const code = await makeWorkspace({ repository: true });
  const personal = await makeWorkspace({ daily, initialised });
  const ops = await makeWorkspace();
  const scopesFile = await writeScopes(code, [
    { name: 'code', path: code, kind: 'code', readOnly: false },
    { name: 'personal', path: personal, kind: 'personal', readOnly: true },
    { name: 'ops', path: ops, kind: 'ops', readOnly: true },
  ]);
  const recorder = recordingBd({
    code: [{ id: 'c-1', title: 'Ship the queue', labels: ['execution:hitl'], rice: rice() }],
    personal: [{ id: 'p-1', title: 'Write the objectives', labels: ['execution:hitl'], rice: rice(2) }],
    ops: [{ id: 'o-1', title: 'Renew the certificate', labels: ['execution:hitl'], rice: rice(1) }],
  });
  return { code, personal, ops, scopesFile, recorder };
}

describe('reading several scopes', () => {
  it('lists rows from all three configured scopes, each tagged with its scope', async () => {
    const { code, scopesFile, recorder } = await threeScopes();

    const report = await buildQueue({ bd: recorder.bd, cwd: code, scopesFile });

    assert.deepEqual(
      report.scopes.map((scope) => `${scope.name}:${scope.status}`),
      ['code:available', 'personal:available', 'ops:available'],
    );
    assert.deepEqual(
      report.rows.map((row) => `${row.scope}:${row.id}`),
      ['code:c-1', 'personal:p-1', 'ops:o-1'],
    );

    const text = renderQueue(report);
    assert.match(text, /· 3 scopes ·/);
    assert.match(text, /^1 {2}code {6}c-1 /m);
    assert.match(text, /^2 {2}personal {2}p-1 /m);
    assert.match(text, /^3 {2}ops {7}o-1 /m);
  });

  it('marks a scope writable only when it is the current workspace, whatever the file says', async () => {
    const { code, scopesFile } = await threeScopes();
    // A list that marks every scope writable: the derivation still leaves one.
    await writeScopes(code, [
      { name: 'code', path: code, kind: 'code', readOnly: false },
      { name: 'personal', path: code, kind: 'personal', readOnly: false },
    ]);
    const { scopes } = await readScopeConfig({ file: scopesFile, cwd: code });

    assert.deepEqual(
      scopes.map((scope) => `${scope.name}:${scope.writable}`),
      ['code:true', 'personal:true'],
    );

    const { code: other } = await threeScopes();
    const widened = await writeScopes(other, [
      { name: 'code', path: other, kind: 'code', readOnly: false },
      { name: 'personal', path: await makeWorkspace(), kind: 'personal', readOnly: false },
    ]);
    const readBack = await readScopeConfig({ file: widened, cwd: other });
    assert.deepEqual(
      readBack.scopes.map((scope) => `${scope.name}:${scope.writable}`),
      ['code:true', 'personal:false'],
    );
  });

  it('reports a missing scope unavailable and still answers from the others, exit 0', async () => {
    const { code, scopesFile, recorder } = await threeScopes();
    const absent = join(code, 'no-such-workspace');
    await writeScopes(code, [
      { name: 'code', path: code, kind: 'code', readOnly: false },
      { name: 'notes', path: absent, kind: 'personal', readOnly: true },
    ]);

    const report = await buildQueue({ bd: recorder.bd, cwd: code, scopesFile });

    assert.deepEqual(report.rows.map((row) => `${row.scope}:${row.id}`), ['code:c-1']);
    const missing = report.scopes.find((scope) => scope.name === 'notes');
    assert.equal(missing?.status, 'unavailable');
    assert.equal(missing?.reason, 'workspace does not exist');
    assert.equal(report.counts.unavailableScopes, 1);

    const text = renderQueue(report);
    assert.match(text, /unavailable: notes \(.*no-such-workspace\) — workspace does not exist/);
    assert.match(text, /· 2 scopes, 1 unavailable ·/);
    // The absent scope never reached the tracker at all.
    assert.deepEqual(recorder.for('notes'), []);
  });

  it('reports a directory with no .beads of its own unavailable, so it cannot borrow a parent workspace', async () => {
    const code = await makeWorkspace({ repository: true });
    const nested = join(code, 'nested');
    await mkdir(nested, { recursive: true });
    const scopesFile = await writeScopes(code, [
      { name: 'code', path: code, kind: 'code', readOnly: false },
      { name: 'nested', path: nested, kind: 'ops', readOnly: true },
    ]);
    const recorder = recordingBd({
      code: [{ id: 'c-1', title: 'Ship the queue', labels: ['execution:hitl'], rice: rice() }],
    });

    const report = await buildQueue({ bd: recorder.bd, cwd: code, scopesFile });

    assert.equal(report.scopes.find((scope) => scope.name === 'nested')?.reason, 'no .beads workspace here, so it is not initialised');
    assert.deepEqual(report.rows.map((row) => row.scope), ['code']);
    assert.deepEqual(recorder.for('nested'), []);
  });

  it('reads one implicit writable scope named code when no list is configured', async () => {
    const workspace = await makeWorkspace();
    const { configured, scopes } = await readScopeConfig({ cwd: workspace });

    assert.equal(configured, false);
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0].name, 'code');
    assert.equal(scopes[0].kind, 'code');
    assert.equal(scopes[0].writable, true);
  });

  it('finds the committed scope list at the repository root without being told', async () => {
    const code = await makeWorkspace({ repository: true });
    const personal = await makeWorkspace();
    const configFile = join(code, '.agent-cortex', 'scopes.json');
    await mkdir(dirname(configFile), { recursive: true });
    await writeFile(
      configFile,
      JSON.stringify({
        scopes: [
          { name: 'code', path: '.', kind: 'code', readOnly: false },
          { name: 'personal', path: personal, kind: 'personal' },
        ],
      }),
      'utf8',
    );
    const subdirectory = join(code, 'src');
    await mkdir(subdirectory, { recursive: true });

    const { file, scopes } = await readScopeConfig({ cwd: subdirectory });

    assert.equal(file, configFile);
    assert.deepEqual(
      scopes.map((scope) => `${scope.name}:${scope.kind}:${scope.writable}`),
      ['code:code:true', 'personal:personal:false'],
    );
    // `"."` meant the repository root, not the subdirectory the run started in.
    assert.equal(scopes[0].path, await realpath(code));
  });

  it('refuses a malformed scope list rather than reading the wrong workspaces', async () => {
    const workspace = await makeWorkspace();

    await assert.rejects(
      parseScopeList(JSON.stringify({ scopes: [{ name: 'a', path: '.', kind: 'code' }, { name: 'a', path: '.' }] }), {
        file: 'scopes.json',
        base: workspace,
        cwd: workspace,
      }),
      (error) => error instanceof ScopeError && /names the scope "a" twice/.test(error.message),
    );
    await assert.rejects(
      parseScopeList(JSON.stringify({ scopes: [{ name: 'a', path: '.', kind: 'chores' }] }), {
        file: 'scopes.json',
        base: workspace,
        cwd: workspace,
      }),
      (error) => error instanceof ScopeError && /use one of code, personal, ops/.test(error.message),
    );
  });
});

describe('the writable boundary', () => {
  it('records only read calls for a read-only scope', async () => {
    const { code, scopesFile, recorder } = await threeScopes();

    await buildQueue({ bd: recorder.bd, cwd: code, scopesFile });

    // The personal scope was read, so the assertion below is not vacuous.
    assert.ok(recorder.for('personal').length > 0, 'the personal scope was never read');
    const writes = ['personal', 'ops'].flatMap((name) => recorder.for(name)).filter((args) => !isReadCall(args));
    assert.deepEqual(writes, []);
  });

  it('refuses a write call against a read-only scope', async () => {
    const { code, scopesFile } = await threeScopes();
    const { scopes } = await readScopeConfig({ file: scopesFile, cwd: code });
    const personal = /** @type {import('../skills/workflow/hitl-queue/scripts/scopes.mjs').Scope} */ (
      scopes.find((scope) => scope.name === 'personal')
    );
    const untouched = recordingBd({ personal: [] });
    const guarded = guardRunner(personal, untouched.bd);

    await assert.rejects(
      guarded(['create', 'A personal bead', '-t', 'task']),
      (error) => error instanceof ScopeWriteError && /the scope is read-only/.test(error.message),
    );
    // The refusal happens before the tracker is asked, so nothing reached the workspace.
    assert.deepEqual(untouched.calls, []);

    // The read the queue does issue passes the same guard.
    assert.deepEqual(await guarded(['list', '-l', 'execution:hitl', '--json']), '[]');
  });
});

describe('the daily scope note', () => {
  it('sits above the ranked list and quotes the strategy line it came from', async () => {
    const { code, scopesFile, recorder } = await threeScopes();

    const report = await buildQueue({ bd: recorder.bd, cwd: code, scopesFile });
    const text = renderQueue(report);
    const lines = text.split('\n');

    const todayAt = lines.findIndex((line) => line.startsWith('today · '));
    const firstRowAt = lines.findIndex((line) => /^\d/.test(line));
    assert.ok(todayAt !== -1, `no daily note in:\n${text}`);
    assert.ok(todayAt < firstRowAt, 'the daily note is below the list');

    assert.match(lines[todayAt], /^today · personal, code — "daily: personal, code — Monday and Tuesday are the personal objectives"/);
    assert.match(lines[todayAt], /\(strategy v3, "## Current themes", scope personal\)$/);
    assert.equal(report.today.line, DAILY_LINE);
  });

  it('says why there is no note when no personal scope is configured', async () => {
    const workspace = await makeWorkspace();
    const note = await readDailyNote([
      { name: 'code', path: workspace, kind: 'code', readOnly: false, current: true, writable: true },
    ]);

    assert.match(/** @type {string} */ (note.reason), /no personal scope is configured/);
  });

  it('says what to add when the personal strategy carries no daily line', async () => {
    const workspace = await makeWorkspace();
    const note = await readDailyNote([
      { name: 'notes', path: workspace, kind: 'personal', readOnly: true, current: false, writable: false },
    ]);

    assert.match(/** @type {string} */ (note.reason), /no "daily:" line in the strategy of "notes"/);
    assert.match(/** @type {string} */ (note.reason), /- daily: <scope>, <scope> — <why>/);
  });
});

describe('the privacy boundary', () => {
  it('withholds personal rows and the personal strategy from a shared invocation', async () => {
    const { code, scopesFile, recorder } = await threeScopes();

    const report = await buildQueue({ bd: recorder.bd, cwd: code, scopesFile, shared: true });

    assert.equal(report.invocation, 'shared');
    assert.deepEqual(report.rows.map((row) => row.scope), ['code', 'ops']);
    assert.equal(report.scopes.find((scope) => scope.name === 'personal')?.status, 'withheld');
    // Nothing personal is read, so nothing personal can be copied anywhere.
    assert.deepEqual(recorder.for('personal'), []);

    const text = renderQueue(report);
    assert.match(text, /· 3 scopes, 1 withheld ·/);
    assert.match(text, /today · withheld \(shared invocation\)/);
    assert.doesNotMatch(text, /Write the objectives|Monday and Tuesday are the personal objectives|daily:/);
  });

  it('prints the personal rows in a local invocation, which is the only place they appear', async () => {
    const { code, scopesFile, recorder } = await threeScopes();

    const local = await buildQueue({ bd: recorder.bd, cwd: code, scopesFile });

    assert.equal(local.invocation, 'local');
    assert.ok(local.rows.some((row) => row.scope === 'personal'));
  });
});

describe('the command line over several scopes', () => {
  /**
   * A stub `bd` that answers from the graph belonging to the directory it was run in, the
   * way a real tracker answers from the workspace it resolves.
   * @param {string} workspace @param {Record<string, import('./helpers/fake-bd-queue.mjs').GraphBead[]>} graphs
   */
  async function makeStubBd(workspace, graphs) {
    const binDir = join(workspace, 'bin');
    await mkdir(binDir, { recursive: true });
    const graphsFile = join(workspace, 'graphs.json');
    await writeFile(graphsFile, JSON.stringify(graphs), 'utf8');

    const stub = join(workspace, 'stub-bd.mjs');
    await writeFile(
      stub,
      `import { readFile } from 'node:fs/promises';\n` +
        `import { fakeBd } from ${JSON.stringify(pathToFileURL(HELPER).href)};\n` +
        `const graphs = JSON.parse(await readFile(process.env.BD_GRAPHS, 'utf8'));\n` +
        `const beads = graphs[process.cwd()];\n` +
        `if (beads === undefined) {\n` +
        `  process.stderr.write('no beads database found\\n');\n` +
        `  process.exit(1);\n` +
        `}\n` +
        `process.stdout.write(await fakeBd(beads)(process.argv.slice(2)));\n`,
      'utf8',
    );
    const launcher = join(binDir, 'bd');
    await writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${stub}" "$@"\n`, 'utf8');
    await execFileAsync('chmod', ['755', launcher]);
    return { binDir, graphsFile };
  }

  it('answers from the available scopes and exits 0 when one scope is absent', async () => {
    const code = await makeWorkspace({ repository: true });
    const ops = await makeWorkspace();
    const scopesFile = await writeScopes(code, [
      { name: 'code', path: code, kind: 'code', readOnly: false },
      { name: 'notes', path: join(code, 'gone'), kind: 'personal', readOnly: true },
      { name: 'ops', path: ops, kind: 'ops', readOnly: true },
    ]);
    const stub = await makeStubBd(code, {
      [code]: [{ id: 'c-1', title: 'Ship the queue', labels: ['execution:hitl'], rice: rice() }],
      [ops]: [{ id: 'o-1', title: 'Renew the certificate', labels: ['execution:hitl'], rice: rice(1) }],
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      [SCRIPT, 'queue', '--scopes', scopesFile, '--cwd', code],
      {
        cwd: code,
        env: { ...process.env, PATH: `${stub.binDir}:${process.env.PATH ?? ''}`, BD_GRAPHS: stub.graphsFile },
      },
    );

    assert.match(stdout, /· 3 scopes, 1 unavailable ·/);
    assert.match(stdout, /unavailable: notes .* — workspace does not exist/);
    assert.match(stdout, /^1 {2}code {2}c-1 /m);
    assert.match(stdout, /^2 {2}ops {3}o-1 /m);
    assert.doesNotMatch(stdout, /notes {2}n-/);
  });

  it('reads a scope list named on the command line, and reports an unreadable one as exit 2', async () => {
    const code = await makeWorkspace({ repository: true });
    const personal = await makeWorkspace({ daily: DAILY_LINE });
    const scopesFile = await writeScopes(code, [
      { name: 'code', path: code, kind: 'code', readOnly: false },
      { name: 'personal', path: personal, kind: 'personal', readOnly: true },
    ]);
    const stub = await makeStubBd(code, {
      [code]: [{ id: 'c-1', title: 'Ship the queue', labels: ['execution:hitl'], rice: rice() }],
      [personal]: [{ id: 'p-1', title: 'Write the objectives', labels: ['execution:hitl'], rice: rice(2) }],
    });
    const env = { ...process.env, PATH: `${stub.binDir}:${process.env.PATH ?? ''}`, BD_GRAPHS: stub.graphsFile };

    const { stdout } = await execFileAsync(
      process.execPath,
      [SCRIPT, 'queue', '--scopes', scopesFile, '--cwd', code],
      { cwd: code, env },
    );
    assert.match(stdout, /^today · personal, code — "daily: personal, code — Monday and Tuesday are the personal objectives"/m);
    assert.match(stdout, /^2 {2}personal {2}p-1 /m);

    const shared = await execFileAsync(
      process.execPath,
      [SCRIPT, 'queue', '--scopes', scopesFile, '--cwd', code, '--shared'],
      { cwd: code, env },
    );
    assert.match(shared.stdout, /today · withheld \(shared invocation\)/);
    assert.doesNotMatch(shared.stdout, /Write the objectives/);

    const broken = join(code, 'broken.json');
    await writeFile(broken, '{ "scopes": ', 'utf8');
    const failed = await execFileAsync(
      process.execPath,
      [SCRIPT, 'queue', '--scopes', broken, '--cwd', code],
      { cwd: code, env },
    ).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: '' }),
      (error) => ({ code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
    );
    assert.equal(failed.code, 2);
    assert.match(failed.stderr, /is not JSON/);
    assert.match(await readFile(broken, 'utf8'), /scopes/);
  });
});
