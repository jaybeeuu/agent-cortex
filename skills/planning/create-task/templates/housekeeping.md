## Project context
<bd prime output — verbatim>

## Task
<bd show <id> output — verbatim>

## Progress log
Write progress to: `.agent-cortex/ralph/ralph-<bead-id>.log`
Log stage start, each pruner run with its exit status, and stage complete (see Progress Logging in
run-pipeline-stage skill).

## Instructions
This stage removes worktrees, so **do not work in the bead worktree**. Run every command from the
repository's main checkout — the directory that holds `.agent-cortex/worktrees/` — because the
worktree this run may remove can be your own.

1. **Run the pruner once** from the main checkout:
   ```bash
   node <ralph-scripts>/prune-worktrees.mjs
   ```
   `<ralph-scripts>` is the absolute path to `skills/workflow/ralph/scripts/`, resolved from wherever
   that skill was loaded. Read the per-worktree report it prints — it lists every scanned worktree,
   its classification (`closed-bead`, `open-bead`, `orphan`, `unclassified`) and its outcome
   (`removed`, `kept`, `refused`).

2. **Retry once on a non-zero exit.** Exit status `1` means at least one scanned worktree survived
   the run, and an open bead counts as survival — a normal run against a live backlog exits `1`. So
   run the same command a second time when the first run exits non-zero. One retry, never more.

3. **Decide the outcome from the report, not the exit status.** After the retry:
   - **SUCCESS** — no worktree classified `closed-bead` is left in `refused` state. Report every
     worktree the run removed and every one it kept, with the printed reason.
   - **BLOCKED** — a `closed-bead` worktree is still `refused`, or the pruner could not run at all
     (missing node, unreadable directory). A refused closed-bead worktree is a worktree this run did
     not remove, whatever the reason printed.

4. **Never close this chore over a worktree the script did not remove.** On BLOCKED, leave the chore
   open, report the surviving worktrees and their reasons, and follow the remediation section of
   `prompts/stage-runner.md`. A `kept` or `refused` entry for an open bead is a normal report, not a
   failure.

Do not delete a worktree by hand, do not pass `--remove-orphans`, and do not edit the pruner. This
stage reports what the script did.

End your response with a ---REPORT--- block. The `run-pipeline-stage` skill's
`prompts/stage-runner.md` holds the authoritative REPORT contract — if this block and that prompt
differ, follow the prompt and correct this template.
---REPORT---
BEAD_ID: <id>
STAGE_COMPLETED: housekeeping
SUMMARY: <2–3 sentences: worktrees removed, worktrees kept and why>
FILES_CHANGED: none
COMMIT: none
PUSHED: no
PR: none
OUTCOME: <SUCCESS|BLOCKED>
BLOCKING_ISSUES:         ← include only if OUTCOME is BLOCKED; one line per issue
- <worktree path and the reason the pruner printed>
---
