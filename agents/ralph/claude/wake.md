## Wake mechanism (Claude Code — event-driven)

**Mechanism: event-driven — the harness re-invokes you automatically when a background worker completes and delivers that worker's result inline, so there is no poll timer, no sleep, and no log flush.**

### Spawn

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

### Completion arrival

A completion is **delivered, not observed**: Claude Code re-invokes you automatically when a background worker finishes, with the worker's result inline on the wake-up. **Do not poll and do not `sleep`.** React to completions as they arrive. On each completion, apply the shared handling in the **Event loop** section of agent.md (steps 3–8: correlate the task ID to its entry via `state.json`'s `inflight`, branch on the entry's `kind` — a `stage` entry parses the REPORT and confirms the worker closed its chore, an `expand` entry has no REPORT and no bead to confirm, so confirm the parent now has `stage:*` chores and dispatch its ready `stage:code` — advance the parent, check for newly ready beads, run the shutdown check).

### Id tracking

Initialize `.agent-cortex/ralph/state.json` as `{ "inflight": [] }` — there is no timer handle to track.

- **inflight[].agentId** — the task ID `Task` returned for that worker; it is the key the delivered completion is correlated to its bead, and the equivalent of `TaskGet`'s identifier when you need to inspect one worker.
- **inflight[].logLine** — not used on Claude; leave it at `1`. Progress lines (`.agent-cortex/ralph/ralph-<parentId>.log`) are written by the workers themselves and surfaced by the harness with the completion.

### Log flush

None. There is **no log tailing on Claude**: the completion is delivered with the result already in hand, so there is nothing to flush and nothing to poll. Produce the shared chat summaries from the delivered result instead.

### Stop

Stopping means simply **stop**: there is no poll timer to kill and no wait to cancel, so you do nothing further and the harness wakes you again when the user re-invokes you. Never schedule a replacement wake-up or start a background process.

### Completion constraints

- **Always** keep completion tracking active while worker results are outstanding — the harness delivers each completion precisely once; never re-request a result.
- **Never** poll, **never** `sleep`, **never** start a background timer.
- **Never** post empty status updates — only surface actual completions.
