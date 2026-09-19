/**
 * Agent Guardrails Extension
 *
 * Appends behavioural circuit-breakers to the PI system prompt on every turn:
 * hard retry limits, explicit check-in triggers, and atomic-change discipline
 * (the first slice of docs/ideas/improve-pi-system-prompt.md).
 *
 * The block is stable text appended after any chained system-prompt changes, so
 * it keeps the prompt-cache prefix intact while remaining authoritative for the
 * model. See guardrails.ts for the rules and appendGuardrails for composition.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendGuardrails } from "./guardrails.ts";

export { GUARDRAILS, GUARDRAILS_MARKER, appendGuardrails } from "./guardrails.ts";

export default function agentGuardrailsExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    return { systemPrompt: appendGuardrails(event.systemPrompt) };
  });
}
