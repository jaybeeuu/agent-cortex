---
name: run-pipeline-stage
description: Execute a single pipeline stage for a bead (code, verify, review, document) via its playbook and dispatch rules, reporting the outcome in a fixed REPORT shape. Use when you want to "work through beads inline", "pick up a specific stage bead", or run one stage "without the full ralph orchestrator".
---

# Run Pipeline Stage

Stage beads (`stage:code`, `stage:verify`, `stage:review`, `stage:document`, `stage:fix`) are created by the `create-task` skill from the pipeline definition in `skills/planning/create-task/pipeline.json`. This skill executes one stage at a time and reports the outcome.

## When to use

- "Work through beads inline" instead of running a full ralph fleet.
- "Pick up a specific stage bead" and execute it to a REPORT.
- Re-run a stage after a `stage:fix` chore completes.
- Follow a stage's playbook discipline with the right stage skills — tests, style, security, documentation.

## When NOT to use

- Running many beads concurrently — that is the `ralph` skill.
- Creating or planning beads — use `create-task` or `plan`.
- Exploratory bead bookkeeping without a stage — that is `bd-tool`.

## Workflow

1. Run `bd prime` and hold the output; subagents can run it themselves if they need context.
2. If no bead was specified, run `bd ready` and ask the user which to work on.
3. Claim the bead with `bd update <id> --claim` — the bead, not the prompt, is the source of truth.
4. Read the bead's `stage:*` label — it names the stage to execute.
5. Load the universal stage-runner prompt (`skills/workflow/run-pipeline-stage/prompts/stage-runner.md`), populate `<stage>`, and read the matching playbook (`skills/workflow/run-pipeline-stage/playbooks/<stage>.md`) for stage-specific rules.
6. Tag the stage and regenerate the progress doc so pairing sessions stay current:

```bash
bd tag <id> stage:<stage>
# workspace must be the absolute path of the worktree — never . or $(pwd)
workspace="/absolute/path/to/worktree"
pnpm --prefix skills/workflow/run-pipeline-stage/scripts exec tsx generate-progress.ts --workspace "$workspace" > "$workspace/.agent-cortex/ralph/progress.md"
```

7. Dispatch one subagent per stage with the composed prompt — spawn it with {{TOOL:task}} and end the prompt with the REPORT contract below.
8. Route the REPORT through the Dispatch Rules: advance to the next stage, create a feedback bead, or close the parent.

Each step leaves observable state — a claimed bead, a `stage:` tag, a regenerated progress doc, and a REPORT that drives the next action.

## Dispatch Rules

| Stage complete | Condition | Next action |
|---|---|---|
| `code` | — | Run **verify** |
| `verify` | `OUTCOME: SUCCESS` | Run **review** |
| `verify` | `OUTCOME: BLOCKED` | Create a `stage:fix` chore (see _Feedback Beads_) |
| `review` | `OUTCOME: SUCCESS` | Run **document** |
| `review` | `OUTCOME: BLOCKED` and fixRounds < maxFixRounds | Create a `stage:fix` chore; increment fixRounds |
| `review` | `OUTCOME: BLOCKED` and fixRounds ≥ maxFixRounds | `bd update <parent-id> --status blocked --notes "max fix rounds reached"`; record for shutdown |
| `document` | — | `bd close <id>` — done |

`maxFixRounds` is read from `skills/planning/create-task/pipeline.json` (currently `4`). A fix chore re-runs the stage that failed — fix after verify → verify; fix after review → review.

## Feedback Beads

On stage failure, create a chore bead whose description carries the feedback so the orchestrator's dispatch path stays uniform — it just picks up whatever `bd ready` returns:

```bash
new_id=$(bd create "[<parent-id>] <title>" --type chore \
  --description "<feedback content from REPORT>" --priority <parent-priority> -q)
bd tag $new_id stage:<next-stage>
bd tag $new_id workflow:ralph
bd dep add $new_id <parent-id> --type parent-child
```

