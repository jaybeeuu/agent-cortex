// @ts-check
// The scope list: which bd workspaces the HITL queue reads, and which ones it may write.
//
// A scope is one bd workspace. The queue reads every configured scope, tags every row with
// the scope it came from, and reports a scope it cannot read as unavailable rather than
// failing the run — a personal workspace will not exist on every machine.
//
// Three rules keep the list safe to ship and safe to copy between machines:
//
//   • **A scope you did not mark writable is read-only.** `readOnly` defaults to `true` in
//     the file, and a scope is writable only when it is not read-only *and* its resolved
//     path is the current workspace. Every other scope is read-only whatever the file says,
//     so a copied config cannot hand a personal workspace to a code session.
//   • **A scope is available only when it is its own tracker.** bd resolves a workspace by
//     walking up from the current directory, so a configured directory with no `.beads` of
//     its own would silently read the enclosing workspace's beads and tag them with the
//     wrong scope. The marker check refuses that and reports the scope unavailable.
//   • **A read-only scope only ever receives a read call.** `guardRunner` refuses any bd
//     call that is not one of the two the queue issues, so the boundary is enforced at the
//     one place every tracker call passes through, not by remembering not to write.
//
// Zero runtime dependencies, async fs only. The configuration is a file with a documented
// default: `<repository root>/.agent-cortex/scopes.json`, then
// `<AGENT_CORTEX_HOME|~/.agent-cortex>/scopes.json`, then one implicit writable scope for
// the current workspace. No path and no hostname of one machine ships in this module.

