import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * General session-start extension.
 *
 * Add things here that should be loaded or configured at the start of every
 * PI session. Currently injects essential skills into the system prompt.
 */
export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    const opts = event.systemPromptOptions;
    if (!opts) return;

    if (!opts.skills) {
      opts.skills = [];
    }

    const toInject = [
      "git-workflow", // feature-branch / worktree / PR discipline
      "bd-tool", // project context & task tracking
    ];

    for (const name of toInject) {
      // Skills can be strings or { name } objects — handle both
      const alreadyPresent = opts.skills.some((s: string | { name: string }) =>
        typeof s === "string" ? s === name : s.name === name,
      );
      if (!alreadyPresent) {
        opts.skills.push(name);
      }
    }
  });
}
