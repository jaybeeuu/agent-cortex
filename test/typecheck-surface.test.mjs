// Guard: the root typecheck must keep covering the whole tooling surface.
//
// `tsconfig.json` is the only thing that decides what `tsc --noEmit -p
// tsconfig.json` sees, and narrowing it is silent — the repo's product code (the
// CLI, the harness installers, the Claude hook, the shared libs) simply stops
// being checked while every command stays green. These cases make that narrowing
// a build failure: every tooling directory must be in `include`, every `.mjs`
// file inside those directories must be matched by one of the patterns, the
// `typecheck` script must run that project, and no `exclude` entry may take the
// surface back out again.
//
// test/ is deliberately NOT part of the surface yet (it is asserted below so the
// gap stays a decision rather than an oversight); annotating the test fixtures is
// tracked separately.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Tooling directories the root typecheck must cover. */
const REQUIRED_SURFACE = ["bin", "lib", "hooks", "scripts"];

/** Directories the surface must NOT cover (yet) — see the file header. */
const OUT_OF_SURFACE = ["test"];

async function readJson(name) {
  return JSON.parse(await readFile(join(ROOT, name), "utf-8"));
}

/** Relative paths of every .mjs file under `dir`. */
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

/** Whether a tsconfig `include` glob matches `file` (`**` spans directories). */
function patternCovers(pattern, file) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/|\*/g, (token) => (token === "**/" ? "(?:[^/]+/)*" : "[^/]*"));
  return new RegExp(`^${source}$`).test(file);
}

describe("root typecheck surface", () => {
  it("includes every tooling directory", async () => {
    const { include } = await readJson("tsconfig.json");

    assert.deepEqual(
      REQUIRED_SURFACE.filter((dir) => !include.includes(`${dir}/**/*.mjs`)),
      [],
      "tsconfig.json include must list bin/, lib/, hooks/ and scripts/",
    );
  });

  it("matches every module in each tooling directory", async () => {
    const { include } = await readJson("tsconfig.json");
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
    const { exclude = [] } = await readJson("tsconfig.json");
    const excluded = exclude.filter(
      (pattern) => !pattern.startsWith("node_modules") && REQUIRED_SURFACE.some((dir) => pattern.startsWith(dir)),
    );

    assert.deepEqual(excluded, [], "tsconfig.json exclude must not carve tooling paths out of the surface");
  });

  it("keeps the test/ decision explicit", async () => {
    const { include } = await readJson("tsconfig.json");

    assert.deepEqual(
      OUT_OF_SURFACE.filter((dir) => include.includes(`${dir}/**/*.mjs`)),
      [],
      "test/ is documented as outside the surface — move it in and update this guard, or annotate it in a follow-up",
    );
  });
});
