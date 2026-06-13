import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * tmux notification extension for pi.
 *
 * When pi finishes a multi-turn task, emits a bell character that tmux
 * catches via monitor-bell + visual-bell — highlighting the window tab
 * and showing "Bell in window X" so you can navigate to it with y/Y/g.
 */
export default function (pi: ExtensionAPI) {
  // Track agent start time and turn count per prompt
  let agentStartTime = 0;
  let turnCount = 0;

  pi.on("agent_start", async () => {
    agentStartTime = Date.now();
    turnCount = 0;
  });

  pi.on("turn_end", async () => {
    turnCount++;
  });

  pi.on("agent_end", async (_event) => {
    const elapsed = Date.now() - agentStartTime;

    // Only signal if the agent did meaningful work:
    //   - multiple turns (tool-using task), OR
    //   - a single long turn (>= 30s), OR
    //   - any bash tool call took >= 10s (caught by turn timing)
    //
    // This avoids ringing on quick chat responses.
    if (turnCount > 1 || elapsed >= 30_000) {
      // Emit bell — tmux catches this via monitor-bell + bell-action any + visual-bell
      // The bell travels through the pty to tmux the same way a shell bell does.
      try {
        // Try /dev/tty first (most reliable, bypasses stdout capture)
        const { openSync, writeSync, closeSync } = await import("node:fs");
        const fd = openSync("/dev/tty", "w");
        writeSync(fd, "\x07");
        closeSync(fd);
      } catch {
        // Fallback to stdout
        process.stdout.write("\x07");
      }
    }
  });
}
