# Stage Playbook: post-merge

## Stage Instructions

1. Run the check once from the **main checkout** — never from the bead worktree, because the commit
   under test landed on the base branch:
   ```bash
   node <ralph-scripts>/post-merge-check.mjs
   ```
   It prints a JSON report and exits `0` passed, `1` failed, `2` inconclusive.
2. Read the exit status as the verdict. `--base <branch>` overrides the base branch (default: the
   repository's default branch). `--commit <sha>` overrides the merge commit (default: the base
   branch's tip). `--wait <seconds>` changes the wait window; the default is 300.
3. On `0` — report the run URLs and close the chore. On `1` — the script filed one P1 escalation
   bead carrying the run URL and the failing job; report the bead id and the run URL, and leave the
   chore **open**. On `2` — report the printed `reason` and leave the chore **open**.
4. Never retry the check for a different answer, never re-run the GitHub workflow, never revert the
   merge, and never reopen the parent feature bead.
5. The check reads `gh run list` for the base branch: GitHub-only in v1. A repository `gh` cannot
   resolve to GitHub, or a commit with no run, is `inconclusive` — reported, never escalated.

## Watch transport

The check waits `--wait` seconds (default 300) for the run to settle. A run still in flight at that
window is exit `2` with a still-running reason: a report, not a verdict, and never something to page
a human for.

The wait past that window belongs to the harness, so never write a poll loop of your own — no
`sleep` and re-run. Poll with {{CAPABILITY:post_merge_watch}} and end the turn. The session resumes when a
verdict may exist; run the check again then, and apply step 3 unchanged.

Running the check again on a resume is the watch continuing, not the retry step 4 forbids: you read
the same run's verdict, never ask for a different one. A failure still reaches a human through the
escalation bead the script files, and this stage still repairs nothing.

No harness is assumed to have a watcher. A session with no such mechanism runs the check once with
a longer window instead — `node <ralph-scripts>/post-merge-check.mjs --wait 1800` — and reports what
it printed. The verdicts, the escalation rule and the close rule do not change.

## Stage Outcome

- `OUTCOME: SUCCESS` only on exit `0`.
- `OUTCOME: BLOCKED` on exit `1` or `2`, with the report's `reason` under `BLOCKING_ISSUES`.
- This stage changes no files: report `FILES_CHANGED: none`, `COMMIT: none`, `PUSHED: no`.

## Remediation and close

- `OUTCOME: SUCCESS` — close the chore with the run URLs in the close reason, then close the
  parent if it is settled (see _Settled parent_ below). Create nothing.
- `OUTCOME: BLOCKED` — leave the chore **open**, report the exit status, the reason, and the
  escalation bead id when the script filed one. Run no settlement check: an open chore keeps the
  parent open, which is the correct record of a merge that is not verified. Build no remediation
  chain: there is no `stage:fix` round that repairs a commit which already merged, and nothing
  downstream waits on this chore.
- The escalation bead is the script's to file: one **open** bead per failing run, because the
  `bd list` search behind its marker does not see closed beads, so a run a human already resolved
  can be escalated again. Never file a second one yourself, and never edit or close the one it filed.

## Settled parent

Nothing else closes the parent feature bead, so this stage does it once the merge is on record.
Run the settlement check from the same main checkout, after closing the chore. The reasoning — why
this stage owns the close, which labels count as a merge, and what each verdict means — is in
[REFERENCE.md](../REFERENCE.md).

```bash
node <run-pipeline-stage-scripts>/close-settled-parent.mjs --parent <parent-id>
```

`<run-pipeline-stage-scripts>` is the absolute path to
`skills/workflow/run-pipeline-stage/scripts/`, resolved from wherever that skill was loaded — never
hardcode one harness's install path.

It closes the parent only when every child is closed **and** a closed child carries
`lifecycle:feature-pr` (the merge gate a human closed) or `lifecycle:post-merge`
(`stage:post-merge`). It prints one verdict: `closed`, `skipped: children open`,
`skipped: no merge evidence`, or `skipped: already closed`. Each verdict exits `0`, so a quiet run
is a success and not a failure to escalate.

- Every `skipped` verdict is normal here. The housekeeping chore, or a later run, closes the parent
  once the last child closes; `already closed` means the parent is already done.
- Exit `0` covers `closed` and every `skipped` verdict. A non-zero exit is a bd failure: report it
  under `BLOCKING_ISSUES`, and do not retry the close by hand.
- Never close the parent yourself, and never close it over an open child. Report the printed line.
