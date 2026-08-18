# Fleet — Reference

Detailed procedures for the fleet orchestration workflow. See [SKILL.md](./SKILL.md) for the top-level event loop.

---

## Dispatching a Chore Bead

1. **Claim** the bead: `bd update <id> --claim`.
2. **Read its `stage:*` label** from `bd show <id>`.
3. **Load the universal stage runner prompt** from `skills/workflow/run-pipeline-stage/prompts/stage-runner.md`.
4. **Read the parent task context**: follow the `parent-child` dependency to the parent task bead, run `bd show <parent-id>` to get the full task description.
5. **Ensure branch + worktree exist for this parent task** (see _Feature branches and worktrees_ below), then note the worktree path — you'll pass it as `cwd` to {{TOOL:task}}.
6. **Fill in the prompt** — replace placeholders with:
   - Stage from bead label (`stage:<stage>`) for `<stage>`
   - `bd prime` output (held in memory from initialization)
   - Parent task description from `bd show <parent-id>`
   - For `fix` stage: `FILES_CHANGED` from the preceding stage's report (the required changes come from the fix bead's own description — read via `bd show <fix-id>`)
   - For `verify`, `review`, `document` stages: `SUMMARY` and `FILES_CHANGED` from the preceding stage's report
   - Bead ID and log file path (`.agent-cortex/ralph/ralph-<bead-id>.log`)
7. **Call the {{TOOL:task}} tool** with the filled prompt as `prompt` and the worktree path as `cwd`. Store the returned agentId — you need it for step 8 and for log polling.
8. **Map** the agent ID to the bead ID in memory for lookup on completion.

---

## Feature Branches and Worktrees

For each parent task bead (`<parent-id>`):

1. Determine the parent epic (`<epic-id>`) from the task's `epic:<epic-id>` label.
2. Ensure epic branch exists (always based on the latest `origin/main`, never local `main`):
   ```bash
   git fetch origin
   git rev-parse --verify epic/<epic-id> >/dev/null 2>&1 || git branch epic/<epic-id> origin/main
   ```
3. Ensure feature worktree exists:
   ```bash
   git worktree add .agent-cortex/worktrees/<parent-id> -b feature/<parent-id> epic/<epic-id>
   ```
   If `.agent-cortex/worktrees/<parent-id>` already exists, reuse it.
4. All chores for this parent run in `.agent-cortex/worktrees/<parent-id>`. The `feature/<parent-id>` branch is the agent branch for HITL PRs.

---

## Feature PR Gate

When the `document` chore for a parent task completes:

1. Close the `document` chore.
2. Create or update a feature PR immediately from the agent branch to the feature branch (`feature/<parent-id>` into `epic/<epic-id>`):
   ```bash
   gh pr create --base epic/<epic-id> --head feature/<parent-id> --title "[<parent-id>] <task-title>" --body "<summary>"
   ```
   If an open PR already exists, update it instead of creating a duplicate.
3. Report the PR URL in chat as soon as it is created.
4. Find the child HITL task bead for this parent with label `lifecycle:feature-pr` (created by `create-task`).
5. Update that HITL bead with the PR URL/status (comment or note) so the reviewer has the link.
6. Do not schedule new parent features while this HITL PR gate bead remains open.
7. Once the PR is merged, a human closes the HITL PR gate bead. After that, close the parent feature bead:
   ```bash
   bd close <parent-id>
   ```
   Only then continue with next parent features.

---

## Fix Loop

When a verify or review stage fails:

1. **Determine the parent task**: look up the chore bead's parent via `bd show <chore-id>` (follow the `parent-child` dependency).
2. **Count existing fix rounds**: list all chore beads that are children of the parent task with label `stage:fix`. The count of these (including closed ones) is the number of fix rounds already attempted.
3. **Read `maxFixRounds`** from `skills/planning/create-task/pipeline.json` (held in memory since initialization).
4. **If fix rounds ≥ maxFixRounds**: close the parent task bead as failed (`bd close <parent-id> --reason "Max fix rounds reached"`). Do not create another fix chore.
5. **Otherwise, create a fix chore** with the feedback in its description so the fixer agent can read it directly from `bd show`:
   ```bash
   fix_id=$(bd create "[<parent-id>] Fix (round <N>)" --type chore \
     --priority <same as parent> \
     --description "<CHANGES_REQUESTED list or VERIFY_FAILURES list from the triggering REPORT>" -q)
   bd tag $fix_id stage:fix
   bd dep add $fix_id <parent-id> --type parent-child   # fix-chore is child of parent
   ```
6. **Find the verify chore** for this parent task (the chore with label `stage:verify` and a `parent-child` dep to the parent).
7. **Block the verify chore** on the new fix chore:
   ```bash
   bd dep add <verify-id> $fix_id --type blocks          # verify waits for fix
   ```
8. **Reopen the verify chore**:
   ```bash
   bd reopen <verify-id>
   ```
   This ensures the fix chore runs first, then verify re-runs automatically when the fix closes.

