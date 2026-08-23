import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Agent discovery for the agent-modes extension.
 *
 * Agents are read from the composable source format (`agents/<name>/agent.md` +
 * `agents/<name>/pi/frontmatter.json`) — the canonical layout defined in
 * agents/README.md. The PI system prompt is composed per the token-map.json
 * contract:
 *
 *   1. `{{SECTION:name}}` is resolved from the agent's `pi/<name>.md` section file.
 *   2. `{{TOOL:key}}` and `{{PATH:key}}` are substituted against the pi column of
 *      token-map.json, with the plugin root resolved from the actual extension
 *      location (installers must compute it from the real resolution, per the
 *      token-map notes — a hardcoded `~/.pi/...` literal would break checkout
 *      and symlinked installs).
 *
 * Flat `agents/*.agent.md` files are parsed as a fallback for agents that have
 * no composable directory (they are generated output for Copilot, so they may
 * exist for any agent). A composable directory always wins over its flat
 * counterpart.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentDef {
  /** Lowercase id derived from the directory/file name (e.g. "ralph", "ralph-plan") */
  id: string;
  /** Display name from frontmatter or prettified id */
  name: string;
  /** Description from frontmatter */
  description: string;
  /** Colour for the status indicator */
  color: ThemeColor;
  /** PI tool names to enable (empty = all tools) */
  tools: string[];
  /** Full agent body (the system prompt to inject) */
  prompt: string;
}

export type HarnessId = "copilot" | "claude" | "pi";

export interface PathSpec {
  base: string;
  relative: string;
}

/** Shape of token-map.json (see the file at the package root). */
export interface TokenMap {
  tools: Record<string, Record<HarnessId, string | null>>;
  paths: Record<string, Record<HarnessId, string | PathSpec>>;
}

const PI: HarnessId = "pi";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Mapping from agent id → colour for the status indicator. */
const AGENT_COLORS: Record<string, ThemeColor> = {
  ralph: "accent",
  "ralph-plan": "warning",
  strategy: "accent",
};

/** Modes with no tool restriction get the full default set. */
const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/**
 * Copilot CLI tool names → PI built-in tool names. Fallback translation used
 * when token-map.json is unavailable; token-map.json is the source of truth
 * when present.
 */
const COPILOT_TO_PI: Record<string, string[]> = {
  bash: ["bash"],
  view: ["read"],
  read: ["read"],
  edit: ["edit"],
  create: ["write"],
  write: ["write"],
  grep: ["grep"],
  rg: ["grep", "find"],
  glob: ["find", "ls"],
  find: ["find"],
  ls: ["ls"],
};

// ─── Read helpers ────────────────────────────────────────────────────────────

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Load token-map.json from the package root (sibling of the agents dir). */
export function loadTokenMap(agentsDir: string): TokenMap | null {
  try {
    const raw = readFileSync(join(agentsDir, "..", "token-map.json"), "utf-8");
    const parsed = JSON.parse(raw) as Partial<TokenMap>;
    return parsed.tools && parsed.paths ? (parsed as TokenMap) : null;
  } catch {
    return null;
  }
}

