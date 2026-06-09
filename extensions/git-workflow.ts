import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Auto-loads the git-workflow and bd-tool skills into every session.
 *
 * git-workflow enforces feature-branch / worktree / PR discipline.
 * bd-tool provides project context and task-tracking conventions.
 *
 * Both are injected via systemPromptOptions.skills so PI handles
 * content inclusion automatically.
 */
export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    const opts = event.systemPromptOptions;
    if (!opts) return;

    if (!opts.skills) {
      opts.skills = [];
    }

    const toInject = ["git-workflow", "bd-tool"];

    for (const name of toInject) {
      // Avoid duplicates — skills can be strings or { name } objects
      const alreadyPresent = opts.skills.some((s: string | { name: string }) =>
        typeof s === "string" ? s === name : s.name === name,
      );
      if (!alreadyPresent) {
        opts.skills.push(name);
      }
    }
  });
}
