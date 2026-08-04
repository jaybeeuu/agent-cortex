import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSessionContext } from "./context-loader.js";

/**
 * Session-start extension.
 *
 * Injects baseline context at the start of every PI session:
 * 1. Skill availability hints (so the agent knows they exist)
 * 2. Project context files (AGENTS.md, user-preferences.md)
 *
 * Context files are read dynamically from the project root (cwd).
 */
export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (_event, ctx) => {
    const skillHints = [
      "Available skills — invoke when relevant (not pre-loaded to save context):",
      "",
      "• /skill:using-agent-skills — meta-skill that routes to the right skill",
      "  and enforces core agent behaviors. Check this first if unsure.",
      "",
      "• /skill:bd-tool — project context & task tracking with beads.",
      "  Run `bd ready` to see available work.",
      "",
      "• /skill:git-workflow — git discipline: feature branches,",
      "  worktrees for solo AFK work, PR workflow, and when to ask.",
      "",
      "Read the SKILL.md for full instructions when needed.",
    ].join("\n");

    const contextFiles = loadSessionContext(ctx.cwd);

    const content = contextFiles
      ? `${skillHints}\n\n---\n\n${contextFiles}`
      : skillHints;

    return {
      message: {
        customType: "session-start",
        content,
        display: false,
      },
    };
  });
}
