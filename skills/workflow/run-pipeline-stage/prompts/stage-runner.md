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

## Trail entries
The bead's notes are the recovery contract — a fresh session must be able to resume from
`bd show <id>` alone. One script writes that trail: run it at stage start, at each milestone, and
at stage close.

```bash
node <run-pipeline-stage-scripts>/trail-entry.mjs \
  --bead <id> --stage <stage> --outcome <done|blocked|partial> \
  --evidence "<test or lint result, commit, command output>" \
  --remaining "<what is left, or none>" \
  [--commit <ref>] [--branch <branch>] [--pr <url>] [--work-id <worktree-id>]
```

`<run-pipeline-stage-scripts>` is the absolute path to
`skills/workflow/run-pipeline-stage/scripts/`, resolved from wherever that skill was loaded — never
hardcode one harness's install path.

Every entry carries three mandatory fields:

- **Outcome** — `done`, `blocked` or `partial`. A fixed vocabulary, never prose.
- **Evidence** — what proves it: a test or lint result, the commit SHA, or command output.
- **What is left** — the next concrete action, or `none`.

`--commit` takes any ref — `HEAD`, a short SHA, a branch — and the script resolves it to the full
40-character SHA before recording, because `bd provenance record --ref-kind git-sha` refuses
anything else. Refs you pass are also recorded as provenance events, visible with
`bd provenance log <id>`.

Run it at each transition instead of writing notes by hand: one entry per transition, decisions and
blocks included. Recording is idempotent, so a double fire appends nothing twice, and a transient
database failure is retried. There is no progress file: the bead is the only trail.

## Leaf bead lifecycle (yours to close)

1. **Chain before close.** Build remediation children (below) *before* you close the bead, so
   the parent never shows a later stage as ready while remediation is outstanding.
2. **Close on both outcomes** — success and failure alike:
   ```bash
   bd close <bead-id> --reason="<SUCCESS|BLOCKED>: <one-line outcome>"
   ```
   The outcome lives in the close reason, the milestone notes, and the REPORT. A closed bead
   with a `BLOCKED` reason is a completed stage, not abandoned work.

   **Exception — `housekeeping`.** It closes its bead only when the pruner removed every
   `closed-bead` worktree. On `BLOCKED` it leaves the bead **open** and builds nothing (see
   _Remediation_ below). **Exception — `post-merge`.** It closes its bead on exit `0` and leaves it
   **open** on exit `1` or `2`, where the check reported a failed or inconclusive run.
3. **Do not create the next stage on success.** Routing forward is the orchestrator's job.

## Remediation (only when your outcome is BLOCKED)

**Exception — `housekeeping` builds nothing.** It changes no files and sits last in the chain, so a
`stage:fix` chore and a fresh instance have nothing to repair and nothing to re-block. It leaves its
bead open, reports `OUTCOME: BLOCKED` with the surviving worktrees, and hands the chore to a human.
Every step below applies to every other stage.

**Exception — `post-merge` builds nothing.** It verified a commit that already merged, so a fix
round has nothing to repair and no later stage to re-block. It leaves its chore open, reports
`OUTCOME: BLOCKED` with the check's reason, and names the P1 escalation bead the check filed when
the run failed. Every step below applies to every other stage.

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

**Exception — `housekeeping`.** It changes no files, so it commits and pushes nothing. Report
`COMMIT: none` and `PUSHED: no` with `OUTCOME: SUCCESS`; never create an empty commit.
**Exception — `post-merge`.** It changes no files either: always report `COMMIT: none` and
`PUSHED: no`, whatever the check's exit status.

## Instructions
1. Read and follow the playbook file listed above.
2. Treat the bead as the source-of-truth specification (not a prompt script).
3. Keep output factual and stage-scoped.

## Report

End your response with a `---REPORT---` block in exactly this format:

```
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: <code|verify|review|document|post-merge|housekeeping|fix>
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
