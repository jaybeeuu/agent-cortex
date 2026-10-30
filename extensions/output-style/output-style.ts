/**
 * Output style for the PI system prompt.
 *
 * The second slice of docs/ideas/improve-pi-system-prompt.md: the reply shape, not
 * the task discipline. Three concerns, in order — lead with the action, write in
 * Simplified Technical English, restate the context the reader cannot remember.
 *
 * The prose lives in output-style.md so one file feeds both harnesses: this
 * extension appends it to the PI system prompt, and the Claude installer wraps it
 * in a managed CLAUDE.md section. It is read once at load, so the appended text is
 * stable across turns and keeps the prompt-cache prefix intact. The marker doubles
 * as an idempotency guard: a chained prompt that already carries the block is
 * returned unchanged.
 */

import { readFileSync } from "node:fs";

export const OUTPUT_STYLE_MARKER = "## Output style (agent-cortex)";

export const OUTPUT_STYLE = readFileSync(new URL("./output-style.md", import.meta.url), "utf-8");

/**
 * Append the output-style block to a system prompt.
 *
 * The base prompt is preserved verbatim (minus trailing whitespace) so callers can
 * chain this after other `before_agent_start` handlers. Idempotent: a prompt that
 * already contains the marker is returned unchanged.
 */
export function appendOutputStyle(systemPrompt: string): string {
  if (systemPrompt.includes(OUTPUT_STYLE_MARKER)) return systemPrompt;
  return `${systemPrompt.trimEnd()}\n\n${OUTPUT_STYLE}`;
}
