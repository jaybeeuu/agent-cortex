## Project context
<bd prime output — verbatim>

## Task
<bd show <id> output — verbatim>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`
Log stage start, the check command and its exit status, the escalation bead id if one was filed,
and stage complete (see Progress Logging in run-pipeline-stage skill).

## Instructions
This stage verifies the merge, so **do not work in the bead worktree**. Run the check from the
repository's main checkout — the directory that holds `.agent-cortex/worktrees/` — because the
commit it reads landed on the base branch, not on the feature branch.

1. **Run the check once** from the main checkout:
   ```bash
   node <ralph-scripts>/post-merge-check.mjs
   ```
   `<ralph-scripts>` is the absolute path to `skills/workflow/ralph/scripts/`, resolved from wherever
   that skill was loaded. It prints a JSON report and exits `0`, `1`, or `2`. Pass `--base <branch>`
   only when the base branch is not the repository's default branch, and `--commit <sha>` only when
   the merge commit is not the base branch's tip. A run still in flight when the wait window closes
   is a report, not a verdict: the playbook's _Watch transport_ section says how to wait for it, and
   which mechanism your harness supplies.

2. **Act on the exit status alone.** The status *is* the verdict; do not re-run the check to get a
   different answer, do not retry the workflow, and never re-run the GitHub workflow yourself.

   | Exit | Meaning | What you do |
   |---|---|---|
   | `0` | Every run for the merge commit passed | Report the run URLs and **close** this chore as `SUCCESS` |
   | `1` | A run for the merge commit failed | The script has already filed **one** P1 escalation bead carrying the run URL and the failing job. Report its id and the run URL, leave this chore **open**, and close nothing else |
   | `2` | Inconclusive: no run for the commit, a run still in flight past the wait window, a conclusion that is neither pass nor failure, or a repository `gh` cannot see as GitHub | Report the `reason` the report printed and leave this chore **open**. Nothing was filed and nothing needs filing |

3. **Never repair the merge from here.** Reverting, re-running a workflow, editing the merged
   commit, and reopening the parent feature bead are all outside this stage. Exit `1` hands the
   failure to a human through the escalation bead; the pipeline fixes nothing it did not build.

4. **Build no remediation chain.** A failure here is evidence about a commit that already landed,
   not a fault in a file a `stage:fix` round can repair. Create no `stage:fix` chore and no fresh
   stage chore on any exit status, and re-block no later stage.

5. **Close only on `0`.** On `1` and `2` leave the chore open — return it to `open` status if your
   claim moved it to `in_progress` — so the open chore is the record that the merge is unresolved.
   Do not close the parent feature bead and do not edit the escalation bead the script filed.

End your response with a ---REPORT--- block. The `run-pipeline-stage` skill's
`prompts/stage-runner.md` holds the authoritative REPORT contract — if this block and that
prompt differ, follow the prompt and correct this template.
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: post-merge
SUMMARY: <2–3 sentences: the exit status, the runs read, and what was filed or left open>
FILES_CHANGED: none
COMMIT: none
PUSHED: no
PR: none
OUTCOME: <SUCCESS on exit 0; BLOCKED on exit 1 or 2>
BLOCKING_ISSUES:         ← include only if OUTCOME is BLOCKED; one line per reason
- <exit status, the report's reason, and the run URL or the surviving uncertainty>
---
