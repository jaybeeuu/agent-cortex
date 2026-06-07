---
name: run-pipeline-stage
description: Execute a single pipeline stage for a task. Use when you want to work through beads inline, pick up a specific stage bead, or work without the full ralph parallel orchestrator.
---

# Run Pipeline Stage

Execute a single pipeline stage. Stage beads (`code`, `verify`, `review`, `document`) are created by the `create-task` skill from the pipeline definition in `skills/create-task/pipeline.json`; this skill handles executing one at a time.

## Quick Start

1. Run `bd prime` and hold the output — it goes verbatim into every subagent prompt.
2. If no bead is specified, run `bd ready` and ask the user which to work on.
3. Claim the bead with `bd update <id> --claim`.
4. Read the bead's `stage:*` label to determine which stage to execute.
5. Load the universal stage runner prompt from `skills/run-pipeline-stage/prompts/stage-runner.md`.
6. Populate `<stage>` (from the bead's `stage:*` label), and follow `skills/run-pipeline-stage/playbooks/<stage>.md` for stage-specific behavior before spawning a subagent.

## Progress Report

To generate a Markdown snapshot of all bead status (Mermaid dependency graph, active work table, completed list), run:

```bash
# workspace must be the absolute path of the project — never . or $(pwd)
workspace="/absolute/path/to/project"
pnpm --prefix ~/.copilot/installed-plugins/_direct/agent-cortex/skills/run-pipeline-stage/scripts exec tsx generate-progress.ts --workspace "$workspace"
```

To typecheck or test the scripts package:

```bash
pnpm --prefix skills/run-pipeline-stage/scripts typecheck
pnpm --prefix skills/run-pipeline-stage/scripts test
```

The data-fetch layer (`parseBdList` / `parseBdShow`) is kept separate from the renderer so the output format can be swapped without re-fetching.

## Progress Logging

When running inside the ralph orchestrator, subagents must write structured progress lines to `.agent-cortex/ralph/ralph-{bead-id}.log` (appending) so ralph can surface live updates. The bead ID and log file path are provided in each prompt.

**Format** — one entry per line:
```
[ISO-timestamp] [bead-id] [stage] message
```

**When to log:**
- Stage start: `[...] [abc-123] [code] Stage started`
- Stage transitions: `[...] [abc-123] [code→verify] Stage complete`, `[...] [abc-123] [verify→review] PASS`, `[...] [abc-123] [verify→fix] FAIL`
- Key events only:
  - Test results: `Tests: 12 passed, 0 failed`
  - Lint result: `Lint: PASS` or `Lint: FAIL — <brief reason>`
  - Build errors: `Build failed: <brief reason>`
  - Security scan result: `Security scan: PASS` or `Security scan: FAIL — <finding>`
  - Any significant blocker or decision

**How to write a log line:**
```bash
mkdir -p .agent-cortex/ralph && echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [bead-id] [stage] message" >> .agent-cortex/ralph/ralph-bead-id.log
```

Do not log every file read or minor action — only transitions and key events.

## Pipeline

The canonical pipeline is defined in `skills/create-task/pipeline.json`. Current stages:

| Stage | Notes |
|-------|-------|
| **code** | Implement the task using a test-driven approach |
| **verify** | Run the project's test and lint commands and report the outcome |
| **review** | Review the implementation for security, correctness, and alignment with task requirements |
| **document** | Review changes and update documentation if key decisions, behaviour changes, or constraints were introduced |

The fix loop (on verify or review failure) is controlled by `maxFixRounds` in `pipeline.json`.

### Stage Transitions

Before dispatching a subagent for any stage, run these two commands (replacing `<id>` and `<stage>` with the bead ID and the stage about to start):

```bash
bd tag <id> stage:<stage>
# workspace must be the absolute path of the worktree — never . or $(pwd)
workspace="/absolute/path/to/worktree"
mkdir -p "$workspace/.agent-cortex/ralph"
pnpm --prefix ~/.copilot/installed-plugins/_direct/agent-cortex/skills/run-pipeline-stage/scripts exec tsx generate-progress.ts --workspace "$workspace" > "$workspace/.agent-cortex/ralph/progress.md"
```

This tags the bead with its current stage (beads are the source of truth for stage progress) and regenerates the progress doc so any inline pairing session stays current.

## Dispatch Rules

| Stage completed | Condition | Next action |
|-----------------|-----------|-------------|
| `code` | — | Run **verify** stage |
| `verify` | `OUTCOME: SUCCESS` | Run **review** stage |
| `verify` | `OUTCOME: BLOCKED` | Create a `stage:fix` chore (see _Feedback Beads_) |
| `review` | `OUTCOME: SUCCESS` | Run **document** stage |
| `review` | `OUTCOME: BLOCKED` and fixRounds < maxFixRounds | Create a `stage:fix` chore (see _Feedback Beads_); increment fixRounds |
| `review` | `OUTCOME: BLOCKED` and fixRounds ≥ maxFixRounds | `bd update <parent-id> --status blocked --notes "max fix rounds reached"` — record for shutdown |
| `document` | — | `bd close <id>` — done |

`maxFixRounds` is read from `skills/create-task/pipeline.json` (`maxFixRounds` field, currently `4`).

### Fix loop flow

When a `stage:fix` chore completes, the next stage depends on which stage triggered the fix:
- **Fix after verify failure** → re-run **verify**
- **Fix after review failure** → re-run **review**

The orchestrator (ralph or inline agent) tracks fix rounds and re-dispatches the original stage after the fix chore completes.

## Feedback Beads

When a stage reports a failure or rejection, the orchestrator creates a new chore bead whose description contains the feedback. This keeps feedback durable and visible, and makes the orchestrator's dispatch path uniform — it just picks up whatever `bd ready` returns.

**Create the bead:**

```bash
new_id=$(bd create "[<parent-id>] <title>" --type chore \
  --description "<feedback content from REPORT>" --priority <parent-priority> -q)
bd tag $new_id stage:<next-stage>
bd tag $new_id workflow:ralph
bd dep add $new_id <parent-id> --type parent-child
```

| Triggering outcome | Suggested title | Next stage tag | Feedback content to put in description |
|---|---|---|---|
| `OUTCOME: BLOCKED` from verify | `Fix: verify failures` | `stage:code` | Full BLOCKING_ISSUES list |
| `OUTCOME: BLOCKED` from review | `Fix: reviewer feedback` | `stage:fix` | Full BLOCKING_ISSUES list |

After creating the feedback bead, do **not** dispatch a new agent immediately — the bead will appear in `bd ready` on the next cycle and be dispatched through the normal scheduling path. The stage that consumed the feedback from the REPORT is now finished; its agent result has been processed.

## Report Format

Every subagent prompt **must** end with this instruction:

> End your response with a `---REPORT---` block in exactly this format:
> ```
> ---REPORT---
> BEAD_ID: <id>
> STAGE_COMPLETED: <code|verify|review|document>
> SUMMARY: <2–3 sentence summary of what was done>
> FILES_CHANGED: <comma-separated list, or "none">
> OUTCOME: <SUCCESS|BLOCKED>
> BLOCKING_ISSUES:                              ← only if OUTCOME is BLOCKED
> - <specific blocking issue>
> ---
> ```

Subagents report facts. **Do not ask subagents to suggest or predict the next step.**
