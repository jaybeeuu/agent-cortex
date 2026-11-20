// `ctx scope add` and `ctx scope list`: register a bd workspace in the user-level scope list,
// and print the list a run will actually read — without hand-editing `scopes.json`.
//
// The model is the `hitl-queue` skill's. `skills/workflow/hitl-queue/scripts/scopes.mjs` owns the
// file format, the path resolution, the kind vocabulary, the availability rule and the refusal
// that stops a directory borrowing an enclosing workspace's beads; this module only writes and
// prints what that model defines. The import reaches into `skills/` deliberately: the published
// package ships `bin/`, `lib/` and `skills/` side by side (`package.json` `files`), and a second
// parser here would drift from the one the queue reads. `scripts/lib/` is the home for helpers the
// installers and the migration share; the scope model is not one of those, and the pi staged
// package ships `skills/` without `scripts/`, so moving the model there would break the skill.
//
// Two traps this command exists to close:
//
//   • **A configured list replaces the implicit "workspace you are standing in" scope.** `add`
//     therefore keeps the current workspace in the written list, as the default `code` entry, so
//     adding a personal scope can never drop a repository out of the queue.
//   • **A directory with no `.beads` of its own reads the enclosing workspace's beads.** `add`
//     refuses it, naming the check, and never writes the list.
//
// `add` is a read-modify-write that touches one entry: every other entry and every unknown key in
// the file survives, and the merged document is validated by the queue's own parser before any
// write, so a malformed file is refused rather than truncated.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  DEFAULT_READ_ONLY,
  DEFAULT_SCOPE_NAME,
  SCOPE_KINDS,
  ScopeError,
  WORKSPACE_MARKER,
  cortexHome,
  currentScope,
  parseScopeList,
  readScopeConfig,
  resolveWorkspacePath,
  unavailableReason,
} from "../skills/workflow/hitl-queue/scripts/scopes.mjs";
import { findRepositoryRoot } from "../skills/workflow/strategise/scripts/strategy.mjs";

/** @typedef {import("../skills/workflow/hitl-queue/scripts/scopes.mjs").Scope} Scope */
/** @typedef {import("../skills/workflow/hitl-queue/scripts/scopes.mjs").ScopeKind} ScopeKind */

/**
 * What `add` did, for the report.
 * @typedef {object} AddReport
 * @property {string} file       The user-level list that was written.
 * @property {string} name       The scope's name after the add.
 * @property {string} path       The resolved workspace path.
 * @property {string} kind       The scope's kind after the add.
 * @property {boolean} readOnly  The flag written on the touched entry.
 * @property {"added" | "updated"} action
 * @property {boolean} keptCurrent  A `code` entry was written for the current workspace.
 * @property {string} currentName   The entry name that is the current workspace.
 */

// ─── The refusal ──────────────────────────────────────────────────────────────

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : undefined;
}

/**
 * Which check a directory fails as a scope: it must exist, be a directory, and carry its own
 * `.beads`. The marker is tested at that exact directory and never by walking up, because walking
 * up is what bd does — and that is the failure being prevented.
 * @param {string} path
 * @returns {Promise<"missing" | "not-a-directory" | "no-workspace-marker" | undefined>}
 */
async function workspaceDefect(path) {
  const info = await stat(path).catch(() => undefined);
  if (info === undefined) return "missing";
  if (!info.isDirectory()) return "not-a-directory";
  const marker = await stat(join(path, WORKSPACE_MARKER)).catch(() => undefined);
  if (marker === undefined || !marker.isDirectory()) return "no-workspace-marker";
  return undefined;
}

/**
 * The refusal text for a directory that cannot be registered, naming the check that failed.
 * @param {string} path
 * @param {"missing" | "not-a-directory" | "no-workspace-marker"} defect
 * @returns {string}
 */
