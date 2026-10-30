// Guard: the root typecheck must keep covering the whole tooling surface.
//
// `tsconfig.json` is the only thing that decides what `tsc --noEmit -p
// tsconfig.json` sees, and narrowing it is silent — the repo's product code (the
// CLI, the harness installers, the Claude hook, the shared libs) and its own test
// suite simply stop being checked while every command stays green. These cases
// make that narrowing a build failure: every tooling directory must be in
// `include`, every `.mjs` file inside those directories must be matched by one of
// the patterns, the `typecheck` script must run that project, and no `exclude`
// entry may take the surface back out again.
//
// test/ is part of the surface: its fakes and partial fixtures are typed with
// JSDoc typedefs rather than excluded, so the coverage the other directories get
// applies here too.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Tooling directories the root typecheck must cover — the test suite included. */
const REQUIRED_SURFACE = ["bin", "lib", "hooks", "scripts", "test"];

/** Parse a JSON file at the repo root. These are data files, not typed modules: the
 * shape each case relies on is declared where it is read.
 * @param {string} name
 * @returns {Promise<any>} */
async function readJson(name) {
  return JSON.parse(await readFile(join(ROOT, name), "utf-8"));
}

/** The root tsconfig fields these cases read.
 * @typedef {{ include?: string[], exclude?: string[] }} TsConfig */

/**
 * Relative paths of every .mjs file under `dir`.
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function mjsFiles(dir, prefix = dir) {
  const entries = await readdir(join(ROOT, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await mjsFiles(dir, path)));
    else if (entry.name.endsWith(".mjs")) files.push(path);
  }
  return files;
}

/**
 * Whether a tsconfig `include`/`exclude` glob matches `file` (`**` spans directories).
 * @param {string} pattern
 * @param {string} file
 * @returns {boolean}
 */
function patternCovers(pattern, file) {
  const source = (pattern.endsWith("/**") ? `${pattern}/*` : pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/|\*/g, (token) => (token === "**/" ? "(?:[^/]+/)*" : "[^/]*"));
  return new RegExp(`^${source}$`).test(file);
}

describe("root typecheck surface", () => {
  it("includes every tooling directory", async () => {
    /** @type {TsConfig} */
    const { include = [] } = await readJson("tsconfig.json");

    assert.deepEqual(
      REQUIRED_SURFACE.filter((dir) => !include.includes(`${dir}/**/*.mjs`)),
      [],
      "tsconfig.json include must list bin/, lib/, hooks/, scripts/ and test/",
    );
  });

  it("matches every module in each tooling directory", async () => {
    /** @type {TsConfig} */
    const { include = [] } = await readJson("tsconfig.json");
    const unchecked = [];
    for (const dir of REQUIRED_SURFACE) {
      for (const file of await mjsFiles(dir)) {
        if (!include.some((pattern) => patternCovers(pattern, file))) unchecked.push(file);
      }
    }

    assert.deepEqual(unchecked, [], "these modules are outside the root typecheck surface");
  });

  it("runs the root project from the typecheck script", async () => {
    const { scripts } = await readJson("package.json");

    assert.match(scripts.typecheck, /tsc\s+--noEmit\s+-p\s+tsconfig\.json/);
  });

  it("does not exclude tooling paths from the root project", async () => {
    /** @type {TsConfig} */
    const { exclude = [] } = await readJson("tsconfig.json");
    // Matched against the real modules, not their leading directory: `exclude`
    // resolves relative to this config, so `**/notify.mjs` drops the Claude hook
    // without naming `hooks` anywhere (verified: it hides a type error there).
    const files = (await Promise.all(REQUIRED_SURFACE.map((dir) => mjsFiles(dir)))).flat();
    const excluded = exclude.filter(
      (pattern) => !pattern.startsWith("node_modules") && files.some((file) => patternCovers(pattern, file)),
    );

    assert.deepEqual(excluded, [], "tsconfig.json exclude must not carve tooling paths out of the surface");
  });
});
