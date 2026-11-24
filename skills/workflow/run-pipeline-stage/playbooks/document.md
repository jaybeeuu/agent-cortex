# Stage Playbook: documenting

## Stage Instructions

1. Invoke the `style-documentation` skill before making documentation changes.
2. Update docs only when changes introduce:
   - a key decision,
   - macro-level behavior change,
   - a lasting constraint/trade-off.
3. Prefer updating existing docs; create new docs only when no suitable home exists.
4. Do not modify source code in this stage.

## PR readiness — current with its base

Open or update the feature PR first, then prove it is ready before reporting:

```bash
gh pr create --base <base> --head <branch>   # only when no PR is open yet
```

A pull request is ready only when all three statements hold:

1. Its branch contains its base: `git merge-base --is-ancestor origin/<base> HEAD` exits 0.
2. Every check is green on that head: `gh pr checks <n>` exits 0.
3. `gh pr view <n> --json mergeStateStatus` reads `CLEAN`.

`<base>` is `main`, or `epic/<id>` for a feature branch inside a multi-feature epic — the `ralph`
skill states which applies. A nonzero exit, a failing check, or any `mergeStateStatus` other than
`CLEAN` — `BEHIND` above all — means the branch is not ready. Checks that ran on an older merge
base prove nothing about the head that will merge.

### Bringing a behind branch current

Rebase onto the base. Never merge the base in.

```bash
git fetch origin
git rebase origin/<base>
git push --force-with-lease
pnpm test  # the project's suite, re-run on the rebased head
gh pr view <n> --json mergeStateStatus,headRefOid
```

- `--force-with-lease` only, never `--force`.
- Rebase only your own unmerged feature branch. Never rebase `main`, an `epic/<id>` branch, or a
  branch another worker or agent is on.
- **A rebase that conflicts is a stop.** Report the conflicting files and hand the branch back. Do
  not resolve the conflict by merging the base in, and do not widen this stage to absorb it.
- A rewritten branch invalidates the review of the head it replaced: the checks must run again on
  the new head before the report.

## Stage Outcome

- Commit and push the docs before reporting (see the stage-runner prompt, _Deliver before reporting_).
- Open or update the feature PR (`gh pr create --base <base> --head <branch>` when none is open yet),
  then make it current and read `mergeStateStatus` as _PR readiness_ above states.
- Set `OUTCOME: SUCCESS` when docs are updated as needed (or none needed).
- Set `OUTCOME: BLOCKED` if unable to update or content guidance is unclear.
- If blocked, list issues under `BLOCKING_ISSUES`.
- `FILES_CHANGED` lists docs touched, or `none` if no doc change is needed.

## Remediation and close

- You own this leaf bead: record the trail entry through `scripts/trail-entry.mjs`, then
  `bd close <id> --reason=...` on both outcomes (see `prompts/stage-runner.md`, _Trail entries_).
- `OUTCOME: SUCCESS` — create nothing; the orchestrator opens the feature PR and updates the
  HITL gate bead.
- `OUTCOME: BLOCKED` — count the parent's existing `stage:fix` children against
  `maxFixRounds` in `skills/planning/create-task/pipeline.json`. Under cap, create a
  `stage:fix` chore **plus a fresh `stage:document` chore** blocked on it
  (`bd dep add <fresh> <fix> --type blocks`) so documentation is retried after the fix. At cap,
  block the parent and create nothing.
- Report `COMMIT`, `PUSHED`, and the feature `PR` URL. Put the `mergeStateStatus` and the head SHA
  read after the rebase in `SUMMARY`: the REPORT fields are fixed, so the two values go there and no
  field is added.