function prettifyId(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── Tool translation ────────────────────────────────────────────────────────

/**
 * Translate a frontmatter tool list into PI tool names.
 *
 * With token-map.json: canonical keys are translated via the pi column; a null
 * mapping means PI has no equivalent (ask_user, skill) and the entry is omitted;
 * a name that is not a canonical key passes through untouched (it may be a
 * native PI tool such as `fetch_content`). Without the map, the built-in
 * COPILOT_TO_PI fallback applies and unknown names pass through.
 */
function translateTools(raw: unknown, tokenMap: TokenMap | null): string[] {
  if (!Array.isArray(raw)) return [];

  const out = new Set<string>();
  for (const t of raw) {
    if (typeof t !== "string" || t === "") continue;

    if (tokenMap) {
      const mapping = tokenMap.tools[t];
      if (mapping === undefined) {
        out.add(t); // not a canonical key — pass through (may be a native PI tool)
      } else if (mapping[PI] === null) {
        console.warn(`[agent-modes] Tool "${t}" has no PI equivalent — omitted from the tool set`);
      } else {
        out.add(mapping[PI] as string);
      }
    } else {
      const fallback = COPILOT_TO_PI[t];
      if (fallback) {
        for (const f of fallback) out.add(f);
      } else {
        out.add(t);
      }
    }
  }
  return [...out].sort();
}

// ─── PATH token resolution ───────────────────────────────────────────────────

/**
 * Resolve a `{{PATH:...}}` argument for the pi harness.
 *
 * A named key resolves through token-map.json's `paths` table; the `plugin_root`
 * base is always overridden with the actual package root (the directory
 * containing `agents/`) because the map's literal only describes the default npm
 * install layout. Anything that is not a named key is treated as a relative path
 * under the package root.
 */
function resolvePathToken(arg: string, tokenMap: TokenMap | null, pluginRoot: string): string {
  const entry = tokenMap?.paths?.[arg];
  if (!entry) return join(pluginRoot, arg);

  const spec = entry[PI];
  if (typeof spec === "string") {
    return arg === "plugin_root" ? pluginRoot : spec; // ${ENV} literals left verbatim
  }
  if (spec && typeof spec === "object" && typeof spec.base === "string" && typeof spec.relative === "string") {
    const base = resolvePathToken(spec.base, tokenMap, pluginRoot);
    return join(base, spec.relative);
  }
  console.warn(`[agent-modes] Unresolvable {{PATH:${arg}}} — token dropped`);
  return "";
}

// ─── Prompt composition ──────────────────────────────────────────────────────

/**
 * Compose the PI system prompt for a composable agent directory.
 *
 * Substitution order follows the token-map contract: SECTION, then TOOL, then
 * PATH. Section files resolve from `<agentDir>/pi/<name>.md`; missing sections
 * and null-mapped tools drop the token with a warning so the prompt never ships
 * literal token syntax.
 */
function composePiPrompt(
  agentDir: string,
  id: string,
  tokenMap: TokenMap | null,
  pluginRoot: string,
): string {
  let body = readFileSync(join(agentDir, "agent.md"), "utf-8").trim();

  // 1. {{SECTION:name}} → content of pi/<name>.md
  body = body.replace(/\{\{SECTION:([^}]+)\}\}/g, (_token, name: string) => {
    const sectionPath = join(agentDir, "pi", `${name}.md`);
    if (!isFile(sectionPath)) {
      console.warn(`[agent-modes] Missing section "${name}" for agent "${id}" — token dropped`);
      return "";
    }
    return readFileSync(sectionPath, "utf-8").trim();
  });

  // 2. {{TOOL:key}} → tools[key].pi (null mapping drops the token)
  body = body.replace(/\{\{TOOL:([^}]+)\}\}/g, (_token, key: string) => {
    const mapping = tokenMap?.tools?.[key];
    if (mapping === undefined) {
      console.warn(`[agent-modes] Unknown tool token {{TOOL:${key}}} in agent "${id}" — token dropped`);
      return "";
    }
    if (mapping[PI] === null) {
      console.warn(`[agent-modes] Tool token {{TOOL:${key}}} has no PI equivalent in agent "${id}" — token dropped`);
      return "";
    }
    return mapping[PI] as string;
  });

  // 3. {{PATH:key-or-relative}} → resolved against the actual plugin root
  body = body.replace(/\{\{PATH:([^}]+)\}\}/g, (_token, arg: string) => resolvePathToken(arg, tokenMap, pluginRoot));

  return body;
}

// ─── Composable directory reading ────────────────────────────────────────────

interface Frontmatter {
  name?: string;
  description?: string;
  tools?: string[];
}

interface ComposableFrontmatter extends Frontmatter {
  name: string;
  description: string;
  tools: string[];
}

function parseFrontmatterJson(raw: string, id: string): ComposableFrontmatter {
  let fm: Record<string, unknown>;
  try {
    fm = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn(`[agent-modes] Invalid frontmatter.json for agent "${id}": ${err}`);
    return { name: prettifyId(id), description: "", tools: [] };
  }

  return {
    name: typeof fm.name === "string" && fm.name !== "" ? fm.name : prettifyId(id),
    description: typeof fm.description === "string" ? fm.description : "",
    tools: Array.isArray(fm.tools) ? (fm.tools.filter((t): t is string => typeof t === "string") as string[]) : [],
  };
}

function readComposableAgent(
  agentDir: string,
  id: string,
  tokenMap: TokenMap | null,
  pluginRoot: string,
): AgentDef | null {
  try {
    const fm = parseFrontmatterJson(readFileSync(join(agentDir, "pi", "frontmatter.json"), "utf-8"), id);
    const tools = translateTools(fm.tools, tokenMap);
    return {
      id,
      name: fm.name,
      description: fm.description,
      color: AGENT_COLORS[id] ?? "accent",
      tools: tools.length > 0 ? tools : [...DEFAULT_TOOLS],
      prompt: composePiPrompt(agentDir, id, tokenMap, pluginRoot),
    };
  } catch (err) {
    console.warn(`[agent-modes] Failed to read composable agent "${id}": ${err}`);
    return null;
  }
}

// ─── Flat file parsing (transitional fallback) ───────────────────────────────

