/**
 * Auto-name sessions from the first user prompt.
 *
 * On the first prompt of a new session, names the session with a trimmed
 * version of that prompt, then sets it via pi.setSessionName(). Existing names
 * (set via --name or /name) are never overwritten.
 *
 * The name used to come from a cheap side-model, which needed pi-ai's
 * `complete()` — a value import that stopped this extension loading outside the
 * agent-cortex checkout (see test/pi-extensions-load.test.mjs). The truncation
 * that already served as its fallback is now the only path; `tinyModel.enabled`
 * still turns naming off entirely.
 *
 * Config (in settings.json under `tinyModel`):
 * ```json
 * {
 *   "tinyModel": {
 *     "enabled": true,
 *     "maxNameLength": 50
 *   }
 * }
 * ```
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadTinyModelConfig } from "./lib/tiny-model.js";
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

  pi.on("input", async (event, _ctx) => {
    if (!config.enabled || hasNamed) return;
    if (event.source === "rpc") return;
    if (pi.getSessionName()) {
      hasNamed = true;
      return;
    }
    if (!event.text?.trim()) return;

    hasNamed = true;
    nameFromPrompt(event.text, config.maxNameLength, pi);
  });
}

/**
 * Name the session with the first line of the prompt, truncated to `maxLength`.
 */
function nameFromPrompt(
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
