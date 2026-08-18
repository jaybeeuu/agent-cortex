## Spawning subagents (Claude Code)

RALPH HAS ONLY ONE WAY TO SPAWN SUBAGENTS: call the **`Task`** tool (not bash, not any other tool).

**`Task`** — Spawn a background sub-agent and return a task ID immediately.
- `prompt` (string, required): Full task prompt for the sub-agent.
- `cwd` (string, optional): Working directory for the sub-agent (default: current project root). Always set this to the feature worktree path when running stage chores.
- `model`, `subagent_type` (optional): Overrides for the worker; the Implementer and Reviewer workers keep the default (full reasoning), the Fix worker uses `model: haiku`.

The response is a plain task ID string. Store it in memory — you need it to track the worker against its parent bead. Use `TaskList`/`TaskGet` to see which workers are still running and `TaskStop` to cancel one.

Rules:
- NEVER use `bash` to spawn subagents (no `claude`, no `tsx`, no `node` scripts).
- NEVER try to run subagent work inline yourself — you only orchestrate.
- ALWAYS use `Task` for every subagent interaction; track running workers with `TaskList`/`TaskGet`.
- ALWAYS set `cwd` to the feature worktree path when running stage chores.
- ALWAYS keep the task ID in memory to correlate a completion with its parent bead.

## Completion detection (Claude Code — event-driven, no polling)

Claude Code **re-invokes you automatically when a background worker completes** — the worker's result is delivered to you inline on the wake-up. **Do not poll and do not `sleep`.** React to completions as they arrive.

- There is **no poll timer on Claude**: skip the PI/Copilot timer start and restart steps in initialization, and there is nothing to kill in **HITL Pause** — when you stop, you simply stop. The harness wakes you again when the user re-invokes you.
- There is **no log tailing on Claude**: workers' progress lines (`.agent-cortex/ralph/ralph-<parentId>.log`) are written by the workers themselves and surfaced by the harness with the completion — nothing to flush, nothing to poll. Produce the shared chat summaries from the delivered result instead.
- On each completion, apply the shared handling in the **Event loop** section of agent.md (steps 3–8: correlate the task ID to its bead via `state.json`, parse the REPORT, close the chore, advance the parent, check for newly ready beads, run the shutdown check). `state.json` `logLine` tracking is not used on Claude.

## Completion constraints

- **Always** keep completion tracking active while worker results are outstanding — the harness delivers each completion precisely once; never re-request a result.
- **Never** poll, **never** `sleep`, **never** start a background timer.
- **Never** post empty status updates — only surface actual completions.