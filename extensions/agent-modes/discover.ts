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
 *   2. `{{CAPABILITY:key}}` and `{{PATH:key}}` are substituted against the pi column
 *      of token-map.json, with the plugin root resolved from the actual extension
 *      location (installers must compute it from the real resolution, per the
 *      token-map notes — a hardcoded `~/.pi/...` literal would break checkout
 *      and symlinked installs).
 *
 * Flat `agents/*.agent.md` files are parsed as a fallback for agents that have
 * no composable directory (a staged pi package ships flat renders, and a
 * hand-written agent may be a single flat file). A composable directory always
 * wins over its flat counterpart.
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
  /**
   * PI tool names to enable, or the single sentinel `ALL_TOOLS` (`"*"`) meaning
   * every tool the session has. The sentinel is resolved at activation, not here,
   * because only pi knows the session's tool set.
   */
  tools: string[];
  /** Full agent body (the system prompt to inject) */
  prompt: string;
}

export type HarnessId = "claude" | "pi";

export interface PathSpec {
  base: string;
  relative: string;
}

/**
 * One harness's binding for a capability: its name there, and what the harness
 * actually exposes. A `tool` is model-callable and may appear in a tool list; a
 * `command` is invoked directly by the user or agent and may not.
 */
export interface CapabilityBinding {
  name: string;
  type: "tool" | "command";
}

