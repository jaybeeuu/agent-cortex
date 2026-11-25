## Wake mechanism (Claude Code — event-driven)

**Mechanism: event-driven — the harness re-invokes you automatically when a background worker completes and delivers that worker's result inline, so there is no poll timer and no sleep.**

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

A completion is **delivered, not observed**: Claude Code re-invokes you automatically when a background worker finishes, with the worker's result inline on the wake-up. **Do not poll and do not `sleep`.** React to completions as they arrive. On each completion, apply the shared handling in the **Event loop** section of agent.md (steps 3–8: find the bead whose newest dispatch record names that task ID — `node skills/workflow/ralph/scripts/inflight.mjs` — and branch on its `kind` — a `stage` worker parses the REPORT and confirms it closed its chore, an expansion worker has no REPORT and no bead to confirm, so confirm the parent now has `stage:*` chores and dispatch its ready `stage:code` — advance the parent, check for newly ready beads, run the shutdown check).

### Id tracking

Nothing to initialise: the wake is the harness's own event, so Claude Code holds the handle and ralph keeps no state file.

- **The dispatch record** — the task ID `Task` returned is written to the dispatched bead as one `dispatched:` trail entry (agent.md, _State: the dispatch set_). It is the key a delivered completion is correlated to its bead, and the equivalent of `TaskGet`'s identifier when you need to inspect one worker.
- **No trail bookmark** — nothing to track. Progress is read from the bead itself (`bd show <chore-id>`, `bd provenance log <chore-id>`): the worker writes it, so the harness delivers the completion with the result already in hand.

### Trail reading

None beyond the completion itself. There is **nothing to tail and nothing to flush** on Claude: read the completed worker's bead once for its entries and refs, and produce the shared chat summary from the delivered result.

### Stop

Stopping means simply **stop**: there is no poll timer to kill and no wait to cancel, so you do nothing further and the harness wakes you again when the user re-invokes you. Never schedule a replacement wake-up or start a background process.

### Completion constraints

- **Always** keep completion tracking active while worker results are outstanding — the harness delivers each completion precisely once; never re-request a result.
- **Never** poll, **never** `sleep`, **never** start a background timer.
- **Never** post empty status updates — only surface actual completions.

## Background idle watch (Claude Code)

The background watch monitors the bead queue and nudges the session when work needs attention. On Claude Code, this uses the `idle_watch` tool (provided by the agent-cortex Claude plugin).

### Arming the watch

Call `idle_watch` with:
- `command`: The check script to run on each tick. Default: `skills/workflow/ralph/scripts/idle-check.mjs` (resolved relative to the package root, or use `AGENT_CORTEX_IDLE_WATCH_CHECK` env var).
- `interval`: Milliseconds between ticks. Default: 300000 (5 minutes).
- `stall`: Milliseconds of silence before the watch considers a bead stalled. Default: 900000 (15 minutes).

The watch is session-scoped: it ticks for as long as the session is alive, with no fixed tick count or deadline.

### Re-arming

On each wake (whether from a subagent completion or an idle nudge), check if the watch is armed. If not, arm it again. This is self-healing.

### Stopping

During shutdown or HITL pause, stop the watch.
