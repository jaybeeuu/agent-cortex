---
name: run-pipeline-stage
description: Execute a single pipeline stage for a bead (code, verify, review, document) via its playbook and read-only routing, reporting the outcome in a fixed REPORT shape. Use when you want to "work through beads inline", "pick up a specific stage bead", or run one stage "without the full ralph orchestrator".
---

# Run Pipeline Stage

Stage beads (`stage:code`, `stage:verify`, `stage:review`, `stage:document`, `stage:fix`) come from the pipeline definition in `skills/planning/create-task/pipeline.json`. This skill executes one stage and owns that bead's lifecycle: the runner that does the work appends its own notes, closes its own leaf execution bead on **both** outcomes, and builds its own remediation children when the stage fails. The orchestrator dispatches and routes — it never edits or closes a leaf bead.

## When to use

- "Work through beads inline" instead of running a full ralph fleet.
- "Pick up a specific stage bead" and execute it to a REPORT.
- Re-run a stage after a `stage:fix` chore completes.
- Follow a stage's playbook discipline with the right stage skills — tests, style, security, documentation.

## When NOT to use

- Running many beads concurrently — that is the `ralph` skill.
- Creating or planning beads — use `create-task` or `plan`.
- Exploratory bead bookkeeping without a stage — that is `bd-tool`.

## Ownership split

| Actor | Owns |
|---|---|
| Stage runner (worker) | Milestone notes, progress-log lines, closing its leaf bead on both outcomes, remediation children, the REPORT |
| Orchestrator (ralph or you) | Claim, dispatch, forward routing, the read-only cap backstop, the PR gate |

A leaf bead is the worker's record of what happened. The orchestrator reads it; it does not write it.

## Workflow

1. Run `bd prime` and hold the output; subagents can run it themselves if they need context.
2. If no bead was specified, run `bd ready` and ask the user which to work on.
3. Claim the bead with `bd update <id> --claim` — the bead, not the prompt, is the source of truth. Append a stage-start note immediately (see _Milestone Notes_).
4. Read the bead's `stage:*` label — it names the stage to execute.
5. Load the universal stage-runner prompt (`skills/workflow/run-pipeline-stage/prompts/stage-runner.md`) — it carries the lifecycle, remediation, and REPORT contract — populate `<stage>`, and read the matching playbook (`playbooks/<stage>.md`) for stage-specific rules.
6. Tag the stage — beads are the only status view:

```bash
bd tag <id> stage:<stage>
```

7. Dispatch one subagent per stage with the composed prompt — spawn it with {{TOOL:task}}. The prompt already ends with the REPORT contract; never compose one without it. A session with no subagent tool cannot dispatch: stop and say so rather than substituting a backgrounded CLI run, which has no completion signal.
8. Verify the delivery against the worktree — `node scripts/lib/verify-worker-tree.mjs --worktree <abs-worktree> --base <base>` exits 0 only for a clean tree with a commit ahead of base. A worker whose REPORT claims `OUTCOME: SUCCESS` over a dirty tree has not delivered; re-dispatch it instead of advancing.
9. On the REPORT: route forward per _Routing_ below. Do **not** close the leaf bead — the worker closed it before reporting.

Each step leaves observable state — a claimed bead, a `stage:` tag, worker notes and a closed bead, a verified commit, and a REPORT that drives the next action.

## Routing (read-only)

The worker built anything this stage needed; routing picks up whatever `bd ready` returns.

| Stage complete | Condition | Next action |
| `code` | `OUTCOME: SUCCESS` | Dispatch the ready `stage:verify` chore |
| `verify` | `OUTCOME: SUCCESS` | Dispatch the ready `stage:review` chore |
| `review` | `OUTCOME: SUCCESS` | Dispatch the ready `stage:document` chore |
| `fix` | `OUTCOME: SUCCESS` | Dispatch the ready re-run chore that was blocked on the fix |
| `document` | `OUTCOME: SUCCESS` | Open/update the feature PR and the HITL gate bead |
| `code` / `verify` / `review` / `fix` / `document` | `OUTCOME: BLOCKED` | Create nothing — the worker built `stage:fix` + a fresh instance of its own stage; dispatch the ready fix chore |
| any | parent status `blocked` | Nothing — the worker or the cap backstop blocked it; record it for shutdown |

Cap backstop (read-only): before dispatching a `stage:*` chore, count the parent's fix rounds and, if already at `maxFixRounds` (`skills/planning/create-task/pipeline.json`, currently `4`), block the parent and create nothing:

```bash
fix_rounds=$(bd children <parent-id> --json | grep -c '"stage:fix"')
```

## Remediation Children (worker-built)

On `OUTCOME: BLOCKED` the worker creates its own chain — a `stage:fix` chore carrying the feedback, plus a **fresh instance of the stage that failed**, blocked on the fix. A fresh instance is not optional: the failed chore is already closed, so the pre-created chain cannot re-verify a fix.

| Failed stage | Chain |
|---|---|
| `code` | `stage:fix` → fresh `stage:code` |
| `verify` | `stage:fix` → fresh `stage:verify` |
| `review` | `stage:fix` → fresh `stage:review` |
| `document` | `stage:fix` → fresh `stage:document` |
| `fix` | `stage:fix` → fresh `stage:fix` |

