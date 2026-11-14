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

## Stage Outcome

- `OUTCOME: SUCCESS` only on exit `0`.
- `OUTCOME: BLOCKED` on exit `1` or `2`, with the report's `reason` under `BLOCKING_ISSUES`.
- This stage changes no files: report `FILES_CHANGED: none`, `COMMIT: none`, `PUSHED: no`.

## Remediation and close

- `OUTCOME: SUCCESS` — close the chore with the run URLs in the close reason. Create nothing.
- `OUTCOME: BLOCKED` — leave the chore **open**, report the exit status, the reason, and the
  escalation bead id when the script filed one. Build no remediation chain: there is no `stage:fix`
  round that repairs a commit which already merged, and nothing downstream waits on this chore.
- The escalation bead is the script's to file, and only once per failing run. Never file a second
  one, and never edit or close the one it filed.
