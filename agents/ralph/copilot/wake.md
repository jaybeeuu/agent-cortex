## Wake mechanism (Copilot — polling)

**Mechanism: an active poll loop — a `sleep 120` background timer plus log tailing — so a completion never interrupts you; you observe it on a tick, then read the worker's output with `read_agent`.**

### Spawn

RALPH HAS ONLY ONE WAY TO SPAWN SUBAGENTS: call the **`task`** tool (not bash, not any other tool).

**`task`** — Spawn a background sub-agent with the given prompt and return an agent ID immediately.
- `prompt` (string, required): Full task prompt for the sub-agent.
- `cwd` (string, optional): Working directory for the sub-agent (default: current project root). Always set this to the feature worktree path when running stage chores.

Example:
```
Calling tool 'task' with arguments: { "prompt": "...", "cwd": ".agent-cortex/worktrees/abc-123" }
```
The response is a plain agent ID string (e.g. `agent-550e8400-e29b-41d4-a716-446655440000`). Store it in memory and in `state.json` — you need it later to read the result.

**`read_agent`** — When a sub-agent completes, read its full output.
- `agentId` (string, required): The agent ID returned by `task`.

Rules:
- NEVER use `bash` to spawn subagents (no `pi`, no `tsx`, no `node` scripts).
- NEVER try to run subagent work inline yourself — you only orchestrate.
- ALWAYS use `task` + `read_agent` for every subagent interaction.
- ALWAYS set `cwd` to the feature worktree path when running stage chores.
- ALWAYS keep the `agentId` in memory to read the result later with `read_agent`.

### Completion arrival

A completion is never delivered to you — you find it. On each tick, flush every in-flight log (see _Log flush_ below) and read the finished worker's output with `read_agent`; then apply the shared completion handling in the **Event loop** section of agent.md (re-read state.json and branch on the entry's `kind` — `stage` parses the REPORT and confirms the worker closed its chore, `expand` confirms the parent now has `stage:*` chores and dispatches the ready `stage:code` — then check for newly ready beads and the shutdown check).

### Id tracking

Initialize `.agent-cortex/ralph/state.json` as `{ "timerShellId": null, "inflight": [] }`. Two handles matter here:

- **inflight[].agentId** — the ID `task` returned for that worker; it is the key every `read_agent` call needs and the key the completion is correlated to its bead.
- **timerShellId** — the shellId of the active `sleep 120` poll-timer bash process, rewritten every time the timer is started or restarted; `null` while no timer runs.

### Log flush

Required on every tick: a completion is only visible once its log has been tailed. Run this procedure whenever polling is triggered (timer or agent completion):

1. **Query in-flight beads**: read `inflight` from `state.json`. Each entry has a `parentId` and `logLine`.
2. For each in-flight entry, read new lines from its log file:
   ```bash
   tail -n +<logLine> .agent-cortex/ralph/ralph-<parentId>.log 2>/dev/null
   ```
3. For each entry that has new lines:
   - **Post a chat summary** of new key events (stage transitions and notable events — not every line verbatim). Format:
     ```
     📋 [parent-id] <title>
        coding → verifying  (or whatever transition)
        Tests: 12 passed, 0 failed
     ```
   - Update `logLine` in `state.json` for that entry.
4. If no entry had new lines, post nothing — do not spam the chat with empty polls.

### Poll timer lifecycle

- **Start** — during initialization, if any agent work was dispatched in the init step — a stage worker for a ready chore, or an expansion worker for a chore-less AFK bead — start the **poll timer**: run `sleep 120` as a background bash process and record its shellId as `timerShellId` in `.agent-cortex/ralph/state.json`. **Otherwise**, if HITL gate beads are pending (open `lifecycle:feature-pr` beads or epics tagged `awaiting-epic-pr-merge`), proceed to **HITL Pause** (see below) immediately.
- **Tick** — when the timer completes:
  1. **Poll all in-flight bead logs** (see _Log flush_ below).
  2. **HITL pause check**: if no agent work is in-flight (`state.json`'s `inflight` holds no entries) AND nothing is dispatchable (`bd ready` has no `stage:*` chore beads and no ready, claimable chore-less AFK task bead awaiting expansion — an AFK bead behind an open `lifecycle:feature-pr` HITL gate is queued, not claimable) AND HITL gate beads are pending (`bd list -l lifecycle:feature-pr -l implementation-type:hitl` or `bd list -l awaiting-epic-pr-merge` returns results), proceed to **HITL Pause** (see below) — do **not** restart the timer. An expansion worker in flight keeps the loop alive: while it runs, its parent has no chores and none are ready.
  3. **Otherwise**: restart the timer: run `sleep 120` as a new background bash process, record its shellId as `timerShellId` in `.agent-cortex/ralph/state.json`.
- **Stop** — when stopping completely (HITL Pause or Shutdown), kill the running timer: if `timerShellId` is non-null in `state.json`, run `kill <timerShellId>` (suppress errors), then set `timerShellId` to `null` in `state.json`. Never restart or schedule a new timer once the HITL pause condition has been met.

### Stop

Stopping means killing the timer — nothing else keeps ralph awake, and nothing wakes it once the timer is gone. Follow the **Stop** step of the timer lifecycle above, then do nothing further; do not schedule a replacement wake-up, do not start any background process, and do not check bead status again.

### Polling constraints

- **Always** restart the poll timer immediately after it fires **if** agent work is still in-flight (stage workers or expansion workers) or a ready, claimable AFK task bead is available — never let running agent work stall without a timer.
- **Never** restart or start a new timer once the HITL pause condition is met (no stage workers in-flight, no expansion workers in-flight, nothing dispatchable, HITL gate beads pending). Kill any running timer, proceed to **HITL Pause**, and stop completely.
- **Never** post empty poll updates to chat — only surface new log content.