Webbing, at cap, and the exact commands live in `prompts/stage-runner.md` and each playbook's _Remediation and close_ section. In short: both beads are children of the parent task (`--parent <parent-id>`), the fresh stage is `bd dep add <fresh> <fix> --type blocks`, and any not-yet-run later stage is re-blocked behind the fresh bead. Chores carry no required sections, so the feedback description points at the parent/requirements bead (`<parent-id>`) rather than restating its acceptance criteria.

## Progress Logging

Inside the ralph orchestrator, write one structured line per transition or key event to `.agent-cortex/ralph/ralph-{bead-id}.log`:

```
[ISO-timestamp] [bead-id] [stage] message
```

Log stage starts and completes, test/lint/build/security results, blockers, and decisions — not file reads or minor actions.

```bash
mkdir -p .agent-cortex/ralph && echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [bead-id] [stage] message" >> .agent-cortex/ralph/ralph-bead-id.log
```

## Milestone Notes

The bead's notes are the recovery contract: if a session dies mid-stage, a fresh agent must resume from `bd show <id>` alone. Append a short checkpoint at stage start and at each milestone — never on every tool call.

```bash
bd update <id> --append-notes "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [<stage>] <what changed / what's next>"
```

`--append-notes` preserves the trail; plain `--notes` overwrites it. Record the start (stage, worktree, first action), milestones (completed chunks, tests green, files changed), decisions and rejected options, blocks, and discoveries. One or two lines per entry — a scan-friendly checkpoint trail, not a transcript. No new scratch files; beads stay the single source of truth.

## Report Format

Every stage-runner prompt ends with the literal REPORT instruction (see `prompts/stage-runner.md`):

```
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: <code|verify|review|document|fix>
SUMMARY: <2-3 sentence summary of what was done>
FILES_CHANGED: <comma-separated list, or "none">
COMMIT: <sha of the stage commit, or "none">
PUSHED: <yes|no>
PR: <feature PR url, or "none">
OUTCOME: <SUCCESS|BLOCKED>
BLOCKING_ISSUES:                              ← only if OUTCOME is BLOCKED
- <specific blocking issue>
```

Subagents report facts — do not ask them to suggest or predict the next step. A REPORT claiming
`OUTCOME: SUCCESS` with `PUSHED: no`, or a `COMMIT` that is not on the branch, records a failed
stage: the commit is the evidence, the report is the claim.

## Red Flags

- Dispatching a subagent before tagging the stage — beads are the only source of truth for stage progress.
- Closing a leaf bead from the orchestrator — the worker closed it; a second close hides who owned the outcome.
- Creating a feedback or fix bead from the orchestrator — that is the worker's contract and bypasses its cap accounting.
- Composing a subagent prompt without the REPORT contract — the output cannot be routed.
- Skipping the playbook "because the stage is simple" — playbooks carry the per-stage discipline the pipeline relies on.
- Advancing on `OUTCOME: SUCCESS` without verifying the worktree — the commit is the evidence, the report is the claim.
- Leaving bead notes to the end of the stage — a session that dies mid-stage then loses the whole trail.

## Common Rationalizations

| "The stage is small — I'll just run it directly" | The stage skills and playbook keep output conformant; skipping them produces work that loops back as a fix chore. |
| "I'll close the chore — the worker forgot" | The worker closing it is the contract; an unclosed bead means the worker died, so read its notes and re-dispatch, do not paper over it. |
| "I'll wire the fix chain myself — faster" | Two owners of one lifecycle is what this skill exists to remove; worker-built chains keep cap accounting and the dependency graph truthful. |
| "The stage is obvious from the prompt — no tag needed" | Beads are the source of truth; prompt drift desynchronises the log and downstream dispatch. |

## See Also

- [create-task](../../planning/create-task/SKILL.md) — owns `pipeline.json`: stages, `maxFixRounds`, and the stage templates.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — bead mechanics beyond the commands used here.
- [ralph](../ralph/SKILL.md) — runs many stage beads concurrently and consumes this skill's log and REPORT contracts.

Each playbook delegates to a stage skill: `tdd`/`style-code`/`style-tests` (code, fix), `review-security` (review), `style-documentation` (document).

## Examples

- Input: a `stage:verify` runner reporting `OUTCOME: BLOCKED` with two failing tests → Output: a `Fix (round 1)` chore plus a fresh `Verify (re-run 1)` chore blocked on it, `review` re-blocked behind the fresh verify, verify's own bead closed, and one `---REPORT---` block.
- Input: a `stage:document` runner reporting `OUTCOME: SUCCESS` → Output: document's bead already closed by the runner; the orchestrator opens the feature PR and updates the HITL gate bead.

## Philosophy / rationale

- Beads hold all orchestration state — there is no separate state file to drift out of sync.
- Whoever does the work owns the record: a worker that closes its own bead leaves an auditable trail the orchestrator can only read.
- Self-contained remediation keeps the dependency graph truthful, so `bd ready` alone is enough to schedule the next step.

## Verification checklist

- [ ] Bead claimed (`bd update <id> --claim`) before any executor works it.
- [ ] `bd tag <id> stage:<stage>` run before dispatch.
- [ ] Correct playbook read and followed for the stage; stage skills invoked where the playbook says.
- [ ] Composed prompt carries the lifecycle, remediation, and REPORT contract from `prompts/stage-runner.md`.
- [ ] Progress log lines written for every stage transition and key result.
- [ ] Milestone notes appended at stage start and each milestone with `--append-notes` (not `--notes`).
- [ ] The orchestrator closed no leaf bead and created no fix bead; the cap backstop ran before any dispatch.
