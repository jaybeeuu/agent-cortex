/**
 * Auto-name sessions using a tiny side-agent LLM.
 *
 * On the first user prompt of a new session, calls a cheap configured model
 * (default: opencode/mimo-v2.5-free) to generate a concise session title,
 * then sets it via pi.setSessionName(). Falls back to simple truncation if
 * the LLM call fails.
 *
 * Config (in settings.json under `tinyModel`):
 * ```json
 * {
 *   "tinyModel": {
 *     "model": "opencode/mimo-v2.5-free",
 *     "maxNameLength": 50
 *   }
 * }
 * ```
 *
 * Existing names (set via --name or /name) are never overwritten.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  loadTinyModelConfig,
  parseModelString,
  generateNameFromPrompt,
} from "./lib/tiny-model.js";
import type { TinyModelConfig } from "./lib/tiny-model.js";

export default function (pi: ExtensionAPI) {
  let config: TinyModelConfig;
  let hasNamed = false;

  pi.on("session_start", async (_event, ctx) => {
    config = loadTinyModelConfig(ctx.cwd);
    hasNamed = false;

    // If session already has a name (resume, fork, or --name), skip
    if (pi.getSessionName()) {
      hasNamed = true;
    }
  });

  pi.on("input", async (event, ctx) => {
    if (!config.enabled || hasNamed) return;
    if (event.source === "rpc") return;
    if (pi.getSessionName()) {
      hasNamed = true;
      return;
    }
    if (!event.text?.trim()) return;

    hasNamed = true;

    // Fire the LLM call asynchronously — don't block the agent
    (async () => {
      try {
        const { provider, id } = parseModelString(config.model);
        const model = ctx.modelRegistry.find(provider, id);
        if (!model) {
          // Model not found; fall back to truncation
          fallbackName(event.text, config.maxNameLength, pi);
          return;
        }

        const { apiKey, headers } =
          await ctx.modelRegistry.getApiKeyAndHeaders(model);

        const name = await generateNameFromPrompt(
          model,
          apiKey,
          headers,
          event.text,
          config.maxNameLength,
        );

        if (name) {
          pi.setSessionName(name);
        } else {
          fallbackName(event.text, config.maxNameLength, pi);
        }
      } catch (err) {
        console.warn("[auto-name] LLM call failed, falling back:", err);
        fallbackName(event.text, config.maxNameLength, pi);
      }
    })();
  });
}

/**
 * Fallback: truncate the first line of the prompt to use as a session name.
 */
function fallbackName(
  text: string,
  maxLength: number,
  pi: ExtensionAPI,
): void {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  if (!firstLine) return;

  const name =
    firstLine.length > maxLength
      ? firstLine.slice(0, maxLength - 1) + "\u2026"
      : firstLine;

  pi.setSessionName(name);
}