import { access, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { findRepositoryRoot, resolveStrategyPath, validateStrategy } from '../../prioritise-work/scripts/strategy.mjs';

/** @typedef {(args: string[]) => Promise<string>} Runner */
/** @typedef {(args: string[], scope: Scope) => Promise<string>} ScopedRunner */

// ─── Contract ─────────────────────────────────────────────────────────────────

/** The project-level scope list, relative to the repository root. */
export const DEFAULT_SCOPES_FILE = '.agent-cortex/scopes.json';

/** Overrides the install root the user-level scope list is read from. */
export const HOME_ENV = 'AGENT_CORTEX_HOME';

/** Marks an invocation whose output will leave this machine. */
export const SHARED_ENV = 'AGENT_CORTEX_QUEUE_SHARED';

/** The scope kinds. A kind says what the work is, so a reader knows what a row is about. */
export const SCOPE_KINDS = /** @type {const} */ (['code', 'personal', 'ops']);

/**
 * The kind whose rows and strategy text a shared invocation withholds. Personal work is
 * the one class that must never travel to another workspace.
 */
export const PERSONAL_KIND = 'personal';

/** The name of the implicit scope: the current workspace, when no list is configured. */
export const DEFAULT_SCOPE_NAME = 'code';

/** The directory bd keeps in a workspace. Its absence means the workspace is uninitialised. */
export const WORKSPACE_MARKER = '.beads';

/** A scope the file does not mark writable is read-only: the safe reading of an omission. */
export const DEFAULT_READ_ONLY = true;

/**
 * The bd calls this skill issues, as argv prefixes. `dep list` is a read; `dep add` is not,
 * which is why the guard matches the second word rather than the first.
 * @type {readonly (readonly string[])[]}
 */
export const READ_CALLS = /** @type {const} */ ([['list'], ['dep', 'list']]);

/** The word that starts a daily scope line in a strategy file. */
export const DAILY_MARKER = 'daily';

/** A usage mistake: the scope list the caller named cannot be read. Exit code 2. */
export class ScopeError extends Error {}

/** A write attempted against a read-only scope. This is a defect in the caller, not the machine. */
export class ScopeWriteError extends Error {}

// ─── Types ────────────────────────────────────────────────────────────────────

/** @typedef {'code' | 'personal' | 'ops'} ScopeKind */

/**
 * One configured scope, resolved to an absolute path.
 * @typedef {object} Scope
 * @property {string} name
 * @property {string} path
 * @property {ScopeKind} kind
 * @property {boolean} readOnly   As the file declares it.
 * @property {boolean} current    The resolved path is the current workspace.
 * @property {boolean} writable   `!readOnly && current` — the only writable scope.
 */

/**
 * The daily scope note: which scopes the day belongs to, read from the personal strategy.
 * @typedef {object} DailyNote
 * @property {string} scopeName          The personal scope it was read from.
 * @property {string[]} scopes           The scope names the line leads with.
 * @property {string} line               The strategy line, verbatim.
 * @property {string | undefined} section The `##` heading it sat under.
 * @property {number | undefined} strategyVersion
 * @property {string | undefined} reason Why there is no note instead of one.
 * @property {boolean} [withheld]        True when a shared invocation withholds it.
 */

// ─── Paths ────────────────────────────────────────────────────────────────────

/** @param {string} path @returns {Promise<boolean>} */
async function exists(path) {
  return await access(path).then(
    () => true,
    () => false,
  );
}

/** The install root, or where the user-level scope list lives when it is not overridden.
 * @returns {string}
 */
export function cortexHome() {
  const override = process.env[HOME_ENV];
  return override !== undefined && override !== '' ? resolve(override) : join(homedir(), '.agent-cortex');
}

/**
 * A workspace path as written in the file, resolved: `~` is the home directory, a relative
 * path resolves against `base` (default: the directory the run was started from), and an
 * existing path is resolved through symlinks so two spellings of one workspace compare
 * equal.
 * @param {string} path @param {string} [base] @returns {Promise<string>}
 */
export async function resolveWorkspacePath(path, base = process.cwd()) {
  const expanded = path === '~'
    ? homedir()
    : path.startsWith('~/')
      ? join(homedir(), path.slice(2))
      : path;
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
  return await realpath(absolute).catch(() => absolute);
}

/**
 * The workspace a run belongs to: the nearest ancestor of `cwd`, itself included, that
 * carries `.beads`. bd resolves a workspace by walking up in exactly this way, so a run from
 * a subdirectory belongs to the workspace above it — "current" means that workspace, never
 * the subdirectory. With no ancestor marked, the directory the run started in is the answer.
 * @param {string} cwd @returns {Promise<string>}
 */
async function currentWorkspace(cwd) {
  const from = await resolveWorkspacePath('.', cwd);
  let directory = from;
  for (;;) {
    if (await exists(join(directory, WORKSPACE_MARKER))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return from;
    directory = parent;
  }
}

/**
 * The one scope a run reads when no list is configured: the current workspace, writable.
 * @param {string} [cwd] @returns {Promise<Scope>}
 */
export async function currentScope(cwd = process.cwd()) {
  return {
    name: DEFAULT_SCOPE_NAME,
    path: await currentWorkspace(cwd),
    kind: /** @type {ScopeKind} */ ('code'),
    readOnly: false,
    current: true,
    writable: true,
  };
}

/**
 * The scope list this repository or this user has configured, if any.
 * @param {string} cwd @returns {Promise<string | undefined>}
 */
async function defaultScopesFile(cwd) {
  const root = await findRepositoryRoot(cwd);
  const inRepository = join(root, DEFAULT_SCOPES_FILE);
  if (await exists(inRepository)) return inRepository;
  const inHome = join(cortexHome(), 'scopes.json');
  if (await exists(inHome)) return inHome;
  return undefined;
}

// ─── Configuration ────────────────────────────────────────────────────────────

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
function asRecord(value) {
  return typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : undefined;
}

/** @param {unknown} value @returns {string | undefined} */
function asString(value) {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Read one entry's name.
 * @param {unknown} value @param {number} index @param {string} file @returns {string}
 */
function readName(value, index, file) {
  const name = asString(value)?.trim();
  if (name === undefined || name === '') {
    throw new ScopeError(`scope ${index + 1} in ${file} has no "name"`);
  }
  return name;
}

/**
 * Read one entry's workspace path, resolved against the run's directory.
 * @param {unknown} value @param {number} index @param {string} file
 */
function readPath(value, index, file) {
  const path = asString(value)?.trim();
  if (path === undefined || path === '') {
    throw new ScopeError(`scope ${index + 1} in ${file} has no "path"`);
  }
  return path;
}

/**
 * Parse a scope list. Every defect names the scope, so one fix round clears the file.
 *
 * `readOnly` defaults to `true`, and `kind` to `code`. Writability is never taken from the
 * file alone: a scope is writable only when it is not read-only and it is the current
 * workspace, so a list copied onto another machine cannot widen the writable set.
 *
 * A relative `path` resolves against `base` — the repository root of the list itself — and
 * never against the directory the run was started from, so the one committed list means the
 * same thing run from a subdirectory, from a worktree, or from a hook.
 *
 * @param {string} text @param {object} options
 * @param {string} options.file
 * @param {string} options.base   Directory a relative scope path resolves against.
 * @param {string} [options.cwd]  The current workspace, which decides writability.
 * @returns {Promise<Scope[]>}
 */
export async function parseScopeList(text, { file, base, cwd = process.cwd() }) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ScopeError(`${file} is not JSON`);
  }

  const record = asRecord(parsed);
  if (record === undefined) throw new ScopeError(`${file} must be a JSON object`);

  const entries = record.scopes;
  if (!Array.isArray(entries)) throw new ScopeError(`${file} must carry a "scopes" array`);
  if (entries.length === 0) throw new ScopeError(`${file} lists no scopes`);

  const current = await currentWorkspace(cwd);
  /** @type {Scope[]} */
  const scopes = [];
  const seen = new Set();

  for (const [index, entry] of entries.entries()) {
    const item = asRecord(entry);
    if (item === undefined) throw new ScopeError(`scope ${index + 1} in ${file} is not an object`);

    const name = readName(item.name, index, file);
    if (seen.has(name)) throw new ScopeError(`${file} names the scope "${name}" twice`);
    seen.add(name);

    const rawKind = item.kind;
    /** @type {ScopeKind} */
    let kind = /** @type {ScopeKind} */ ('code');
    if (rawKind !== undefined) {
      const matched = SCOPE_KINDS.find((candidate) => candidate === rawKind);
      if (matched === undefined) {
        throw new ScopeError(
          `scope "${name}" in ${file} has kind ${JSON.stringify(rawKind)}; ` +
            `use one of ${SCOPE_KINDS.join(', ')}`,
        );
      }
      kind = matched;
    }

    const rawReadOnly = item.readOnly;
    if (rawReadOnly !== undefined && typeof rawReadOnly !== 'boolean') {
      throw new ScopeError(`scope "${name}" in ${file} has a non-boolean "readOnly"`);
    }

    const path = await resolveWorkspacePath(readPath(item.path, index, file), base);
    const isCurrent = path === current;
    const readOnly = rawReadOnly ?? DEFAULT_READ_ONLY;
    scopes.push({ name, path, kind, readOnly, current: isCurrent, writable: !readOnly && isCurrent });
  }

  return scopes;
}

/**
 * The scope list for one run. A named file that cannot be read is a usage error; no file
 * at all is not, because the one-workspace queue is the documented default.
 * @param {object} [options]
 * @param {string} [options.file]  The scope list to read, when the caller named one.
 * @param {string} [options.cwd]
 * @returns {Promise<{ file: string | undefined, configured: boolean, scopes: Scope[] }>}
 */
export async function readScopeConfig({ file, cwd = process.cwd() } = {}) {
  const path = file === undefined ? await defaultScopesFile(cwd) : await resolveWorkspacePath(file, cwd);
  if (path === undefined) {
    return { file: undefined, configured: false, scopes: [await currentScope(cwd)] };
  }

  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) throw new ScopeError(`${path} cannot be read`);
  const base = await findRepositoryRoot(dirname(path));
  return { file: path, configured: true, scopes: await parseScopeList(text, { file: path, base, cwd }) };
}

