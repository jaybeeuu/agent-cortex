// Shared composer: reads a composable agent directory (agents/<name>/) and emits
// the harness-specific agent content defined by agents/README.md. The Copilot
// generator (scripts/build-copilot-agents.mjs) and the Claude install-time generator
// (bin/installers/claude.mjs) compose from here, so the composable dirs are
// the single source of truth and the flat/generated files stay in lockstep.
//
// Composition per the agents/README.md contract:
//   1. {{SECTION:name}} is replaced with <dir>/<harness>/<name>.md content.
//   2. {{TOOL:key}} is replaced with the harness column of token-map.json.
//   3. {{PATH:arg}} with a named key resolves through token-map.json's paths
//      table; anything else is a relative path and stays verbatim.
// Substitution order is SECTION → TOOL → PATH (matches extensions/agent-modes).
// Missing sections, unknown tool keys, or schema-invalid frontmatter are hard
// errors: a committed generated file must never ship a literal token or a
// silently dropped section.
//
// Options (the pi installer passes `dropNullTools`, `pluginRoot` and
// `resolveRelativePaths`; the copilot generator and claude installer use the strict defaults):
//   dropNullTools          replace null-mapped tool tokens with an empty string and
//                          warn instead of throwing (pi's prose rule per the
//                          token-map contract)
//   pluginRoot             override the plugin_root used for resolved paths
//                          (installers compute it from the actual install layout)
//   resolveRelativePaths   non-keyed {{PATH:...}} args resolve to pluginRoot/arg
//                          instead of staying verbatim (install time; the build
//                          scripts leave them bare for Copilot CLI resolution)
//   warn                   callback for drop/omit warnings (default: no-op; the
//                          pi installer collects them into its result)
//
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** True when a path exists (stat succeeds). */
async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ─── Token substitution ──────────────────────────────────────────────────────

const TOOL_RE = /\{\{TOOL:([^}]+)\}\}/g;
const PATH_RE = /\{\{PATH:([^}]+)\}\}/g;

function noop() {}

/**
 * Substitute {{TOOL:...}} and {{PATH:...}} tokens in arbitrary content (agent
 * bodies, skill files) against one harness column of token-map.json.
 *
 * - TOOL: unknown key → throw (the map must stay complete); null mapping → drop
 *   with a warning when `dropNullTools`, otherwise throw.
 * - PATH: named key → resolve through the paths table (plugin_root overridable);
 *   non-keyed → join(pluginRoot, arg) when `resolveRelativePaths`, else verbatim.
 * - SECTION tokens are *not* handled here — the agent composer resolves them from
 *   the harness's section files before calling this.
 *
 * @param {string} content  Source text containing {{TOOL:...}}/{{PATH:...}} tokens
 * @param {string} harness  Harness id: "copilot" | "claude" | "pi"
 * @param {object} tokenMap Parsed token-map.json (from loadTokenMap)
 * @param {object} options  { dropNullTools, pluginRoot, resolveRelativePaths, warn, context }
 * @returns {string}
 */
export function substituteTokens(content, harness, tokenMap, options = {}) {
  const { dropNullTools = false, pluginRoot, resolveRelativePaths = false, warn = noop, context = "" } = options;
  const ctx = context ? `${context}: ` : "";

  // 2. {{TOOL:key}} → token-map.json tools.<key>.<harness>
  content = content.replace(TOOL_RE, (_token, key) => {
    const entry = tokenMap.tools[key];
    if (!entry) throw new Error(`${ctx}unknown tool token {{TOOL:${key}}} — extend token-map.json`);
    const mapped = entry[harness];
    if (mapped == null) {
      if (dropNullTools) {
        warn(`tool token {{TOOL:${key}}} has no ${harness} mapping — dropped`);
        return "";
      }
      throw new Error(`${ctx}tool token {{TOOL:${key}}} has no ${harness} mapping (null) — drop the token in agent.md first`);
    }
    return mapped;
  });

  // 3. {{PATH:arg}} → named keys via token-map.json paths; relative paths verbatim
  //    (or resolved against pluginRoot when the installer option is set)
  content = content.replace(PATH_RE, (_token, arg) =>
    resolvePath(arg, harness, tokenMap, { pluginRoot, resolveRelativePaths }),
  );

  return content;
}

/**
 * Compose the harness-specific agent content from a composable agent directory.
 *
 * @param {string} root    Package root (contains agents/ and token-map.json)
 * @param {string} name    Agent directory name (e.g. "ralph", "plan")
 * @param {string} harness Harness id: "copilot" | "claude" | "pi"
 * @returns {{ name: string, description: string, tools: string[], model?: string, argumentHint?: string, body: string }}
 */
export async function composeAgent(root, name, harness, options = {}) {
  const { dropNullTools = false, pluginRoot, resolveRelativePaths = false, warn = noop } = options;
  const agentDir = join(root, "agents", name);
  const frontmatter = await parseFrontmatter(join(agentDir, harness, "frontmatter.json"), name, harness);
  const tokenMap = await loadTokenMap(root);

  let body = await readFile(join(agentDir, "agent.md"), "utf-8");

  // 1. {{SECTION:name}} → <harness>/<name>.md (may itself contain TOOL/PATH
  //    tokens). Single pass over the original body — inserted section content
  //    is never rescanned (same semantics as the sync replace()).
  const sectionRe = /\{\{SECTION:([^}]+)\}\}/g;
  let out = "";
  let last = 0;
  for (let m = sectionRe.exec(body); m; m = sectionRe.exec(body)) {
    const section = m[1];
    const sectionPath = join(agentDir, harness, `${section}.md`);
    if (!(await pathExists(sectionPath))) {
      throw new Error(`agent "${name}": missing section "${section}" for harness "${harness}" (${sectionPath})`);
    }
    out += body.slice(last, m.index) + (await readFile(sectionPath, "utf-8")).trim();
    last = m.index + m[0].length;
  }
  body = out + body.slice(last);

  // 2. + 3. TOOL/PATH substitution (contextualised for error messages)
  body = substituteTokens(body, harness, tokenMap, {
    dropNullTools,
    pluginRoot,
    resolveRelativePaths,
    warn,
    context: `agent "${name}"`,
  });

  return { ...frontmatter, body: body.trim() };
}

