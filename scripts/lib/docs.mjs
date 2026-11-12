// Documentation a staged install ships.
//
// Skills are installed onto machines that have no copy of this checkout, so a
// skill that reads a repository document — write-a-skill and refactor-skill both
// read docs/skills/skill-anatomy.md — needs that document inside the install.
// The list is derived from token-map.json rather than declared again here: a
// `paths` entry whose relative path sits under `docs/` is a document skills
// reference by install-relative path, so the token map stays the single source
// of where the install puts it.
//
// The copies are verbatim, and no token substitution runs over them. A shipped doc
// therefore must not print a substitution token: one that needs to teach the
// syntax describes the wrapper in words (see the tool-reference section of the
// anatomy guide). test/installed-docs.test.mjs fails when a shipped doc carries
// one, because the materialised plugin must contain no literal token.
//
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isFile } from "./fs.mjs";

/**
 * Package-relative paths of the docs an install ships, sorted.
 * @param {import("./compose-agent.mjs").TokenMap} tokenMap
 * @returns {string[]}
 */
export function shippedDocs(tokenMap) {
  const docs = new Set();
  for (const entry of Object.values(tokenMap.paths ?? {})) {
    if (entry === null || typeof entry !== "object") continue;
    for (const spec of Object.values(entry)) {
      if (spec === null || typeof spec !== "object") continue;
      const { relative } = /** @type {{ relative?: unknown }} */ (spec);
      if (typeof relative === "string" && relative.startsWith("docs/")) docs.add(relative);
    }
  }
  return [...docs].sort();
}

/**
 * Copy every shipped doc from the package root into the staged tree, at the same
 * relative path. A missing source is a hard error: the token map points a skill
 * at a document the install would otherwise not contain.
 * @param {{ root: string, output: string, dryRun?: boolean,
 *           tokenMap: import("./compose-agent.mjs").TokenMap }} options
 * @returns {Promise<{ files: string[], dir: string }>}
 */
export async function installDocs({ root, output, dryRun = false, tokenMap }) {
  /** @type {string[]} */
  const files = [];
  for (const relative of shippedDocs(tokenMap)) {
    const from = join(root, relative);
    if (!(await isFile(from))) {
      throw new Error(
        `token-map.json points a skill at ${relative}, but ${from} does not exist — ship the document or drop the path entry`,
      );
    }
    if (!dryRun) {
      const to = join(output, relative);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
    }
    files.push(relative);
  }
  return { files, dir: join(output, "docs") };
}