// ─── Availability ─────────────────────────────────────────────────────────────

/**
 * Why a scope cannot be read, or `undefined` when it can. A missing or uninitialised
 * workspace is the expected case on a machine that does not carry the personal repo, so it
 * is reported and skipped, never thrown.
 * @param {Scope} scope @returns {Promise<string | undefined>}
 */
export async function unavailableReason(scope) {
  const info = await stat(scope.path).catch(() => undefined);
  if (info === undefined) return 'workspace does not exist';
  if (!info.isDirectory()) return 'workspace path is not a directory';
  const marker = await stat(join(scope.path, WORKSPACE_MARKER)).catch(() => undefined);
  if (marker === undefined || !marker.isDirectory()) {
    return `no ${WORKSPACE_MARKER} workspace here, so it is not initialised`;
  }
  return undefined;
}

// ─── The read-only guard ──────────────────────────────────────────────────────

/**
 * Whether an argv is one of the calls this skill may issue against any scope.
 * @param {string[]} args @returns {boolean}
 */
export function isReadCall(args) {
  return READ_CALLS.some((prefix) => prefix.every((word, index) => args[index] === word));
}

/**
 * Wrap a scope's runner so a read-only scope can only ever receive a read call.
 *
 * The queue issues two reads and no writes, so this guard is what keeps that true after a
 * later change: the boundary sits on the one function every tracker call for a scope passes
 * through, not in the memory of whoever edits the queue next.
 * @param {Scope} scope @param {ScopedRunner} bd @returns {Runner}
 */