function workspaceRefusal(path, defect) {
  if (defect === "missing") {
    return `Refusing to add ${path}: it does not exist (check: the directory exists). Nothing was written.`;
  }
  if (defect === "not-a-directory") {
    return `Refusing to add ${path}: it is not a directory (check: the path is a directory). Nothing was written.`;
  }
  return (
    `Refusing to add ${path}: it carries no ${WORKSPACE_MARKER} of its own ` +
    "(check: it is its own bd workspace), so bd would read the enclosing workspace's beads and " +
    "tag them with the wrong scope. Nothing was written."
  );
}

// ─── Reading the list without losing anything ─────────────────────────────────

/**
 * The user-level list as it is on disk, raw, so every unknown key and every untouched entry
 * survives the write. A file that cannot be understood is refused, never rewritten.
 * @param {string} file
 * @returns {Promise<{ root: Record<string, unknown>, entries: Record<string, unknown>[] }>}
 */
async function readUserList(file) {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) return { root: {}, entries: [] };

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ScopeError(`${file} is not JSON, so it was left untouched. Fix the file, then add the scope again.`);
  }
  const root = asRecord(parsed);
  if (root === undefined) {
    throw new ScopeError(`${file} is not a JSON object, so it was left untouched.`);
  }

  const list = root.scopes;
  if (list === undefined) return { root, entries: [] };
  if (!Array.isArray(list)) {
    throw new ScopeError(`${file} has a "scopes" key that is not an array, so it was left untouched.`);
  }

  /** @type {Record<string, unknown>[]} */
  const entries = [];
  for (const [index, entry] of list.entries()) {
    const record = asRecord(entry);
    if (record === undefined) {
      throw new ScopeError(`${file} has an entry ${index + 1} that is not an object, so it was left untouched.`);
    }
    entries.push(record);
  }
  return { root, entries };
}

/**
 * The path each entry names, resolved the way the queue resolves it, so two spellings of one
 * workspace compare equal. An entry without a usable path resolves to `undefined`; the parser
 * that runs before the write reports it.
 * @param {Record<string, unknown>[]} entries
 * @param {string} base
 * @returns {Promise<(string | undefined)[]>}
 */
async function resolveEntries(entries, base) {
  return await Promise.all(
    entries.map(async (entry) => {
      const raw = typeof entry.path === "string" ? entry.path.trim() : "";
      return raw === "" ? undefined : await resolveWorkspacePath(raw, base).catch(() => undefined);
    }),
  );
}

// ─── add ──────────────────────────────────────────────────────────────────────

/**
 * Add or update one scope in the user-level list.
 * @param {{ rawPath: string | undefined, name: string | undefined, kind: string | undefined }} options
 * @param {string} cwd
 * @returns {Promise<AddReport>}
 */
