// The package names a pnpm workspace declares, resolved without a package
// manager and without an install.
//
// The release gate must know which package names are legal before it can reject a
// changeset that names a package the workspace does not have. It cannot ask pnpm:
// the CI `Changeset check` job runs on a bare checkout — no `pnpm install`, no
// `node_modules`, and no pnpm on PATH — so `pnpm -r ls` and the `yaml` dependency
// are both unavailable where the gate actually runs. This module therefore reads
// `pnpm-workspace.yaml` with the narrow, dependency-free subset of YAML that a
// `packages:` list uses.
//
// The glob subset is deliberate and closed: `.`, a literal directory, and a
// trailing `/*` one level deep. Any other glob raises instead of being skipped,
// because a skipped entry would silently shrink the workspace and make the gate
// reject a package that is in fact declared.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDirectory, isFile } from "./fs.mjs";
import { unquoteScalar } from "./yaml-scalar.mjs";

const WORKSPACE_FILE = "pnpm-workspace.yaml";
const PACKAGES_KEY = /^packages\s*:/;
const LIST_ITEM = /^\s*-\s*(.+?)\s*$/;
const TRAILING_GLOB = /^(.*?)\/\*$/;

/**
 * Read the `name` of every package in the pnpm workspace at `root`: the root
 * package, plus each entry `pnpm-workspace.yaml` declares. A declared entry that
 * holds no `package.json` contributes nothing.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function readWorkspacePackageNames(root) {
  const names = [];
  for (const dir of await resolveWorkspaceDirs(root)) {
    const manifest = join(dir, "package.json");
    if (!(await isFile(manifest))) continue;
    const { name } = JSON.parse(await readFile(manifest, "utf8"));
    if (typeof name === "string" && name !== "") names.push(name);
  }
  return names;
}

/**
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function resolveWorkspaceDirs(root) {
  const dirs = [];
  for (const entry of await readWorkspaceEntries(root)) {
    dirs.push(...(await expandEntry(root, entry)));
  }
  return dirs;
}

/**
 * The `packages:` entries of the workspace file. A workspace with no file is the
 * single root package; a file that declares no entry is an error, because an empty
 * workspace would make every package name look unknown.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function readWorkspaceEntries(root) {
  const file = join(root, WORKSPACE_FILE);
  if (!(await isFile(file))) return ["."];

  const entries = parsePackagesList(await readFile(file, "utf8"));
  if (entries.length === 0) throw new Error(`${WORKSPACE_FILE} declares no workspace packages`);
  return entries;
}

/**
 * @param {string} root
 * @param {string} entry  one `packages:` pattern
 * @returns {Promise<string[]>}
 */
async function expandEntry(root, entry) {
  const pattern = entry.replace(/^\.\//, "").replace(/\/+$/, "");
  if (pattern === "" || pattern === ".") return [root];

  const glob = TRAILING_GLOB.exec(pattern);
  if (glob === null) {
    if (pattern.includes("*")) {
      throw new Error(`${WORKSPACE_FILE} declares a workspace pattern this gate cannot expand: ${entry}`);
    }
    return [join(root, pattern)];
  }

  const parent = join(root, glob[1]);
  if (!(await isDirectory(parent))) return [];
  const children = await readdir(parent, { withFileTypes: true });
  return children.filter((child) => child.isDirectory()).map((child) => join(parent, child.name));
}

/**
 * Parse the `packages:` value out of workspace YAML, in either the block form or a
 * single-line flow list.
 * @param {string} text
 * @returns {string[]}
 */
function parsePackagesList(text) {
  const lines = text.split("\n");
  const keyLine = lines.findIndex((line) => PACKAGES_KEY.test(line));
  if (keyLine === -1) return [];

  const inline = lines[keyLine].replace(PACKAGES_KEY, "").trim();
  if (inline !== "") return parseInlineList(inline);

  const entries = [];
  for (const line of lines.slice(keyLine + 1)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const item = LIST_ITEM.exec(line);
    if (item === null) break;
    entries.push(unquoteScalar(item[1]));
  }
  return entries;
}

/**
 * @param {string} inline
 * @returns {string[]}
 */
function parseInlineList(inline) {
  if (!inline.startsWith("[") || !inline.endsWith("]")) {
    throw new Error(`${WORKSPACE_FILE} has an unsupported packages value: ${inline}`);
  }
  return inline
    .slice(1, -1)
    .split(",")
    .map(unquoteScalar)
    .filter((entry) => entry !== "");
}