export function guardRunner(scope, bd) {
  return async (args) => {
    if (!scope.writable && !isReadCall(args)) {
      throw new ScopeWriteError(
        `refusing "bd ${args.join(' ')}" on scope "${scope.name}": ` +
          (scope.readOnly ? 'the scope is read-only' : 'only the current workspace is writable'),
      );
    }
    return await bd(args, scope);
  };
}

// ─── The daily note ───────────────────────────────────────────────────────────

/** A daily line: an optional bullet, the marker, then the scope names. */
const DAILY_LINE = /^[ \t]*(?:[-*][ \t]+)?daily:[ \t]*(\S.*?)[ \t]*$/i;

/** The bullet in front of a list item, so the quoted line carries no markup. */
const BULLET = /^[ \t]*[-*][ \t]+/;

/** A markdown heading, with its title captured. */
const HEADING = /^[ \t]*##[ \t]+(.*?)[ \t]*$/;

/** The separator between the scope names and the reason in a daily line. */
const REASON_SEPARATOR = /\s+(?:—|--)\s+/;

/**
 * The scope names a daily line leads with: everything before the em dash, comma separated.
 * @param {string} rest @returns {string[]}
 */
export function dailyScopes(rest) {
  const [names = ''] = rest.split(REASON_SEPARATOR);
  return names
    .split(',')
    .map((name) => name.trim().replace(/^[`"']|[`"']$/g, ''))
    .filter((name) => name !== '');
}

/**
 * The nearest `##` heading above a line, so the citation names where it was read.
 * @param {string[]} lines @param {number} index @returns {string | undefined}
 */
function sectionAt(lines, index) {
  for (let i = index; i >= 0; i--) {
    const match = HEADING.exec(lines[i]);
    if (match !== null) return match[1];
  }
  return undefined;
}

/**
 * Read one scope's strategy for a daily line.
 * @param {Scope} scope @returns {Promise<DailyNote | undefined>}
 */
async function dailyNoteFrom(scope) {
  const path = await resolveStrategyPath({ cwd: scope.path }).catch(() => undefined);
  if (path === undefined) return undefined;
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;

  const lines = text.split('\n');
  const index = lines.findIndex((line) => DAILY_LINE.test(line));
  if (index === -1) return undefined;

  const match = /** @type {RegExpExecArray} */ (DAILY_LINE.exec(lines[index]));
  const strategy = validateStrategy(text);
  return {
    scopeName: scope.name,
    scopes: dailyScopes(match[1]),
    line: lines[index].replace(BULLET, '').replace(/\s+$/, ''),
    section: sectionAt(lines, index),
    strategyVersion: strategy.ok ? strategy.version : undefined,
    reason: undefined,
  };
}

/**
 * The daily scope note: which scopes the day belongs to, taken from the personal strategy
 * and quoting the line it came from.
 *
 * The personal scope is the one whose strategy is personal, so its strategy is where a
 * daily line belongs. When several personal scopes are configured, the first one that
 * carries a daily line answers; when none does, the reason is reported instead of a note.
 * @param {Scope[]} scopes @returns {Promise<DailyNote>}
 */
export async function readDailyNote(scopes) {
  const personal = scopes.filter((scope) => scope.kind === PERSONAL_KIND);
  if (personal.length === 0) {
    return emptyNote(
      `no ${PERSONAL_KIND} scope is configured, so there is no personal strategy to read a ` +
        `"${DAILY_MARKER}:" line from`,
    );
  }

  /** @type {string[]} */
  const reasons = [];
  let hint = false;
  for (const scope of personal) {
    const reason = await unavailableReason(scope);
    if (reason !== undefined) {
      reasons.push(`scope "${scope.name}" is unavailable (${reason})`);
      continue;
    }
    const note = await dailyNoteFrom(scope);
    if (note !== undefined) return note;
    reasons.push(`no "${DAILY_MARKER}:" line in the strategy of "${scope.name}"`);
    hint = true;
  }

  const advice = hint ? ' (add one: "- ' + DAILY_MARKER + ': <scope>, <scope> — <why>" under "## Current themes")' : '';
  return emptyNote(`${reasons.join('; ')}${advice}`);
}

/** @param {string} reason @returns {DailyNote} */
export function emptyNote(reason) {
  return {
    scopeName: '',
    scopes: [],
    line: '',
    section: undefined,
    strategyVersion: undefined,
    reason,
  };
}
