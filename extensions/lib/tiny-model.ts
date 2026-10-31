/**
 * The `tinyModel` config block shared by the extensions that used to call a
 * cheap side-model: session naming (auto-name) and response summaries (notify).
 *
 * Reads the key from settings.json (global + project merged):
 * ```json
 * {
 *   "tinyModel": {
 *     "enabled": true,
 *     "maxNameLength": 50,
 *     "maxSummaryLength": 100
 *   }
 * }
 * ```
 *
 * The model call itself is gone. It went through pi-ai's `complete()`, a value
 * import of pi's runtime, and that import stopped the extension loading outside
 * the agent-cortex checkout (see test/pi-extensions-load.test.mjs). An extension
 * has no model API of its own — pi's ExtensionAPI exposes the registry and the
 * active model, not a completion call — so both callers fall back to the
 * truncation they already used when the model failed. The `model` key is no
 * longer read and is ignored if present.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

/* ── Types ── */

export interface TinyModelConfig {
  /** Global on/off toggle */
  enabled: boolean;
  /** Max characters for generated session names */
  maxNameLength: number;
  /** Max characters for response summaries in notifications */
  maxSummaryLength: number;
}

const DEFAULT_CONFIG: TinyModelConfig = {
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
