## Spawning subagents (PI)

RALPH HAS ONLY ONE WAY TO SPAWN SUBAGENTS: call the **`task`** tool (not bash, not any other tool).

**`task`** — Spawn a background sub-agent with the given prompt and return an agent ID immediately.
- `prompt` (string, required): Full task prompt for the sub-agent.
- `cwd` (string, optional): Working directory for the sub-agent (default: current project root). Always set this to the feature worktree path when running stage chores.

Example:
```
Calling tool 'task' with arguments: { "prompt": "...", "cwd": ".agent-cortex/worktrees/abc-123" }
```
The response is a plain agent ID string (e.g. `agent-550e8400-e29b-41d4-a716-446655440000`). Store it in memory — you need it later to read the result.

**`read_agent`** — When a sub-agent completes, read its full output.
- `agentId` (string, required): The agent ID returned by `task`.

Rules:
- NEVER use `bash` to spawn subagents (no `pi`, no `tsx`, no `node` scripts).
- NEVER try to run subagent work inline yourself — you only orchestrate.
- ALWAYS use `task` + `read_agent` for every subagent interaction.
- ALWAYS set `cwd` to the feature worktree path when running stage chores.
- ALWAYS keep the `agentId` in memory to read the result later with `read_agent`.

## Completion detection (PI)

PI detects subagent completion with an active poll loop: a `sleep 120` background timer plus log tailing. When a background agent completes, flush its log with the _Log polling_ procedure below, then apply the shared completion handling in the **Event loop** section of agent.md (read the result with `read_agent`, re-read state.json, parse the REPORT, close the chore, advance the parent, check for newly ready beads, run the shutdown check).

### Poll timer lifecycle

- **Start** — during initialization, if any AFK beads were dispatched in the init step, start the **poll timer**: run `sleep 120` as a background bash process and record its shellId as `timerShellId` in `.agent-cortex/ralph/state.json`. **Otherwise**, if HITL gate beads are pending (open `lifecycle:feature-pr` beads or epics tagged `awaiting-epic-pr-merge`), proceed to **HITL Pause** (see below) immediately.
- **Tick** — when the timer completes:
  1. **Poll all in-flight bead logs** (see _Log polling_ below).
  2. Regenerate `.agent-cortex/ralph/progress.md`.
  3. **HITL pause check**: if no chore beads are in-flight AND `bd ready` has no `stage:*` chore beads AND HITL gate beads are pending (`bd list -l lifecycle:feature-pr -l implementation-type:hitl` or `bd list -l awaiting-epic-pr-merge` returns results), proceed to **HITL Pause** (see below) — do **not** restart the timer.
  4. **Otherwise**: restart the timer: run `sleep 120` as a new background bash process, record its shellId as `timerShellId` in `.agent-cortex/ralph/state.json`.
- **Stop** — when stopping completely (HITL Pause or Shutdown), kill the running timer: if `timerShellId` is non-null in `state.json`, run `kill <timerShellId>` (suppress errors), then set `timerShellId` to `null` in `state.json`. Never restart or schedule a new timer once the HITL pause condition has been met.

## Log polling

Run this procedure whenever polling is triggered (timer or agent completion):

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

## Polling constraints

- **Always** restart the poll timer immediately after it fires **if** agent work is still in-flight or AFK task beads are available — never let running agent work stall without a timer.
- **Never** restart or start a new timer once the HITL pause condition is met (no chores in-flight, no `stage:*` chores ready, HITL gate beads pending). Kill any running timer, proceed to **HITL Pause**, and stop completely.
- **Never** post empty poll updates to chat — only surface new log content.