async function addScope({ rawPath, name, kind }, cwd) {
  if (rawPath === undefined || rawPath.trim() === "") {
    throw new ScopeError('Missing "--path". Say which workspace to register.');
  }

  const requestedKind = kind === undefined ? undefined : kind.trim();
  if (requestedKind !== undefined && SCOPE_KINDS.find((candidate) => candidate === requestedKind) === undefined) {
    throw new ScopeError(
      `"--kind ${requestedKind}" is not a scope kind; use one of ${SCOPE_KINDS.join(", ")}. Nothing was written.`,
    );
  }

  const target = await resolveWorkspacePath(rawPath.trim(), cwd);
  const defect = await workspaceDefect(target);
  if (defect !== undefined) throw new ScopeError(workspaceRefusal(target, defect));

  const file = join(cortexHome(), "scopes.json");
  const base = await findRepositoryRoot(dirname(file));
  const { root, entries } = await readUserList(file);
  const current = (await currentScope(cwd)).path;

  const resolved = await resolveEntries(entries, base);
  const explicitName = name === undefined ? undefined : name.trim();
  if (explicitName !== undefined && explicitName === "") {
    throw new ScopeError('"--name" needs a value. Nothing was written.');
  }

  let index = explicitName === undefined ? -1 : entries.findIndex((entry) => entry.name === explicitName);
  if (index !== -1 && resolved[index] !== target) {
    const named = resolved[index] ?? "another workspace";
    throw new ScopeError(`A scope named "${explicitName}" already names ${named}. Choose another --name. Nothing was written.`);
  }
  if (index === -1) index = resolved.indexOf(target);

  const existing = index === -1 ? undefined : entries[index];
  const existingName = typeof existing?.name === "string" ? existing.name : undefined;
  const chosenName = explicitName ?? existingName ?? basename(target);
  if (chosenName === "") {
    throw new ScopeError(`${target} has no directory name to take a scope name from; pass --name. Nothing was written.`);
  }
  // A new entry cannot take a name another entry already holds: the queue tags every row with
  // that name, and two workspaces under one tag is exactly the wrong-scope report this command
  // exists to prevent. Refuse before the merge, so the message names the command's reason.
  if (index === -1) {
    const takenByName = entries.findIndex((entry) => entry.name === chosenName);
    if (takenByName !== -1) {
      const named = resolved[takenByName] ?? "another workspace";
      throw new ScopeError(
        `A scope named "${chosenName}" already names ${named}. Pass --name to register ${target} under ` +
          "another name. Nothing was written.",
      );
    }
  }
  const chosenKind = requestedKind ?? (typeof existing?.kind === "string" ? existing.kind : "code");
  // Only the current workspace may be writable, so only its entry is written non-read-only; any
  // other entry keeps the safe default (`readOnly` true) or the flag it already declares.
  const declaredReadOnly = typeof existing?.readOnly === "boolean" ? existing.readOnly : undefined;
  const readOnly = target === current ? false : declaredReadOnly ?? DEFAULT_READ_ONLY;

  /** @type {Record<string, unknown>} */
  const updated = { ...(existing ?? {}), name: chosenName, path: target, kind: chosenKind, readOnly };
  const next = entries.slice();
  const action = index === -1 ? "added" : "updated";
  if (index === -1) next.push(updated);
  else next[index] = updated;

  // Retention: the current workspace must never drop out of the queue silently. When the merged
  // list does not name it, the default `code` entry is written for it — the same scope the queue
  // reads when no list exists at all.
  const nextResolved = await resolveEntries(next, base);
  let keptCurrent = false;
  if (!nextResolved.includes(current)) {
    if (chosenName === DEFAULT_SCOPE_NAME) {
      throw new ScopeError(
        `Refusing to add ${target}: "${DEFAULT_SCOPE_NAME}" is the name reserved for the current workspace ` +
          `(${current}), so choose another --name. Nothing was written.`,
      );
    }
    const taken = next.findIndex((entry) => entry.name === DEFAULT_SCOPE_NAME);
    if (taken !== -1) {
      throw new ScopeError(
        `Refusing to add ${target}: the current workspace (${current}) is not in the list, and the name ` +
          `"${DEFAULT_SCOPE_NAME}" that would keep it there already names ${nextResolved[taken] ?? "another scope"}. ` +
          "Nothing was written.",
      );
    }
    next.unshift({ name: DEFAULT_SCOPE_NAME, path: current, kind: "code", readOnly: false });
    keptCurrent = true;
  }

  const finalResolved = keptCurrent ? [current, ...nextResolved] : nextResolved;
  const retaining = next[finalResolved.indexOf(current)];
  const currentName = keptCurrent ? DEFAULT_SCOPE_NAME : String(retaining?.name ?? DEFAULT_SCOPE_NAME);

  const text = JSON.stringify({ ...root, scopes: next }, null, 2);
  // The queue's own parser is the gate: it validates the merged document (names, kinds, paths,
  // duplicates) and throws before anything is written.
  await parseScopeList(text, { file, base, cwd });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${text}\n`, "utf8");

  return { file, name: chosenName, path: target, kind: chosenKind, readOnly, action, keptCurrent, currentName };
}

// ─── list ─────────────────────────────────────────────────────────────────────

/**
 * Every scope a run in `cwd` would resolve, with the reason each one cannot be read.
 * @param {string} cwd
 * @returns {Promise<{ file: string | undefined, scopes: Scope[], reasons: (string | undefined)[] }>}
 */
async function listScopes(cwd) {
  const config = await readScopeConfig({ cwd });
  const reasons = await Promise.all(config.scopes.map((scope) => unavailableReason(scope)));
  return { file: config.file, scopes: config.scopes, reasons };
}

/** @param {string[]} cells @param {number[]} widths @param {number} last @returns {string} */
function formatRow(cells, widths, last) {
  return cells.map((cell, column) => (column === last ? cell : cell.padEnd(widths[column]))).join("  ");
}

/**
 * @param {{ file: string | undefined, scopes: Scope[], reasons: (string | undefined)[] }} listing
 * @param {string} programName
 * @returns {string}
 */
function formatScopeTable({ file, scopes, reasons }, programName) {
  const headers = ["scope", "kind", "readOnly", "availability", "path"];
  const rows = scopes.map((scope, index) => {
    const reason = reasons[index];
    const availability =
      reason !== undefined ? `unavailable: ${reason}` : scope.writable ? "available (writable)" : "available";
    return [scope.name, scope.kind, `readOnly=${String(scope.readOnly)}`, availability, scope.path];
  });
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column].length)));
  const last = headers.length - 1;
  const lines = [
    file === undefined ? "scopes · none configured — the current workspace alone" : `scopes · ${file}`,
    `  ${formatRow(headers, widths, last)}`,
    ...rows.map((row) => `  ${formatRow(row, widths, last)}`),
  ];
  if (file === undefined) {
    lines.push(`  add one: ${programName} scope add --path <dir> [--name <n>] [--kind ${SCOPE_KINDS.join("|")}]`);
  }
  return lines.join("\n");
}

/**
 * @param {AddReport} report
 * @returns {string}
 */
function formatAddReport(report) {
  const verb = report.action === "added" ? "Added" : "Updated";
  return [
    `✓ ${verb} scope "${report.name}" (${report.kind}) → ${report.path}`,
    `  list · ${report.file}`,
    report.readOnly
      ? "  readOnly=true — read-only except in the one workspace a run is in."
      : "  readOnly=false — writable only while the run is in this workspace.",
    report.keptCurrent
      ? `  kept · the current workspace stays in the list as "${report.currentName}", because a configured list replaces the implicit workspace scope.`
      : `  kept · "${report.currentName}" is the current workspace, so it stays in the list.`,
  ].join("\n");
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

/**
 * Run `scope add` or `scope list`. Mirrors `runSelfUpdate`: the command prints its own report and
 * returns its exit code. A refusal is a `ScopeError` — the scope model's usage-mistake class — and
 * exits 2; an unexpected failure exits 1.
 * @param {import("./cli.mjs").ParsedArgs} parsed
 * @param {string} programName
 * @returns {Promise<number>} The exit code
 */
export async function runScopeCommand(parsed, programName) {
  if (parsed.optionError) {
    process.stderr.write(`${parsed.optionError}\n`);
    return 1;
  }
  try {
    if (parsed.scopeCommand === "add") {
      const report = await addScope(
        { rawPath: parsed.scopePath, name: parsed.scopeName, kind: parsed.scopeKind },
        process.cwd(),
      );
      process.stdout.write(`${formatAddReport(report)}\n`);
      return 0;
    }
    if (parsed.scopeCommand === "list") {
      process.stdout.write(`${formatScopeTable(await listScopes(process.cwd()), programName)}\n`);
      return 0;
    }
    process.stderr.write(
      `Missing scope command: use "${programName} scope add" or "${programName} scope list".\n` +
        `Run "${programName} --help" for usage.\n`,
    );
    return 1;
  } catch (err) {
    const error = /** @type {Error} */ (err);
    process.stderr.write(`${error.message}\n`);
    return error instanceof ScopeError ? 2 : 1;
  }
}
