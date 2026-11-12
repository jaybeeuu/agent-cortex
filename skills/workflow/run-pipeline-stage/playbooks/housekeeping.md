# Stage Playbook: housekeeping

This stage runs after the human merge gate and is last in the chain. It removes the worktrees of
closed beads and changes no files.

## Stage Instructions

1. **Work from the main checkout.** Run every command from the repository's main checkout — the
   directory that holds `.agent-cortex/worktrees/` — never from a bead worktree. The worktree this
   run removes can be the one you are standing in.

2. **Run the pruner once:**
   ```bash
   node <ralph-scripts>/prune-worktrees.mjs
   ```
   `<ralph-scripts>` is the absolute path to `skills/workflow/ralph/scripts/`, resolved from wherever
   that skill was loaded. Read the per-worktree report it prints: every scanned worktree, its
   classification (`closed-bead`, `open-bead`, `orphan`, `unclassified`) and its outcome (`removed`,
   `kept`, `refused`).

3. **Retry once on a non-zero exit.** Exit status `1` means at least one scanned worktree survived,
   and an open bead counts as survival, so a normal run against a live backlog exits `1`. Run the
   same command a second time when the first run exits non-zero. One retry, never more.

4. **Decide from the per-worktree report, not from the exit status.** After the retry:
   - **SUCCESS** — no `closed-bead` worktree is left in `refused` state. Report every worktree the
     run removed and every one it kept, with the printed reason.
   - **BLOCKED** — a `closed-bead` worktree is still `refused` after the retry, or the pruner could
     not run at all (missing node, unreadable directory). A refused `closed-bead` worktree is a
     worktree this run did not remove, whatever reason it printed.

5. **Never close over a worktree the script did not remove.** Do not delete a worktree by hand, do
   not pass `--remove-orphans`, and do not edit the pruner. This stage reports what the script did.

## Stage Outcome

- **No commit and no push.** This stage changes no files, so report `COMMIT: none` and
  `PUSHED: no` on both outcomes. Do not create an empty commit.
- Set `OUTCOME: SUCCESS` when every `closed-bead` worktree is gone after the retry. `FILES_CHANGED`
  is `none`.
- Set `OUTCOME: BLOCKED` when a `closed-bead` worktree survived the retry, or the pruner could not
  run. List each surviving worktree with the printed reason under `BLOCKING_ISSUES`.
- A `kept` or `refused` entry for an open bead is a normal report, not a failure.

## Remediation and close

- **This stage is the exception to close-on-both-outcomes.** Nothing downstream waits on its close,
  so the bead's own state is the report.
- `OUTCOME: SUCCESS` — append the notes and the progress log, then
  `bd close <id> --reason="SUCCESS: <removed/kept summary>"`. Create nothing: this is the last stage
  and its closed chore ends the pipeline.
- `OUTCOME: BLOCKED` — **do not close the bead.** Leave it open: return it to `open` status
  (`bd update <id> --status open`) if your claim moved it to `in_progress`. Report the surviving
  worktrees and hand the chore back to a human. Create no `stage:fix` chore and no fresh
  `stage:housekeeping` chore — a fix round repairs files, and this stage repairs none.
- **No downstream re-block.** This stage sits behind the PR gate rather than behind another stage, so
  no later stage needs wiring behind a fresh instance.
- Report `COMMIT: none`, `PUSHED: no`, and `PR: none`.
