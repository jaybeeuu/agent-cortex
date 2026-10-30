/**
 * Output Style Extension
 *
 * Appends the always-on reply shape to the PI system prompt on every turn: lead
 * with the action, write in Simplified Technical English (ASD-STE100), restate the
 * context the reader cannot remember (the second slice of
 * docs/ideas/improve-pi-system-prompt.md).
 *
 * The block is stable text appended after any chained system-prompt changes, so it
 * keeps the prompt-cache prefix intact while remaining authoritative for the model.
 * See output-style.ts for the rules and appendOutputStyle for composition.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendOutputStyle } from "./output-style.ts";

export { OUTPUT_STYLE, OUTPUT_STYLE_MARKER, appendOutputStyle } from "./output-style.ts";

export default function outputStyleExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    return { systemPrompt: appendOutputStyle(event.systemPrompt) };
  });
}
