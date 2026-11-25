// @ts-check
// Validator for the composable agent directory layout: `agent.md`, an authored
// `tools.json` tool set, and at least one harness subdirectory with a valid
// `frontmatter.json`.
//
// Repo tooling, not a shipped skill: the composable layout exists only in this
// repository's `agents/` tree, and installs carry flat rendered agents. Run the
// test suite at `test/validate-agent-dir.test.mjs`.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isDirectory, isFile } from "./lib/fs.mjs";
import { ALL_TOOLS, isAllToolsEntry } from "./lib/compose-agent.mjs";
import { skillEntryExists } from "./lib/tool-coverage.mjs";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Frontmatter
 * @property {string} name
 * @property {string} description
 * @property {string} [model]
 * @property {string} [argumentHint]
 */

/**
 * @typedef {object} ToolSet
 * @property {string[]} tools
 * @property {string[]} skills
 */

/**
 * @typedef {object} AgentDir
 * @property {string} name
 * @property {string} agentMdPath
 * @property {Map<string, { frontmatter: Frontmatter, sections: string[] }>} harnesses
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} ok
 * @property {string[]} errors
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** @type {readonly string[]} */
const REQUIRED_FIELDS = ["name", "description"];
/** @type {readonly string[]} */
const KNOWN_OPTIONAL_FIELDS = ["model", "argumentHint"];
/** @type {readonly string[]} */
const TOOL_SET_FIELDS = ["tools", "skills"];

/**
 * The one sentinel a `tools` list may carry instead of tool names: it means
 * every tool the session has (agents/README.md). It cannot be combined with
 * tool names, because each installer resolves it by omitting the `tools:` line.
 * Both the sentinel and its padded comparison (`isAllToolsEntry`) come from
 * scripts/lib/compose-agent.mjs, so this validator, both installers and the
 * runtime all read one authored value the same way.
 */

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate one harness `frontmatter.json`. It carries harness metadata only: the
 * tool set is authored once, in `tools.json`, so a `tools` key here is rejected
 * rather than ignored — an ignored copy is the drift the authored set exists to
 * end.
 * @param {unknown} fm
 * @returns {ValidationResult}
 */
export function validateFrontmatter(fm) {
  /** @type {string[]} */
  const errors = [];

  if (typeof fm !== "object" || fm === null) {
    return { ok: false, errors: ["frontmatter must be an object"] };
  }

  const record = /** @type {Record<string, unknown>} */ (fm);

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in record)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  // Validate name
  if (typeof record.name === "string" && record.name.trim() === "") {
    errors.push("name must not be empty");
  }

  // Validate description
  if (typeof record.description === "string" && record.description.trim() === "") {
    errors.push("description must not be empty");
  }

  if ("tools" in record) {
    errors.push("carries tools — the tool set is authored once, in tools.json");
  }

  // Check for unknown fields
  const knownFields = new Set([...REQUIRED_FIELDS, ...KNOWN_OPTIONAL_FIELDS]);
  for (const key of Object.keys(record)) {
    if (!knownFields.has(/** @type {any} */ (key))) {
      errors.push(`unknown field: ${key}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate an authored `tools.json`: the agent's tool set, plus the skills whose
 * text the coverage check walks.
 * @param {unknown} toolSet
 * @returns {ValidationResult}
 */
export function validateToolSet(toolSet) {
  /** @type {string[]} */
  const errors = [];

  if (typeof toolSet !== "object" || toolSet === null) {
    return { ok: false, errors: ["tool set must be an object"] };
  }

  const record = /** @type {Record<string, unknown>} */ (toolSet);

  for (const field of TOOL_SET_FIELDS) {
    if (!(field in record)) errors.push(`missing required field: ${field}`);
  }

  if ("tools" in record) {
    if (!Array.isArray(record.tools)) {
      errors.push("tools must be an array");
    } else if (record.tools.length === 0) {
      errors.push("tools must not be empty");
    } else if (!record.tools.every((t) => typeof t === "string")) {
      errors.push("tools must be an array of strings");
    } else if (record.tools.length > 1 && record.tools.some(isAllToolsEntry)) {
      errors.push(`tools must be ["${ALL_TOOLS}"] or a list of tool names — "${ALL_TOOLS}" cannot be combined`);
    }
  }

  if ("skills" in record) {
    if (!Array.isArray(record.skills)) {
      errors.push("skills must be an array");
    } else if (!record.skills.every((s) => typeof s === "string")) {
      errors.push("skills must be an array of skill directory names");
    }
  }

  for (const key of Object.keys(record)) {
    if (!TOOL_SET_FIELDS.includes(/** @type {any} */ (key))) {
      errors.push(`unknown field: ${key}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @param {string} agentDirPath
 * @returns {Promise<ValidationResult>}
 */
export async function validateAgentDir(agentDirPath) {
  /** @type {string[]} */
  const errors = [];

  // Check agent.md exists
  const agentMdPath = join(agentDirPath, "agent.md");
  if (!(await isFile(agentMdPath))) {
    errors.push("missing agent.md");
  }

  // Check for at least one harness subdirectory with frontmatter.json
  if (!(await isDirectory(agentDirPath))) {
    return { ok: false, errors: ["agent directory does not exist"] };
  }

  // The tool set is authored once, beside agent.md. Its skills entries resolve
  // against the package root, two levels up from agents/<name>/.
  const toolSetPath = join(agentDirPath, "tools.json");
  if (!(await isFile(toolSetPath))) {
    errors.push("missing tools.json — the agent's tool set is authored once, beside agent.md");
  } else {
    try {
      const parsed = JSON.parse(await readFile(toolSetPath, "utf-8"));
      const result = validateToolSet(parsed);
      for (const err of result.errors) errors.push(`tools.json: ${err}`);
      if (result.ok) {
        const root = dirname(dirname(agentDirPath));
        for (const entry of /** @type {ToolSet} */ (parsed).skills) {
          if (!(await skillEntryExists(root, entry))) {
            errors.push(`tools.json: skills entry "${entry}" names no skill directory under skills/`);
          }
        }
      }
    } catch {
      errors.push("tools.json: invalid JSON");
    }
  }

  const entries = await readdir(agentDirPath);
  /** @type {string[]} */
  const harnessDirs = [];
  for (const entry of entries) {
    if (entry !== "node_modules" && (await isDirectory(join(agentDirPath, entry)))) {
      harnessDirs.push(entry);
    }
  }

  if (harnessDirs.length === 0) {
    errors.push("no harness subdirectories found (need at least one with frontmatter.json)");
  }

  // Validate each harness directory
  for (const harnessDir of harnessDirs) {
    const frontmatterPath = join(agentDirPath, harnessDir, "frontmatter.json");
    if (!(await isFile(frontmatterPath))) {
      continue; // Skip directories without frontmatter.json
    }

    try {
      const content = await readFile(frontmatterPath, "utf-8");
      const fm = JSON.parse(content);
      const result = validateFrontmatter(fm);
      if (!result.ok) {
        for (const err of result.errors) {
          errors.push(`${harnessDir}/frontmatter.json: ${err}`);
        }
      }
    } catch {
      errors.push(`${harnessDir}/frontmatter.json: invalid JSON`);
    }
  }

  return { ok: errors.length === 0, errors };
}
