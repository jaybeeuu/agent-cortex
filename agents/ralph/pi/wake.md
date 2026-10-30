## Wake mechanism (PI — blocking wait)

**Mechanism: a blocking wait — `wait_for_agents` blocks until at least one background worker finishes and returns its result inline, so the wait itself is the completion signal and no timer, sleep, or poll loop exists.**

### Spawn

RALPH HAS ONLY ONE WAY TO SPAWN SUBAGENTS: call the **`task`** tool (not bash, not any other tool).

**`task`** — Spawn a background sub-agent with the given prompt and return an agent ID immediately.
- `prompt` (string, required): Full task prompt for the sub-agent.
- `cwd` (string, optional): Working directory for the sub-agent (default: current project root). Always set this to the feature worktree path when running stage chores.

Example:
```
Calling tool 'task' with arguments: { "prompt": "...", "cwd": ".agent-cortex/worktrees/abc-123" }
```
The response is a plain agent ID string (e.g. `agent-550e8400-e29b-41d4-a716-446655440000`). Store it in memory and in `state.json` — you need it later to wait for the result.

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

### Completion arrival

A completion arrives **in the wait response**: `wait_for_agents` returns as soon as one worker finishes, carrying that worker's result inline, so you never go looking for it. Apply the shared completion handling in the **Event loop** section of agent.md (the result is included in the wait response, or re-read with `read_agent`; re-read state.json and branch on the entry's `kind` — `stage` parses the REPORT and confirms the worker closed its chore, `expand` confirms the parent now has `stage:*` chores and dispatches the ready `stage:code` — then check for newly ready beads and the shutdown check). An expansion worker is in the wait set but is never treated as a chore: it emits no REPORT and needs no close confirmation.

### Id tracking

Initialize `.agent-cortex/ralph/state.json` as `{ "timerShellId": null, "inflight": [] }`. Only one handle matters here:

- **inflight[].agentId** — the ID `task` returned for that worker; it is the argument `wait_for_agents` takes, the identifier for a `read_agent` fallback, and the key the completion is correlated to its bead.
- **timerShellId** — stays `null` on PI forever: the blocking wait replaces a poll timer, so nothing is ever recorded there.

### Log flush

Flush new log lines as part of handling each wait result — that is when the loop wakes, and a worker's final lines arrive with the completion. Run this procedure each time `wait_for_agents` returns (or whenever a new agent is dispatched):

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

### Wait loop lifecycle

- **Dispatch-and-wait** — during initialization, dispatch up to 5 AFK chore subagents with `task` (or an expansion worker for a chore-less AFK bead) and hold their agent IDs (recorded in `state.json`'s `inflight` list; expansion entries carry `kind: "expand"` and `choreId: null`).
- **Wait** — call `wait_for_agents` with the agent IDs of every in-flight agent, stage worker or expansion worker (`timeout` defaults to 120s). The tool blocks until at least one finishes. For each completed agent:
  1. Flush its log tail if it has new lines (see _Log flush_ above) to surface progress to chat.
  2. Apply the shared completion handling described under _Completion arrival_ above.
  3. Drop the completed agent ID from the wait set.
- **Repeat** — dispatch replacements for completed work (up to 5 in flight), add their new IDs to the wait set, and call `wait_for_agents` again with the remaining + new IDs. A completed expansion leaves a slot to fill with its parent's newly ready `stage:code` chore.
- **Empty wait set** — never call `wait_for_agents` with an empty `agentIds` list. When handling a completion leaves `inflight` empty, run the event loop's final check (agent.md, _If nothing remains in flight_): a ready `stage:*` chore, or a ready, claimable chore-less AFK task bead (expand it first), is dispatchable — dispatch it and wait again. With nothing dispatchable, pending HITL gate beads mean **HITL Pause** and none mean **Shutdown**; either way stop calling `wait_for_agents` and act again only when the user re-prompts.
- **Timeout / STILL RUNNING** — if the timeout elapses with agents still working, the tool returns those agents as STILL RUNNING (with `timed out` noted). Call `wait_for_agents` again with the same IDs — the still-running agents keep working; you never re-dispatch them. `read_agent` remains available to re-read a completed result at any time.
- **Abort** — if the user aborts, `wait_for_agents` returns immediately with what is known so far (no hang); do not re-issue the wait.

### Stop

Nothing to kill: stopping means simply **stop calling `wait_for_agents`**. There is no timer, so there is no shellId to kill and nothing to unset — just do not issue another wait. Never start background `sleep` timers as a substitute for the wait, and never re-issue a wait once the HITL pause or shutdown condition has been met.

### Waiting constraints

- **Always** keep a `wait_for_agents` call outstanding while agents are in-flight — stage workers and expansion workers alike. Never let running agent work stall without a wait active.
- **Never** re-dispatch an agent that is merely STILL RUNNING — wait again on the same ID.
- **Never** start `sleep` / background timer loops for completion detection on PI — `wait_for_agents` replaces them, and there is nothing to kill on HITL Pause.
- **Never** post empty poll updates to chat — only surface new log content.
