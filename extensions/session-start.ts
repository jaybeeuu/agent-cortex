import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * General session-start extension.
 *
 * Add things here that should be loaded or configured at the start of every
 * PI session. Currently injects a brief reference to essential skills so the
 * agent knows they exist without loading their full content into every turn,
 * and references the user-preferences doc for personal tooling choices.
 */
export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    return {
      message: {
        customType: "session-start",
        content: [
          "Available skills — invoke when relevant (not pre-loaded to save context):",
          "",
          "• /skill:bd-tool — project context & task tracking with beads.",
          "  Run `bd ready` to see available work.",
          "",
          "• /skill:git-workflow — git discipline: feature branches,",
          "  worktrees for solo AFK work, PR workflow, and when to ask.",
          "",
          "Read the SKILL.md for full instructions when needed.",
          "",
          "---",
          "User preferences: ~/src/agent-cortex/docs/user-preferences.md",
          "Read that file before making tooling decisions (e.g. package manager).",
        ].join("\n"),
        display: false,
      },
    };
  });
}
