// Copy the pipeline formula into a consumer repository's bd formula directory.
//
// `bd` reads formulas only from a fixed set of directories — `<project>/.beads/
// formulas/`, the checkout root's `.beads/formulas/`, and `~/.beads/formulas/` —
// and neither `BD_*` variables nor `bd config` move that search path. A formula
// shipped inside this package is therefore invisible to `bd mol pour` until it is
// copied into one of them, which is why both installers write it into the project
// they are run from.
//
// That copy is an untracked file in the consumer's repository: `.beads/formulas/`
// is not gitignored. This module reports it as such — the caller prints the
// message — because writing into someone else's working tree has to be visible.
//
// Two conditions must not fail an install: a project whose `bd init` never ran has
// no `.beads/`, and a package missing the source file has nothing to copy. Both
// come back as an `action` the caller reports, and `create-chores.mjs` has its own
// fallback for a project that has no formula.
//
// Zero dependencies beyond node builtins so it runs on the CI Node (20) and the
// local Node alike.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { isDirectory, isFile } from "./fs.mjs";

/** Formula id, which is also the `formula` field inside the file and the stem of its filename. */
export const PIPELINE_FORMULA_ID = "pipeline";

/** Filename bd discovers by that id: `<formula-id>.formula.json`. */
export const PIPELINE_FORMULA_FILE = `${PIPELINE_FORMULA_ID}.formula.json`;

/**
 * Package-relative source. It sits beside `pipeline.json` inside the create-task
 * skill, so the two definitions of the pipeline ship and are reviewed together.
 */
export const PIPELINE_FORMULA_SOURCE = "skills/planning/create-task/pipeline.formula.json";

/**
 * Outcome of the copy, for the caller to print.
 * @typedef {object} FormulaCopy
 * @property {"written" | "unchanged" | "planned" | "no-beads-dir" | "source-missing"} action
 * @property {string | null} path   Target file, or null when nothing was resolved
 * @property {string} message       One line stating what happened, for the install output
 */

/**
 * The nearest directory at or above `startDir` that holds a `.beads` directory.
 * This mirrors bd's own discovery: the project root is where `.beads/` lives, not
 * necessarily the directory the installer was invoked from.
 * @param {string} startDir
 * @returns {Promise<string | null>} The directory holding `.beads`, or null
 */
export async function findBeadsDir(startDir) {
  let current = resolve(startDir);
  for (;;) {
    if (await isDirectory(join(current, ".beads"))) return current;
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return null;
    current = parent;
  }
}

/**
 * Copy the shipped formula to `<project>/.beads/formulas/<formula-id>.formula.json`.
 *
 * The write is content-compared first, so a second install leaves the file alone:
 * rewriting an identical copy would touch its mtime for no gain and make every
 * install look like it changed the consumer's tree.
 *
 * @param {object} options
 * @param {string} options.root        Package root holding `PIPELINE_FORMULA_SOURCE`
 * @param {string | null} [options.projectDir]  Consumer project dir; null skips the copy
 *                                     (the generate-only `--output` form)
 * @param {boolean} [options.dryRun]   Report the plan without writing
 * @returns {Promise<FormulaCopy>}
 */
export async function copyPipelineFormula({ root, projectDir = null, dryRun = false }) {
  if (projectDir === null) {
    return {
      action: "planned",
      path: null,
      message: "Skipped the pipeline formula copy (generate-only run: no project directory is written to)",
    };
  }

  const source = join(root, PIPELINE_FORMULA_SOURCE);
  if (!(await isFile(source))) {
    return {
      action: "source-missing",
      path: null,
      message: `${PIPELINE_FORMULA_SOURCE} is missing from this package, so the pipeline formula was not copied — stage expansion falls back to its per-stage path`,
    };
  }

  const projectRoot = await findBeadsDir(projectDir);
  if (projectRoot === null) {
    return {
      action: "no-beads-dir",
      path: null,
      message: `No .beads/ directory at or above ${resolve(projectDir)}, so the pipeline formula was not copied — run "bd init" there and re-run this install; stage expansion falls back to its per-stage path until then`,
    };
  }

  const target = join(projectRoot, ".beads", "formulas", PIPELINE_FORMULA_FILE);
  const content = await readFile(source, "utf-8");

  if (await isFile(target)) {
    const existing = await readFile(target, "utf-8");
    if (existing === content) {
      return {
        action: "unchanged",
        path: target,
        message: `Pipeline formula already current → ${target} (an untracked file: .beads/formulas/ is not gitignored)`,
      };
    }
  }

  if (dryRun) {
    return {
      action: "planned",
      path: target,
      message: `Would copy the pipeline formula → ${target} (an untracked file: .beads/formulas/ is not gitignored)`,
    };
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  return {
    action: "written",
    path: target,
    message: `Copied the pipeline formula → ${target} (an untracked file: .beads/formulas/ is not gitignored)`,
  };
}
