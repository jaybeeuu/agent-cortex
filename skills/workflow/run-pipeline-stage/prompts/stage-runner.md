## Project context
Run `bd prime` if you need project-level context (conventions, tech stack, goals).

## Stage metadata
- Stage: `<stage>`
- Playbook: `skills/workflow/run-pipeline-stage/playbooks/<stage>.md`

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
not a transcript. The REPORT below remains the authoritative stage outcome.

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