interface FlatParsed {
  name?: string;
  description?: string;
  tools?: string[];
  prompt: string;
}

function parseFlatFrontmatter(raw: string): FlatParsed {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") return { prompt: raw };

  // Find closing ---
  let sep = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      sep = i;
      break;
    }
  }
  if (sep === -1) return { prompt: raw };

  const yamlLines = lines.slice(1, sep);
  const prompt = lines.slice(sep + 1).join("\n").trim();

  let name: string | undefined;
  let description: string | undefined;
  let tools: string[] | undefined;

  for (const line of yamlLines) {
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const val = trimmed.slice(colonIdx + 1).trim();

    if (key === "name") {
      name = val.replace(/^["']|["']$/g, "");
    } else if (key === "description") {
      description = val.replace(/^["']|["']$/g, "");
    }
  }

  // Parse tools from the tools frontmatter.
  // Supports two formats:
  //   tools: ["bash", "view"]        (JSON array, single line)
  //   tools:                         (YAML list, subsequent lines)
  //     - bash
  //     - view
  let inToolsBlock = false;
  for (const line of yamlLines) {
    const trimmed = line.trim();

    // Check for inline JSON array: tools: ["foo", "bar"]
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (key === "tools") {
        if (val.startsWith("[")) {
          try {
            tools = JSON.parse(val);
          } catch {
            // Malformed JSON — fall through
          }
          continue;
        }
        if (val === "[]" || val === "") {
          tools = [];
          continue;
        }
      }
    }

    // YAML block format: "tools:" on its own line, items on subsequent lines
    if (trimmed === "tools:") {
      inToolsBlock = true;
      if (!tools) tools = [];
      continue;
    }
    if (inToolsBlock) {
      if (line.startsWith("  ") || line.startsWith("\t") || trimmed.startsWith("- ")) {
        const item = trimmed.replace(/^- /, "").trim().replace(/^["']|["']$/g, "");
        if (item) {
          if (!tools) tools = [];
          tools.push(item);
        }
      } else if (trimmed !== "") {
        inToolsBlock = false;
      }
    }
  }

  return { name, description, tools, prompt };
}

function readFlatAgent(filePath: string, tokenMap: TokenMap | null): AgentDef | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    console.warn(`[agent-modes] Failed to read ${basename(filePath)}: ${err}`);
    return null;
  }

  const parsed = parseFlatFrontmatter(raw);
  const id = basename(filePath).replace(/\.agent\.md$/i, "").toLowerCase();
  const name = parsed.name || prettifyId(id);
  const tools = translateTools(parsed.tools, tokenMap);

  return {
    id,
    name,
    description: parsed.description || "",
    color: AGENT_COLORS[id] ?? "accent",
    tools: tools.length > 0 ? tools : [...DEFAULT_TOOLS],
    prompt: parsed.prompt || `You are ${name}. ${parsed.description || ""}`,
  };
}

// ─── Discovery ───────────────────────────────────────────────────────────────

/**
 * Discover agents from the agents directory.
 *
 * Composable directories (`<name>/agent.md` + `<name>/pi/frontmatter.json`) are
 * the primary source. Flat `*.agent.md` files (generated output for Copilot) are
 * read only when no composable directory exists for that agent id. When
 * `tokenMap` is omitted, token-map.json is loaded from the package root;
 * missing/unreadable maps fall back to the built-in copilot→pi translation.
 */
export function discoverAgents(agentsDir: string, tokenMap: TokenMap | null = null): AgentDef[] {
  if (!existsSync(agentsDir) || !statSync(agentsDir).isDirectory()) {
    console.warn(`[agent-modes] Agents directory not found: ${agentsDir}`);
    return [];
  }

  const map = tokenMap ?? loadTokenMap(agentsDir);
  const pluginRoot = join(agentsDir, "..");

  const entries = readdirSync(agentsDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const agents: AgentDef[] = [];
  const composableIds = new Set<string>();

  // 1. Composable directory format
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(agentsDir, entry.name);
    if (!isFile(join(dir, "agent.md")) || !isFile(join(dir, "pi", "frontmatter.json"))) continue;
    const id = entry.name.toLowerCase();
    const def = readComposableAgent(dir, id, map, pluginRoot);
    if (def) {
      composableIds.add(id);
      agents.push(def);
    }
  }

  // 2. Flat fallback for agents without a composable directory
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".agent.md")) continue;
    const id = entry.name.replace(/\.agent\.md$/i, "").toLowerCase();
    if (composableIds.has(id)) continue; // composable wins
    const def = readFlatAgent(join(agentsDir, entry.name), map);
    if (def) agents.push(def);
  }

  return agents;
}

export { DEFAULT_TOOLS };