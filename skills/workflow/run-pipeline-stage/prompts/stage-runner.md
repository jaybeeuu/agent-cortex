## Project context
Run `bd prime` if you need project-level context (conventions, tech stack, goals).

## Stage metadata
- Stage: `<stage>`
- Playbook: `skills/workflow/run-pipeline-stage/playbooks/<stage>.md`
- Leaf execution bead: `<bead-id>` — **you own its lifecycle**. No orchestrator,
  dispatcher, or parent agent writes to it or closes it.

## Bead specification
<bd show <id> output — verbatim>

## Prior stage context (if any)
<prior REPORT fields, dependency context, and relevant files>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`

## Milestone notes
The bead's notes are the recovery contract — a fresh session must be able to resume from
`bd show <id>` alone. Append a short checkpoint before starting and at each milestone:

```bash
bd update <id> --append-notes "[<ISO-timestamp>] [<stage>] <what changed / what's next>"
```

Use `--append-notes` — plain `--notes` overwrites the trail. Record start, milestones, decisions
(with rejected options), blocks, and discoveries. One or two lines per entry: a checkpoint trail,
not a transcript.

## Leaf bead lifecycle (yours to close)

1. **Chain before close.** Build remediation children (below) *before* you close the bead, so
   the parent never shows a later stage as ready while remediation is outstanding.
2. **Close on both outcomes** — success and failure alike:
   ```bash
   bd close <bead-id> --reason="<SUCCESS|BLOCKED>: <one-line outcome>"
   ```
   The outcome lives in the close reason, the milestone notes, and the REPORT. A closed bead
   with a `BLOCKED` reason is a completed stage, not abandoned work.
3. **Do not create the next stage on success.** Routing forward is the orchestrator's job.

## Remediation (only when your outcome is BLOCKED)

A fresh instance of this stage is required: the bead you are closing cannot re-run itself.

1. **Cap check.** Read `maxFixRounds` from `skills/planning/create-task/pipeline.json` and count
   the parent's existing fix rounds (closed ones count):
   ```bash
   fix_rounds=$(bd children <parent-id> --json | grep -c '"stage:fix"')
   ```
2. **At cap** (`fix_rounds >= maxFixRounds`): create **nothing**. Block the parent and record why:
   ```bash
   bd update <parent-id> --status blocked \
     --append-notes "[<ISO-timestamp>] max fix rounds reached (<fix_rounds>/<maxFixRounds>) after <stage> BLOCKED"
   ```
   Then close your own bead and report `OUTCOME: BLOCKED`.
3. **Under cap**: create the fix chore plus the fresh stage, then wire the ordering.
   `--parent` sets the parent-child dep and inherits the parent's labels.
   ```bash
   fix_id=$(bd create "[<parent-id>] Fix (round <fix_rounds + 1>)" \
     --type chore --priority <parent-priority> --parent <parent-id> \
     --labels stage:fix \
     --description "Requirements: see <parent-id> (bd show <parent-id>).

<BLOCKING_ISSUES from your run>" --silent)
   fresh_id=$(bd create "[<parent-id>] <Stage title> (re-run <fix_rounds + 1>)" \
     --type chore --priority <parent-priority> --parent <parent-id> \
     --labels stage:<stage> \
     --description "<this stage's description from pipeline.json>" --silent)
   bd dep add $fresh_id $fix_id --type blocks        # fresh stage waits for the fix
   ```
4. **Re-block the later stages.** Any not-yet-run stage chore of the same parent is already
   unblocked by your bead closing. Wire each one behind the fresh stage:
   ```bash
   bd dep add <downstream-chore-id> $fresh_id --type blocks
   ```
   Skip stages that already ran (closed) and the HITL PR gate bead.
5. Do **not** dispatch anything yourself — the new beads flow through `bd ready`.

## Deliver before reporting

A stage is delivered when its work is committed and pushed — not when the REPORT says so. The
orchestrator opens the feature PR from this branch, so uncommitted work never reaches review, and a
dirty worktree counts as a failed stage whatever the outcome line claims.

1. Commit on the current branch: `git add -A && git commit -m "<stage>(<parent-id>): <summary>"`.
2. Push the branch: `git push -u origin HEAD`.
3. Report `COMMIT`, `PUSHED`, and `PR`. The `document` stage also opens or updates the feature PR
   and reports its URL; every earlier stage reports `PR: none`.

## Instructions
1. Read and follow the playbook file listed above.
2. Treat the bead as the source-of-truth specification (not a prompt script).
3. Keep output factual and stage-scoped.

## Report

End your response with a `---REPORT---` block in exactly this format:

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
BLOCKING_ISSUES:                              <- only if OUTCOME is BLOCKED
- <specific blocking issue>
```

Report facts only — do not suggest or predict the next step.
