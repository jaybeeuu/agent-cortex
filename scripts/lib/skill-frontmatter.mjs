// SKILL.md frontmatter validation, shared by `pnpm lint` (via
// scripts/check-skill-frontmatter.mjs) and its tests.
//
// PI reads a skill's frontmatter with `parse` from the `yaml` package and
// silently drops the skill when that parse throws — only a warning diagnostic
// is emitted. A skill whose frontmatter is broken therefore disappears from the
// prompt with no visible failure. This module makes that failure loud: every
// SKILL.md must parse, declare a non-empty `name` and `description`, and keep
// the description within PI's 1024-character limit.
//
// Frontmatter extraction mirrors PI's parseFrontmatter (dist/utils/frontmatter.js)
// so the check rejects exactly what PI rejects.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse } from "yaml";

/** PI's maximum description length — a longer description is rejected. */
export const MAX_DESCRIPTION_LENGTH = 1024;

const SKILL_FILE = "SKILL.md";
const SKIPPED_DIRS = new Set([".git", "node_modules"]);

/**
 * Return the YAML text between the leading `---` delimiters, or null when the
 * document has no frontmatter block. Mirrors PI's extraction step, including
 * newline normalisation and BOM stripping.
 */
function extractYaml(content) {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return null;

  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return null;

  return normalized.slice(4, endIndex);
}

/** True when `value` is a string with at least one non-whitespace character. */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Validate one SKILL.md document.
 *
 * @param {string} content - Raw SKILL.md contents.
 * @returns {string[]} Human-readable problems; empty when the frontmatter is valid.
 */
export function validateSkillFrontmatter(content) {
  const yamlText = extractYaml(content);
  if (yamlText === null) {
    return ["frontmatter block is missing (expected '---' delimiters)"];
  }

  let frontmatter;
  try {
    frontmatter = parse(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "unknown parse error";
    return [`frontmatter is not valid YAML: ${message}`];
  }

  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return ["frontmatter is not a YAML mapping of name/description fields"];
  }

  const errors = [];
  if (!isNonEmptyString(frontmatter.name)) {
    errors.push("frontmatter is missing a non-empty name");
  }
  if (!isNonEmptyString(frontmatter.description)) {
    errors.push("frontmatter is missing a non-empty description");
  } else if (frontmatter.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${frontmatter.description.length})`,
    );
  }

  return errors;
}

/** Recursively collect every SKILL.md below `dir`, skipping vendored trees. */
async function findSkillFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      found.push(...(await findSkillFiles(full)));
    } else if (entry.isFile() && entry.name === SKILL_FILE) {
      found.push(full);
    }
  }

  return found;
}

/**
 * Validate every SKILL.md under `root`.
 *
 * @param {{ root: string }} options
 * @returns {Promise<{ checked: number, failures: Array<{ file: string, errors: string[] }> }>}
 *   `checked` counts the SKILL.md files examined; `failures` holds one entry per
 *   invalid file, with `file` relative to `root`.
 */
export async function checkSkills({ root }) {
  const files = await findSkillFiles(root);
  const failures = [];

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const errors = validateSkillFrontmatter(content);
    if (errors.length > 0) {
      failures.push({ file: relative(root, file), errors });
    }
  }

  return { checked: files.length, failures };
}