/** Shape of token-map.json (see the file at the package root). */
export interface TokenMap {
  capabilities: Record<string, Record<HarnessId, CapabilityBinding | null>>;
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
 * The one sentinel an authored tool list may carry instead of tool names: it
 * means every tool the session has, connectors included (agents/README.md).
 * Authored frontmatter stays strict — `"*"` is only meaningful alone.
 */
export const ALL_TOOLS = "*";

/**
 * True when one authored entry names the all-tools sentinel.
 *
 * Padding is ignored: `"* "` and `" *"` are the sentinel. The installers
 * (scripts/lib/compose-agent.mjs) compare the same authored value the same way,
 * so one value cannot be a padded tool name here and the sentinel there.
 */
function isAllToolsEntry(tool: string): boolean {
  return tool.trim() === ALL_TOOLS;
}

/** True when a resolved tool list is the all-tools sentinel. */
export function isAllTools(tools: readonly string[]): boolean {
  return tools.length === 1 && isAllToolsEntry(tools[0]);
}

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
    return parsed.capabilities && parsed.paths ? (parsed as TokenMap) : null;
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
 * With token-map.json: capability keys are translated via the pi column; a null
 * binding means PI has no equivalent for that capability and the entry is
 * omitted; a name that is not a capability key passes through untouched (it may
 * be a native PI tool such as `fetch_content`). A binding whose type is
 * `command` is a hard error naming the canonical key — a command is not
 * model-callable, so resolving one into the list would enable a tool pi never
 * offers, and dropping it silently is the omission this map exists to catch.
 * Without the map, the built-in COPILOT_TO_PI fallback applies and unknown names
 * pass through.
 */
function translateTools(raw: unknown, tokenMap: TokenMap | null, agentId: string): string[] {
  if (!Array.isArray(raw)) return [];

  const out = new Set<string>();
  for (const t of raw) {
    if (typeof t !== "string" || t === "") continue;

    // The all-tools sentinel is not a tool name and has no per-harness
    // equivalent, so it passes through untouched for the activation step to
    // resolve. Without this branch the fallback map would still pass it through,
    // but only by accident of it not being a canonical key. The entry is
    // normalised, so a padded sentinel cannot survive as a tool name.
    if (isAllToolsEntry(t)) {
      out.add(ALL_TOOLS);
      continue;
    }

    if (tokenMap) {
      const mapping = tokenMap.capabilities[t];
      if (mapping === undefined) {
        out.add(t); // not a capability key — pass through (may be a native PI tool)
      } else if (mapping[PI] === null) {
        console.warn(`[agent-modes] Capability "${t}" has no PI equivalent — omitted from the tool set`);
      } else if (mapping[PI]!.type === "command") {
        throw new Error(
          `capability "${t}" is a pi command (${mapping[PI]!.name}) and cannot appear in agent "${agentId}"'s tool list — a command is not model-callable`,
        );
      } else {
        out.add(mapping[PI]!.name);
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
 * Substitution order follows the token-map contract: SECTION, then CAPABILITY,
 * then PATH. Section files resolve from `<agentDir>/pi/<name>.md`; missing sections
 * and null-mapped capabilities drop the token with a warning so the prompt never
 * ships literal token syntax.
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

  // 2. {{CAPABILITY:key}} → capabilities[key].pi.name (null mapping drops the token)
  body = body.replace(/\{\{CAPABILITY:([^}]+)\}\}/g, (_token, key: string) => {
    const mapping = tokenMap?.capabilities?.[key];
    if (mapping === undefined) {
      console.warn(`[agent-modes] Unknown capability token {{CAPABILITY:${key}}} in agent "${id}" — token dropped`);
      return "";
    }
    const binding = mapping[PI];
    if (binding === null) {
      console.warn(`[agent-modes] Capability token {{CAPABILITY:${key}}} has no PI equivalent in agent "${id}" — token dropped`);
      return "";
    }
    return binding.name;
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
    const tools = translateTools(fm.tools, tokenMap, id);
    // The composable schema requires a non-empty list, so `ALL_TOOLS` survives
    // translation as `["*"]` and is resolved at activation. An unparseable
    // frontmatter yields an empty list here and keeps the conservative
    // DEFAULT_TOOLS: a corrupt file must never become "everything".
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
  /**
   * Whether a frontmatter block was found and delimited. `false` means the file
   * could not be parsed, which must not be read as "no tools key": an absent
   * key is meaningful on the flat path (see readFlatAgent).
   */
  frontmatterParsed: boolean;
}

/**
 * Split a scalar `tools` value into tool names.
 *
 * Accepts the quoted string the pi installer renders (`tools: "bash, read"`)
 * as well as an unquoted whitespace-separated list (`tools: bash read`).
 * Commas alone are not enough: a whitespace-separated list would collapse to
 * one bogus name and the agent would run with no usable tool allowlist.
 */
function splitToolList(raw: string): string[] {
  return raw
    .replace(/^["']|["']$/g, "")
    .split(/[,\s]+/)
    .filter(Boolean);
}

function parseFlatFrontmatter(raw: string): FlatParsed {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") return { prompt: raw, frontmatterParsed: false };

  // Find closing ---
  let sep = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      sep = i;
      break;
    }
  }
  if (sep === -1) return { prompt: raw, frontmatterParsed: false };

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
  // Supports three formats:
  //   tools: ["bash", "view"]          (JSON array, single line)
  //   tools: "bash, view"              (scalar list, comma or whitespace separated)
  //   tools:                           (YAML list, subsequent lines)
  //     - bash
  //     - view
  //
  // The scalar form is what the pi installer renders for generated agents, so
  // it must be read here rather than dropped to DEFAULT_TOOLS (which lifts the
  // restriction instead of applying it).
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
        tools = splitToolList(val);
        continue;
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

  return { name, description, tools, prompt, frontmatterParsed: true };
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
  // The flat path's asymmetry with the composable path is deliberate. A flat
  // file is generated by the installers, and they omit the `tools:` line exactly
  // when the resolved list is ["*"], so an absent key means every tool the
  // session has. Strictness stays where a human types: the composable schema
  // requires the key. A file whose frontmatter cannot be parsed, or whose list
  // is present but empty, keeps the conservative DEFAULT_TOOLS so a corrupt file
  // never becomes "everything".
  //
  // A capability bound to a command is a defect in the file, not a reason to
  // disable every mode in the session, so the error is reported and the one
  // agent is skipped — never the entry dropped, which would hide it.
  let tools: string[];
  try {
    tools = parsed.frontmatterParsed
      ? parsed.tools === undefined
        ? [ALL_TOOLS]
        : translateTools(parsed.tools, tokenMap, id)
      : [...DEFAULT_TOOLS];
  } catch (err) {
    console.warn(`[agent-modes] Skipping agent "${id}": ${err instanceof Error ? err.message : err}`);
    return null;
  }

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
 * the primary source. Flat `*.agent.md` files (a staged package's renders, or a
 * hand-written agent) are read only when no composable directory exists for that agent id. When
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