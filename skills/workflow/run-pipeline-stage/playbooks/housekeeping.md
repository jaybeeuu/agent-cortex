# Stage Playbook: housekeeping

This stage runs after the human merge gate and is last in the chain. It removes the worktrees of
closed beads and changes no files.

## Stage Instructions

1. **Work from the main checkout.** Run every command from the repository's main checkout — the
   directory that holds `.agent-cortex/worktrees/` — never from a bead worktree. The worktree this
   run removes can be the one you are standing in.

2. **Learn which base the bead landed on, then run the pruner once.** A bead runs on
   `feature/<id>`, cut from the remote default branch, or — inside a multi-feature epic — from
   `epic/<epic-id>`. Its content reaches the remote default branch only in the first case, so the
   pruner must be told the second. The base to pass is the **remote** epic branch: ralph creates the
   local `epic/<epic-id>` branch once and never fast-forwards it, and a feature PR squash-merges into
   `origin/epic/<epic-id>` on the forge, so only the remote-tracking ref holds the features' landed
   content. Run `git fetch origin` first, so that ref is current. Then decide from the bead graph:
   - Read this chore's parent feature bead (`bd show <bead-id> --json` prints it as `parent`), then
     read that bead's labels (`bd show <parent-id> --json`).
   - **No `epic:<epic-id>` label** — the bead landed on the remote default branch. Pass no `--base`.
   - **An `epic:<epic-id>` label, and two or more feature children** — a multi-feature epic, so the
     bead landed on the remote epic branch. Pass `--base origin/epic/<epic-id>`. Count the feature
     children from `bd children <epic-id> --json`: count the entries whose `issue_type` is `feature`.
     The plain `bd children` view prints `chore` but omits a task's type, so it cannot tell a feature
     child from a task child. Chores do not count; `ralph`'s _Feature Branches and Worktrees_ step 1
     draws the same line.
   - **An `epic:<epic-id>` label with exactly one feature child** — a single-feature epic, which
     skips the epic branch. Pass no `--base`.
   - **`origin/epic/<epic-id>` does not resolve** (`git rev-parse --verify --quiet
     refs/remotes/origin/epic/<epic-id>` fails) — the epic has already landed and its remote branch
     is gone, so pass no `--base`. Never fall back to the local `epic/<epic-id>` branch: it did not
     advance with the epic, so the content test refuses every worktree against it.

   ```bash
   git fetch origin
   # a feature of a multi-feature epic, when refs/remotes/origin/epic/<epic-id> resolves
   node <ralph-scripts>/prune-worktrees.mjs --base origin/epic/<epic-id>
   # every other bead
   node <ralph-scripts>/prune-worktrees.mjs
   ```

   `<ralph-scripts>` is the absolute path to `skills/workflow/ralph/scripts/`, resolved from wherever
   that skill was loaded. The second line of the report is `Base: <ref>`, the ref the content test
   used, and a refusal names that same ref, so a reader can tell which base decided it. Read the
   per-worktree report that follows: every scanned worktree, its classification (`closed-bead`,
   `open-bead`, `orphan`, `unclassified`) and its outcome (`removed`, `kept`, `refused`). A `removed`
   entry also prints `proven: <rule> at <sha>` — the commit that proved its content landed — and a
   `refused` entry prints the reasons it stayed. Report whichever line the pruner printed.

3. **Retry once on a non-zero exit.** Exit status `1` means at least one scanned worktree survived,
   and an open bead counts as survival, so a normal run against a live backlog exits `1`. Run the
   same command a second time — the same `--base` — when the first run exits non-zero. One retry,
   never more.

4. **Decide from the per-worktree report, not from the exit status.** After the retry:
   - **SUCCESS** — no `closed-bead` worktree is left in `refused` state. Report every worktree the
     run removed and every one it kept, with the printed proof or reason.
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
- `OUTCOME: SUCCESS` — record the trail entry, then
  `bd close <id> --reason="SUCCESS: <removed/kept summary>"`. Then close the parent if it is
  settled (see _Settled parent_ below). Create nothing: this is the last stage and its closed chore
  ends the pipeline.
- `OUTCOME: BLOCKED` — **do not close the bead.** Leave it open: return it to `open` status
  (`bd update <id> --status open`) if your claim moved it to `in_progress`. Report the surviving
  worktrees and hand the chore back to a human. Create no `stage:fix` chore and no fresh
  `stage:housekeeping` chore — a fix round repairs files, and this stage repairs none. Run no
  settlement check: an open chore keeps the parent open, and that is the correct record.
- **No downstream re-block.** This stage sits behind the PR gate rather than behind another stage, so
  no later stage needs wiring behind a fresh instance.
- Report `COMMIT: none`, `PUSHED: no`, and `PR: none`.

## Settled parent

This is the last stage, so it is the run that closes the parent feature bead once the merge is on
record and no child remains open. After closing the chore, run the settlement check from the same
main checkout:

```bash
node <run-pipeline-stage-scripts>/close-settled-parent.mjs --parent <parent-id>
```

`<run-pipeline-stage-scripts>` is the absolute path to
`skills/workflow/run-pipeline-stage/scripts/`, resolved from wherever that skill was loaded — never
hardcode one harness's install path.

It closes the parent only when every child is closed **and** a closed child carries
`lifecycle:feature-pr` (the merge gate a human closed) or `lifecycle:post-merge`
(`stage:post-merge`). It prints one verdict: `closed`, `skipped: children open`,
`skipped: no merge evidence`, or `skipped: already closed`.

- `skipped: no merge evidence` is the answer for a parent whose children were all closed by hand
  before any merge happened. Report the line and leave the parent open: closing it would claim a
  merge nothing recorded.
- Exit `0` covers `closed` and every `skipped` verdict. A non-zero exit is a bd failure: report it
  under `BLOCKING_ISSUES`, and do not close the parent by hand.
- The pruner kept this parent's own worktree as `open-bead`, because the parent still read `open`
  when the pruner ran. Report it as `kept`; the next housekeeping run removes it once the parent
  reads `closed`. Never remove it by hand to make the report tidy.
