## Spawning subagents (PI)

RALPH HAS ONLY ONE WAY TO SPAWN SUBAGENTS: call the **`task`** tool (not bash, not any other tool).

**`task`** — Spawn a background sub-agent with the given prompt and return an agent ID immediately.
- `prompt` (string, required): Full task prompt for the sub-agent.
- `cwd` (string, optional): Working directory for the sub-agent (default: current project root). Always set this to the feature worktree path when running stage chores.

Example:
```
Calling tool 'task' with arguments: { "prompt": "...", "cwd": ".agent-cortex/worktrees/abc-123" }
```
The response is a plain agent ID string (e.g. `agent-550e8400-e29b-41d4-a716-446655440000`). Store it in memory — you need it later to wait for the result.

**`wait_for_agents`** — Block until at least one background sub-agent completes. This is the primary way to get results back.
- `agentIds` (string[], required): The agent IDs returned by `task` to wait on.
- `timeout` (number, optional): Maximum seconds to block (default 120) before returning any still-unfinished agents as STILL RUNNING.

Behaviour:
- Blocks until **at least one** of the listed agents finishes (completes or fails) or the timeout elapses.
- Returns the full output of every agent that has finished. Agents still working are returned as **STILL RUNNING** — keep their IDs in the next `wait_for_agents` call; do not dispatch duplicates.
- Preserves parallelism: dispatch several tasks, then one `wait_for_agents` returns as soon as ANY of them finishes — process that result and dispatch a replacement, then wait on the remaining IDs plus any new ones.

**`read_agent`** — fallback: read one specific agent's output when you already know it finished (e.g. re-reading a result after a `wait_for_agents` timeout, or inspecting a single ID).
- `agentId` (string, required): The agent ID returned by `task`.

Rules:
- NEVER use `bash` to spawn subagents (no `pi`, no `tsx`, no `node` scripts).
- NEVER try to run subagent work inline yourself — you only orchestrate.
- ALWAYS use `task` + `wait_for_agents` for subagent interactions; use `read_agent` only as a fallback for a specific already-known result.
- ALWAYS set `cwd` to the feature worktree path when running stage chores.
- ALWAYS keep the returned `agentId` in memory to wait on it / read its result later.

## Completion detection (PI)

PI detects subagent completion with a blocking wait, not polling: after dispatching, call `wait_for_agents` with every in-flight agent ID. It returns as soon as at least one agent completes, with that agent's result ready to process. Do not `sleep`, do not start background timers — the wait tool IS the completion mechanism.

### Wait loop lifecycle

- **Dispatch-and-wait** — during initialization, dispatch up to 5 AFK chore subagents with `task` and hold their agent IDs (recorded in `state.json`'s `inflight` list).
- **Wait** — call `wait_for_agents` with the agent IDs of every in-flight chore (`timeout` defaults to 120s). The tool blocks until at least one finishes. For each completed agent:
  1. Flush its log tail if it has new lines (see _Log polling_ below) to surface progress to chat.
  2. Apply the shared completion handling in the **Event loop** section of agent.md (the result is included in the wait response, or re-read with `read_agent`; re-read state.json, parse the REPORT, close the chore, advance the parent, check for newly ready beads, run the shutdown check).
  3. Drop the completed agent ID from the wait set.
- **Repeat** — dispatch replacements for completed chores (up to 5 in flight), add their new IDs to the wait set, and call `wait_for_agents` again with the remaining + new IDs.
- **Timeout / STILL RUNNING** — if the timeout elapses with agents still working, the tool returns those agents as STILL RUNNING (with `timed out` noted). Call `wait_for_agents` again with the same IDs — the still-running agents keep working; you never re-dispatch them. `read_agent` remains available to re-read a completed result at any time.
- **Abort** — if the user aborts, `wait_for_agents` returns immediately with what is known so far (no hang); do not re-issue the wait.
- **Stop** — when stopping completely (HITL Pause or Shutdown) there is no timer to kill on PI: just stop calling `wait_for_agents`. Never start background `sleep` timers for completion detection.

## Log polling

Run this procedure each time `wait_for_agents` returns (or whenever a new agent is dispatched):

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

- **Always** keep a `wait_for_agents` call outstanding while agents are in-flight — never let running agent work stall without a wait active.
- **Never** re-dispatch an agent that is merely STILL RUNNING — wait again on the same ID.
- **Never** start `sleep` / background timer loops for completion detection on PI — `wait_for_agents` replaces them. There is nothing to kill on HITL Pause for PI.
- **Never** post empty poll updates to chat — only surface new log content.