| Triggering outcome | Suggested title | Next stage tag | Description content |
|---|---|---|---|
| `OUTCOME: BLOCKED` from verify | `Fix: verify failures` | `stage:code` | Full BLOCKING_ISSUES list |
| `OUTCOME: BLOCKED` from review | `Fix: reviewer feedback` | `stage:fix` | Full BLOCKING_ISSUES list |

Do not dispatch a new agent right after creating the feedback bead — it appears in `bd ready` on the next cycle and flows through the normal scheduling path.

## Progress Logging

Inside the ralph orchestrator, write one structured line per transition or key event to `.agent-cortex/ralph/ralph-{bead-id}.log`:

```
[ISO-timestamp] [bead-id] [stage] message
```

Log stage starts and completes, test/lint/build/security results, blockers, and decisions — not file reads or minor actions.

```bash
mkdir -p .agent-cortex/ralph && echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [bead-id] [stage] message" >> .agent-cortex/ralph/ralph-bead-id.log
```

## Report Format

Every subagent prompt must end with the REPORT instruction:

> End your response with a `---REPORT---` block in exactly this format:
> ```
> ---REPORT---
> BEAD_ID: <id>
> STAGE_COMPLETED: <code|verify|review|document>
> SUMMARY: <2-3 sentence summary of what was done>
> FILES_CHANGED: <comma-separated list, or "none">
> OUTCOME: <SUCCESS|BLOCKED>
> BLOCKING_ISSUES:                              ← only if OUTCOME is BLOCKED
> - <specific blocking issue>
> ---
> ```

Subagents report facts — do not ask them to suggest or predict the next step.

## Red Flags

- Dispatching a subagent before tagging the stage — beads are the only source of truth for stage progress.
- Composing a subagent prompt without the REPORT contract — the output cannot be routed.
- Creating a feedback bead and then dispatching anyway — bypasses the fix-round accounting and parent-child dependency graph.
- Skipping the playbook "because the stage is simple" — playbooks carry the per-stage discipline the pipeline relies on.

## Common Rationalizations

| "The stage is small — I'll just run it directly" | The stage skills and playbook keep output conformant; skipping them produces work that loops back as a fix chore. |
| "I'll dispatch the fix right away — faster than a chore bead" | Feedback beads keep dispatch uniform and durable; direct re-dispatch breaks fix-round accounting and the dependency graph. |
| "The stage is obvious from the prompt — no tag needed" | Beads are the source of truth; prompt drift desynchronises the progress doc, the log, and downstream dispatch. |

## Cross-skill references

- `create-task` owns `pipeline.json` — stages, `maxFixRounds`, and the stage templates.
- `bd-tool` covers bead mechanics beyond the commands in this skill.
- `ralph` runs many stage beads concurrently and consumes this skill's log and REPORT contracts.
- Playbooks delegate to stage skills: `tdd`/`style-code`/`style-tests` (code), `review-security` (review), `style-documentation` (document).

## Examples

- Input: a `stage:verify` bead reporting `OUTCOME: BLOCKED` with two failing tests → Output: a `Fix: verify failures` chore tagged `stage:code` whose description lists both failures; verify closes and the chore is picked up on the next `bd ready` cycle.
- Input: a `stage:document` bead reporting `OUTCOME: SUCCESS` → Output: the parent bead is closed with `bd close <id>` and that task's pipeline ends.

## Philosophy / rationale

- Beads hold all orchestration state — there is no separate state file to drift out of sync.
- Subagents return facts in one fixed REPORT shape so routing stays mechanical across stages and harnesses.
- Feedback as beads, not direct re-dispatches, puts every agent on a single scheduling path and keeps every decision visible in the dependency graph.

## Verification checklist

- [ ] Bead claimed (`bd update <id> --claim`) before any executor works it.
- [ ] `bd tag <id> stage:<stage>` run and progress doc regenerated before dispatch.
- [ ] Correct playbook read and followed for the stage; stage skills invoked where the playbook says.
- [ ] Composed prompt ends with the complete REPORT contract block.
- [ ] Progress log lines written for every stage transition and key result.
- [ ] REPORT routed per the Dispatch Rules — next stage, feedback bead, or `bd close <id>`.
- [ ] Feedback beads carry the full BLOCKING_ISSUES content and the parent-child dependency.