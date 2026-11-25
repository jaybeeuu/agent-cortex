// @ts-check
// Coverage check for one agent's authored tool set: every capability its own text
// names must be granted by that set, on every harness.
//
// The set lives once, in `agents/<name>/tools.json` (agents/README.md), and both
// harnesses render it. A set that omits a capability the agent's text instructs it
// to call is a mute agent: `{{CAPABILITY:peer_send}}` resolves to a name the
// harness never offers, and the agent reports the tool as unavailable. Nothing
// caught that before, so this check walks the text that names tools and compares
// it with what the rendered list grants.
//
// Three rules decide what is required:
//   - a capability the harness maps to `null` is not required — the documented
//     no-counterpart case;
//   - a capability the harness maps to a `command` is not required — a command is
//     invoked, not called by the model, and may never appear in a tool list;
//   - a capability that is a `command` on the other harness is not required
//     either. One set renders for both harnesses, and the harness where the row
//     is a command refuses it in a tool list, so no shared set can grant it. Such
//     a row is prose-only, and the prose says what the session does without the
//     mechanism (skills/workflow/run-pipeline-stage/playbooks/post-merge.md is the
//     worked example).
//
// Async throughout: the repository bans `*Sync` calls outside extensions.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { isAllTools, loadToolSet } from "./compose-agent.mjs";

/** @typedef {import("./compose-agent.mjs").TokenMap} TokenMap */
/** @typedef {import("./compose-agent.mjs").CapabilityBinding} CapabilityBinding */

const HARNESSES = /** @type {const} */ (["claude", "pi"]);

const CAPABILITY_TOKEN_RE = /\{\{CAPABILITY:([^}]+)\}\}/g;

/**
 * One way an agent's tool set fails to cover its own text.
 * @typedef {object} CoverageViolation
 * @property {"ungranted" | "unknown-capability" | "unresolved-skill" | "missing-skill"} kind
 * @property {string} agent
 * @property {string} [capability] The canonical capability key the text names
 * @property {string} message Human-readable, naming the agent and the capability
 */

/**
 * Every `{{CAPABILITY:...}}` key named in a text, in first-seen order.
 * @param {string} text
 * @returns {string[]}
 */
export function collectCapabilityTokens(text) {
  /** @type {string[]} */
  const keys = [];
  for (const match of text.matchAll(CAPABILITY_TOKEN_RE)) {
    const key = match[1].trim();
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * True when token-map.json can grant a capability through a tool set that both
 * harnesses render: every harness either has no counterpart (`null`) or exposes
 * it as a model-callable tool. A row that is a command on either harness fails
 * the second test, because the render for that harness refuses it.
 * @param {Record<string, CapabilityBinding | null>} row
 * @returns {boolean}
 */
export function isGrantableThroughToolSet(row) {
  return HARNESSES.every((harness) => {
    const binding = row[harness];
    return binding == null || binding.type === "tool";
  });
}

/**
 * The authored skill directories an agent loads, resolved under the package's
 * `skills/` tree. Each entry is authored repo-relative and one group deep, e.g.
 * `workflow/ralph`.
 * @param {string} root
 * @param {string} entry
 * @returns {string}
 */
export function skillDirFor(root, entry) {
  return join(root, "skills", ...entry.split("/"));
}

/**
 * Whether a skill entry names a real skill directory in this package — a
 * directory holding a SKILL.md. A stale entry is a dead mapping: the coverage
 * check would otherwise walk nothing and pass.
 * @param {string} root
 * @param {string} entry
 * @returns {Promise<boolean>}
 */
export async function skillEntryExists(root, entry) {
  const dir = skillDirFor(root, entry);
  try {
    const entries = await readdir(dir);
    return entries.includes("SKILL.md");
  } catch {
    return false;
  }
}

/**
 * Every markdown file below `dir`, absolute, sorted for a stable report.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function markdownFiles(dir) {
  /** @type {string[]} */
  const files = [];
  /** @type {import("node:fs").Dirent[]} */
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

/**
 * The authored text an agent reads on one harness: its shared body, that
 * harness's section files, and every markdown file of every skill it loads.
 * @param {{ root: string, agentName: string, harness: "claude" | "pi", skills: string[] }} options
 * @returns {Promise<{ file: string, text: string }[]>}
 */
export async function agentTextSources({ root, agentName, harness, skills }) {
  const agentDir = join(root, "agents", agentName);
  /** @type {string[]} */
  const files = [join(agentDir, "agent.md"), ...(await markdownFiles(join(agentDir, harness)))];
  for (const entry of skills) files.push(...(await markdownFiles(skillDirFor(root, entry))));
  /** @type {{ file: string, text: string }[]} */
  const sources = [];
  for (const file of files) {
    try {
      sources.push({ file: relative(root, file), text: await readFile(file, "utf-8") });
    } catch {
      // A missing agent.md or section file is the validator's finding, not this
      // check's: the coverage question is which capabilities the text names.
    }
  }
  return sources;
}

/**
 * Check one agent on one harness: every capability its text names that this
 * harness can call must be granted by the rendered tool list.
 *
 * `rendered` is the tool list the harness actually received, read from the staged
 * install. `null` means the rendered frontmatter carried no `tools:` line, which
 * both installers emit for the all-tools sentinel — the list grants everything.
 *
 * @param {{
 *   root: string,
 *   agentName: string,
 *   harness: "claude" | "pi",
 *   tokenMap: TokenMap,
 *   rendered: string[] | null,
 * }} options
 * @returns {Promise<{ violations: CoverageViolation[], required: string[], skills: string[] }>}
 */
export async function checkToolCoverage({ root, agentName, harness, tokenMap, rendered }) {
  const authored = await loadToolSet(root, agentName);
  /** @type {CoverageViolation[]} */
  const violations = [];

  // A stale skills entry is a finding on its own: the check would walk nothing
  // and report success for a mapping that resolves to no text at all.
  for (const entry of authored.skills) {
    if (!(await skillEntryExists(root, entry))) {
      violations.push({
        kind: "unresolved-skill",
        agent: agentName,
        message: `agent "${agentName}": skills entry "${entry}" names no skill directory under skills/`,
      });
    }
  }

  const sources = await agentTextSources({ root, agentName, harness, skills: authored.skills });
  const named = sources.flatMap((source) => collectCapabilityTokens(source.text));

  // The sentinel grants every tool, so no capability can be missing. A nil
  // render is the sentinel after both installers omitted the line.
  const granted = rendered === null || isAllTools(rendered) ? null : new Set(rendered);

  /** @type {string[]} */
  const required = [];
  for (const key of [...new Set(named)]) {
    const row = tokenMap.capabilities[key];
    if (row === undefined) {
      violations.push({
        kind: "unknown-capability",
        agent: agentName,
        capability: key,
        message: `agent "${agentName}": {{CAPABILITY:${key}}} is not a capability — extend token-map.json`,
      });
      continue;
    }
    const binding = row[harness];
    if (binding == null || binding.type !== "tool" || !isGrantableThroughToolSet(row)) continue;
    required.push(key);
    if (granted && !granted.has(binding.name)) {
      violations.push({
        kind: "ungranted",
        agent: agentName,
        capability: key,
        message:
          `agent "${agentName}" names {{CAPABILITY:${key}}} in its own text, but its ${harness} tool list ` +
          `grants no "${binding.name}" — add "${key}" to agents/${agentName}/tools.json`,
      });
    }
  }

  return { violations, required, skills: authored.skills };
}