// ─── Frontmatter ─────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ["name", "description", "tools"];
const KNOWN_OPTIONAL_FIELDS = ["model", "argumentHint"];

/** Parse and schema-check a harness frontmatter.json (strict, per agents/README.md). */
async function parseFrontmatter(path, name, harness) {
  const raw = await readFile(path, "utf-8");
  let fm;
  try {
    fm = JSON.parse(raw);
  } catch (err) {
    throw new Error(`agent "${name}": invalid JSON in ${path}: ${err.message}`);
  }
  if (typeof fm !== "object" || fm === null) {
    throw new Error(`agent "${name}": ${path} must be a JSON object`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in fm)) throw new Error(`agent "${name}": ${path} missing required field "${field}" (harness ${harness})`);
  }
  if (typeof fm.name !== "string" || fm.name.trim() === "") throw new Error(`agent "${name}": ${path} name must be a non-empty string`);
  if (typeof fm.description !== "string" || fm.description.trim() === "") throw new Error(`agent "${name}": ${path} description must be a non-empty string`);
  if (!Array.isArray(fm.tools) || fm.tools.length === 0 || !fm.tools.every((t) => typeof t === "string")) {
    throw new Error(`agent "${name}": ${path} tools must be a non-empty array of strings`);
  }
  for (const key of Object.keys(fm)) {
    if (![...REQUIRED_FIELDS, ...KNOWN_OPTIONAL_FIELDS].includes(key)) {
      throw new Error(`agent "${name}": ${path} unknown field "${key}" — strict schema per agents/README.md`);
    }
  }
  return {
    name: fm.name,
    description: fm.description,
    tools: fm.tools,
    ...(typeof fm.model === "string" ? { model: fm.model } : {}),
    ...(typeof fm.argumentHint === "string" ? { argumentHint: fm.argumentHint } : {}),
  };
}

// ─── Path resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a {{PATH:...}} argument for a harness's generated output.
 * Named keys resolve through token-map.json's paths table (recursively for
 * {base, relative} specs); non-keyed args are relative paths, kept verbatim —
 * the installer beads own precise runtime path resolution (see token-map.README.md).
 * With the installer options (`pluginRoot`, `resolveRelativePaths`) the
 * plugin_root base and bare relative paths resolve against the actual install
 * layout instead.
 */
function resolvePath(arg, harness, tokenMap, opts = {}) {
  const entry = tokenMap.paths?.[arg];
  if (!entry) {
    if (opts.resolveRelativePaths && opts.pluginRoot) return join(opts.pluginRoot, arg);
    return arg;
  }

  const spec = entry[harness];
  if (typeof spec === "string") {
    if (arg === "plugin_root" && opts.pluginRoot) return opts.pluginRoot;
    return spec;
  }
  if (spec && typeof spec === "object" && typeof spec.base === "string" && typeof spec.relative === "string") {
    return join(resolvePath(spec.base, harness, tokenMap, opts), spec.relative);
  }
  throw new Error(`unresolvable {{PATH:${arg}}} for harness "${harness}" — extend token-map.json`);
}

/**
 * Translate a frontmatter tool list into one harness's tool names.
 *
 * Canonical keys resolve through token-map.json's tools table; a null mapping
 * means the harness has no equivalent and the entry is omitted (the contract's
 * tool-list rule); a name that is not a canonical key passes through untouched
 * (it may be a native tool, e.g. pi's fetch_content). Mirrors the runtime
 * translation in extensions/agent-modes/discover.ts.
 *
 * @param {string[]} tools  Canonical tool names from a harness frontmatter.json
 * @param {object} tokenMap Parsed token-map.json (from loadTokenMap)
 * @param {string} harness  Harness id: "copilot" | "claude" | "pi"
 * @param {object} options  { warn }
 * @returns {string[]}
 */
export function translateToolList(tools, tokenMap, harness, { warn = noop } = {}) {
  const out = [];
  for (const tool of tools) {
    const mapping = tokenMap.tools[tool];
    if (mapping === undefined) {
      out.push(tool);
      continue;
    }
    const mapped = mapping[harness];
    if (mapped == null) {
      warn(`tool "${tool}" has no ${harness} mapping — omitted from the tool list`);
      continue;
    }
    out.push(mapped);
  }
  return out;
}

// ─── Token map ───────────────────────────────────────────────────────────────

/** Load token-map.json from the package root; missing/incomplete maps hard-fail. */
export async function loadTokenMap(root) {
  const path = join(root, "token-map.json");
  let raw;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new Error(`missing ${path} — the composer requires token-map.json`);
  }
  const parsed = JSON.parse(raw);
  if (!parsed.tools || !parsed.paths) {
    throw new Error(`${path}: expected "tools" and "paths" tables`);
  }
  return parsed;
}