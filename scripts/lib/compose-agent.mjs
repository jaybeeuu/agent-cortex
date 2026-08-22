// Shared composer: reads a composable agent directory (agents/<name>/) and emits
// the harness-specific agent content defined by agents/README.md. Both the
// Copilot generator (scripts/build-copilot-agents.mjs) and the Claude generator
// (scripts/build-claude-agents.mjs) compose from here, so the composable dirs are
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
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ─── Token substitution ──────────────────────────────────────────────────────

const TOKEN = /\{\{(SECTION|TOOL|PATH):([^}]+)\}\}/g;

/**
 * Compose the harness-specific agent content from a composable agent directory.
 *
 * @param {string} root    Package root (contains agents/ and token-map.json)
 * @param {string} name    Agent directory name (e.g. "ralph", "plan")
 * @param {string} harness Harness id: "copilot" | "claude"
 * @returns {{ name: string, description: string, tools: string[], argumentHint?: string, body: string }}
 */
export function composeAgent(root, name, harness) {
  const agentDir = join(root, "agents", name);
  const frontmatter = parseFrontmatter(join(agentDir, harness, "frontmatter.json"), name, harness);
  const tokenMap = loadTokenMap(root);

  let body = readFileSync(join(agentDir, "agent.md"), "utf-8");

  // 1. {{SECTION:name}} → <harness>/<name>.md (may itself contain TOOL/PATH tokens)
  body = body.replace(/\{\{SECTION:([^}]+)\}\}/g, (_token, section) => {
    const sectionPath = join(agentDir, harness, `${section}.md`);
    if (!existsSync(sectionPath)) {
      throw new Error(`agent "${name}": missing section "${section}" for harness "${harness}" (${sectionPath})`);
    }
    return readFileSync(sectionPath, "utf-8").trim();
  });

  // 2. {{TOOL:key}} → token-map.json tools.<key>.<harness>
  body = body.replace(/\{\{TOOL:([^}]+)\}\}/g, (_token, key) => {
    const entry = tokenMap.tools[key];
    if (!entry) throw new Error(`agent "${name}": unknown tool token {{TOOL:${key}}} — extend token-map.json`);
    const mapped = entry[harness];
    if (mapped == null) {
      throw new Error(`agent "${name}": tool token {{TOOL:${key}}} has no ${harness} mapping (null) — drop the token in agent.md first`);
    }
    return mapped;
  });

  // 3. {{PATH:arg}} → named keys via token-map.json paths; relative paths verbatim
  body = body.replace(/\{\{PATH:([^}]+)\}\}/g, (_token, arg) => resolvePath(arg, harness, tokenMap));

  return { ...frontmatter, body: body.trim() };
}

// ─── Frontmatter ─────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ["name", "description", "tools"];
const KNOWN_OPTIONAL_FIELDS = ["model", "argumentHint"];

/** Parse and schema-check a harness frontmatter.json (strict, per agents/README.md). */
function parseFrontmatter(path, name, harness) {
  const raw = readFileSync(path, "utf-8");
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
    ...(typeof fm.argumentHint === "string" ? { argumentHint: fm.argumentHint } : {}),
  };
}

// ─── Path resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a {{PATH:...}} argument for a harness's generated output.
 * Named keys resolve through token-map.json's paths table (recursively for
 * {base, relative} specs); non-keyed args are relative paths, kept verbatim —
 * the installer beads own precise runtime path resolution (see token-map.README.md).
 */
function resolvePath(arg, harness, tokenMap) {
  const entry = tokenMap.paths?.[arg];
  if (!entry) return arg;

  const spec = entry[harness];
  if (typeof spec === "string") return spec;
  if (spec && typeof spec === "object" && typeof spec.base === "string" && typeof spec.relative === "string") {
    return join(resolvePath(spec.base, harness, tokenMap), spec.relative);
  }
  throw new Error(`unresolvable {{PATH:${arg}}} for harness "${harness}" — extend token-map.json`);
}

// ─── Token map ───────────────────────────────────────────────────────────────

/** Load token-map.json from the package root; missing/incomplete maps hard-fail. */
export function loadTokenMap(root) {
  const path = join(root, "token-map.json");
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`missing ${path} — the composer requires token-map.json`);
  }
  const parsed = JSON.parse(raw);
  if (!parsed.tools || !parsed.paths) {
    throw new Error(`${path}: expected "tools" and "paths" tables`);
  }
  return parsed;
}