---

## Log Polling

Run whenever polling is triggered (timer or agent completion):

1. **Query in-flight beads**: `bd list --status=in_progress --type=chore`. Extract each bead's ID and title.
2. For each in-flight bead, read new lines from its log file (track the next unread line number per bead in memory, starting at 1):
   ```bash
   tail -n +<lastLine> .agent-cortex/ralph/ralph-<bead-id>.log 2>/dev/null
   ```
3. For each bead that has new lines:
   - **Post a chat summary** of new key events (stage transitions and notable events — not every line verbatim):
     ```
     📋 [bead-id] <title>
        coding → verifying  (or whatever transition)
        Tests: 12 passed, 0 failed
     ```
   - Update the in-memory line offset for that bead.
4. If no bead had new lines, post nothing — do not spam the chat with empty polls.

---

## HITL Pause

Proceed here when no chore beads are in-flight, no `stage:*` chore beads are ready, and HITL gate beads are pending (open `lifecycle:feature-pr` beads or epics tagged `awaiting-epic-pr-merge`). Ralph stops rather than burning requests on idle polls.

1. Regenerate `.agent-cortex/ralph/progress.md` one final time — do not delete it.
2. For each epic whose feature beads are all closed but not yet tagged `awaiting-epic-pr-merge`, open/update an epic PR to main:
   ```bash
   gh pr create --base main --head epic/<epic-id> --title "[<epic-id>] Merge epic into main" --body "<epic summary>"
   ```
   Tag each epic bead with `awaiting-epic-pr-merge` until merged.
3. Run:
   ```bash
   bd dolt push
   ```
4. Collect pending HITL gate beads and their PR URLs:
   ```bash
   bd list -l lifecycle:feature-pr -l implementation-type:hitl
   bd list -l awaiting-epic-pr-merge
   ```
   For each bead, run `bd show <id>` to retrieve the PR URL from bead notes.
5. Output the **Pending Human Action** summary:
   ```
   ⏸️  Ralph is paused — human action required before work can continue.

   | Bead ID | Title | Action needed | PR |
   |---------|-------|---------------|----|
   | <id>    | <title> | Review and merge feature PR, then close this bead | <url or "–"> |
   | <id>    | <title> | Review and merge epic PR into main | <url or "–"> |
   ...

   When you've completed the above, prompt me to continue.
   ```
6. **Stop completely.** Do not restart the poll timer. Do not continue the event loop. Wait for the user to re-prompt before doing any further work.

---

## Shutdown

When `bd list --status=in_progress --type=chore` returns no results AND `bd ready` returns no chore beads with `stage:*` labels:

1. Regenerate `.agent-cortex/ralph/progress.md` one final time — do not delete it.
2. For each epic whose feature beads are all closed, open/update an epic PR to main:
   ```bash
   gh pr create --base main --head epic/<epic-id> --title "[<epic-id>] Merge epic into main" --body "<epic summary>"
   ```
   Tag each epic bead with `awaiting-epic-pr-merge` until merged.
3. Run:
   ```bash
   bd dolt push
   ```
4. If any HITL beads were noted during the session, output:
   ```
   All agent work is complete. The following steps require human action before work can continue:

   | Bead ID | Title | Why human action is needed |
   |---------|-------|---------------------------|
   | <id>    | <title> | <HITL reason from bead body> |
   ...

   Run `bd show <id>` for full details on each step.
   ```
5. If any epics are tagged `awaiting-epic-pr-merge`, output a **Pending Epic Review** table (epic bead ID, branch, PR URL) and stop.
6. If no HITL beads remain, output:
   ```
   All beads complete.
   ```

---

## State Files

| File | Purpose |
|------|---------|
| `.agent-cortex/ralph/progress.md` | Human-readable snapshot. Regenerate: `workspace="/abs/path"; pnpm --prefix skills/workflow/run-pipeline-stage/scripts exec tsx generate-progress.ts --workspace "$workspace" > "$workspace/.agent-cortex/ralph/progress.md"`. `workspace` must be an **absolute** path — never `.` or `$(pwd)`. **Never hand-edit.** |
| `.agent-cortex/ralph/ralph-*.log` | Per-bead log files written by subagents (e.g. `.agent-cortex/ralph/ralph-abc-123.log`). |

All orchestration state is derived from beads:

| Question | How to answer |
|----------|---------------|
| What is in-flight? | `bd list --status=in_progress --type=chore` |
| What is ready? | `bd ready` — filter for chores with `stage:*` labels |
| What stage is a bead in? | Read the `stage:*` label from `bd show <id>` |
| How many fix rounds? | Count chore beads with label `stage:fix` that are children of the parent task. Read `maxFixRounds` from `skills/planning/create-task/pipeline.json`. |
| Which features are review-gated? | Find open child task beads labelled `lifecycle:feature-pr` and `implementation-type:hitl` |
| Which epics are review-gated? | `bd list -l awaiting-epic-pr-merge` |
