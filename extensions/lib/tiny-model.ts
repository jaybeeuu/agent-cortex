/**
 * Shared helpers for making cheap LLM calls from extensions.
 *
 * Reads a `tinyModel` config key from settings.json (global + project merged)
 * and provides functions for session naming and response summarization using
 * the configured model — typically the tiniest free model available.
 *
 * Config (in ~/.pi/agent/settings.json or .pi/settings.json):
 * ```json
 * {
 *   "tinyModel": {
 *     "model": "opencode/mimo-v2.5-free",
 *     "maxNameLength": 50,
 *     "maxSummaryLength": 100
 *   }
 * }
 * ```
 */

import { complete } from "@earendil-works/pi-ai";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { Model, Api } from "@earendil-works/pi-ai";

/* ── Types ── */

export interface TinyModelConfig {
  /** Provider/id string, e.g. "opencode/mimo-v2.5-free" */
  model: string;
  /** Global on/off toggle */
  enabled: boolean;
  /** Max characters for auto-generated session names */
  maxNameLength: number;
  /** Max characters for response summaries in notifications */
  maxSummaryLength: number;
}

const DEFAULT_CONFIG: TinyModelConfig = {
  model: "opencode/mimo-v2.5-free",
  enabled: true,
  maxNameLength: 40,
  maxSummaryLength: 100,
};

/* ── Config loading ── */

/**
 * Load tiny-model config from merged global + project settings.
 *
 * Project .pi/settings.json overrides global ~/.pi/agent/settings.json.
 */
export function loadTinyModelConfig(cwd?: string): TinyModelConfig {
  const paths = [join(homedir(), ".pi", "agent", "settings.json")];
  if (cwd) paths.push(join(cwd, ".pi", "settings.json"));

  const merged: Record<string, any> = {};

  for (const filePath of paths) {
    try {
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?.tinyModel && typeof parsed.tinyModel === "object") {
          Object.assign(merged, parsed.tinyModel);
        }
      }
    } catch {
      // skip unreadable or invalid settings files
    }
  }

  return { ...DEFAULT_CONFIG, ...merged } as TinyModelConfig;
}

/**
 * Parse a "provider/id" string into its parts.
 */
export function parseModelString(modelStr: string): {
  provider: string;
  id: string;
} {
  const slash = modelStr.indexOf("/");
  if (slash === -1) return { provider: "opencode", id: modelStr };
  return {
    provider: modelStr.slice(0, slash),
    id: modelStr.slice(slash + 1),
  };
}

/* ── LLM helpers ── */

type ModelAny = Model<Api>;
type CompleteOptions = Record<string, any>;

/**
 * Generate a concise session title from the user's first prompt.
 *
 * Calls the configured tiny model with a system prompt tuned for naming.
 * Returns null on failure (caller should fall back to truncation).
 */
export async function generateNameFromPrompt(
  model: ModelAny,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  prompt: string,
  maxLength: number,
): Promise<string | null> {
  const systemPrompt = [
    "You are a session naming assistant. Generate a concise title for a coding session.",
    "",
    "Rules:",
    "- Output ONLY the title, no quotes, no prefix, no explanation",
    `- Maximum ${maxLength} characters`,
    "- Summarize intent, do not copy verbatim",
    "- Keep it short (3\u20135 words), capture the general theme",
    "- If the message mentions files or modules, keep the key names brief",
  ].join("\n");

  const truncated = prompt.length > 2000 ? prompt.slice(0, 2000) + "..." : prompt;

  try {
    const options: CompleteOptions = { maxTokens: 64 };
    if (apiKey) options.apiKey = apiKey;
    if (headers) options.headers = headers;

    const result = await complete(model, {
      systemPrompt,
      messages: [{ role: "user", content: truncated, timestamp: Date.now() }],
    }, options);

    const text = result.content
      ?.filter((b: any): b is { type: "text"; text: string } => b.type === "text")
      ?.map((b) => b.text)
      ?.join("")
      ?.trim() ?? "";

    return cleanTitle(text, maxLength);
  } catch {
    return null;
  }
}

/**
 * Summarize an assistant response into a one-line summary.
 *
 * Calls the configured tiny model. Returns null on failure.
 */
export async function summarizeResponseText(
  model: ModelAny,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  responseText: string,
  maxLength: number,
): Promise<string | null> {
  const systemPrompt = [
    "Summarize what the AI assistant did in this coding session response.",
    "Be concise — one short sentence or phrase.",
    `Maximum ${maxLength} characters.`,
    "Focus on what changed or was accomplished.",
    "Output ONLY the summary, no quotes, no prefix, no explanation.",
  ].join("\n");

  const truncated =
    responseText.length > 2000 ? responseText.slice(0, 2000) + "..." : responseText;

  try {
    const options: CompleteOptions = { maxTokens: 64 };
    if (apiKey) options.apiKey = apiKey;
    if (headers) options.headers = headers;

    const result = await complete(model, {
      systemPrompt,
      messages: [{ role: "user", content: truncated, timestamp: Date.now() }],
    }, options);

    const text = result.content
      ?.filter((b: any): b is { type: "text"; text: string } => b.type === "text")
      ?.map((b) => b.text)
      ?.join("")
      ?.trim() ?? "";

    return text || null;
  } catch {
    return null;
  }
}

/* ── Internal helpers ── */

function cleanTitle(raw: string, maxLength: number): string | null {
  let name = raw.trim();
  if (!name) return null;

  // Strip surrounding quotes if present
  if (
    (name.startsWith('"') && name.endsWith('"')) ||
    (name.startsWith("'") && name.endsWith("'"))
  ) {
    name = name.slice(1, -1);
  }

  // Collapse newlines
  name = name.replace(/\n/g, " ").trim();

  // Truncate
  if (name.length > maxLength) {
    name = name.slice(0, maxLength - 3) + "...";
  }

  return name || null;
}
