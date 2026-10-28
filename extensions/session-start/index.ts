import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSessionContext } from "../lib/context-loader.ts";

/**
 * Session-start extension.
 *
 * Injects the project context files (AGENTS.md, docs/user-preferences.md) at
 * the start of every PI session.
 *
 * It deliberately injects nothing about skills: pi's own system prompt already
 * lists every discovered skill with the absolute path to its SKILL.md, so a
 * local copy is incomplete by construction and drifts from `skills/` silently.
 */
export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (_event, ctx) => {
    const contextFiles = loadSessionContext(ctx.cwd);
    if (!contextFiles) return;

    return {
      message: {
        customType: "session-start",
        content: contextFiles,
        display: false,
      },
    };
  });
}
