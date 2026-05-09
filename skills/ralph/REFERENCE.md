# Fleet — Reference

Detailed procedures for the fleet orchestration workflow. See [SKILL.md](./SKILL.md) for the top-level event loop.

---

## Dispatching a Chore Bead

1. **Claim** the bead: `bd update <id> --claim`.
2. **Read its `stage:*` label** from `bd show <id>`.
3. **Load the prompt template** from `skills/create-task/templates/<stage>.md`.
4. **Read the parent task context**: follow the `parent-child` dependency to the parent task bead, run `bd show <parent-id>` to get the full task description.
5. **Ensure branch + worktree exist for this parent task** (see _Feature branches and worktrees_ below), then run the subagent from that worktree path instead of repo root.
6. **Fill in the template** — replace placeholders with:
   - `bd prime` output (held in memory from initialization)
   - Parent task description from `bd show <parent-id>`
   - For `fix` stage: the `CHANGES_REQUESTED` or `VERIFY_FAILURES` from the triggering report, and `FILES_CHANGED`
   - For `verify`, `review`, `document` stages: `SUMMARY` and `FILES_CHANGED` from the preceding stage's report
   - Bead ID and log file path (`.ralph-<bead-id>.log`)
7. **Spawn** a subagent in **background** mode with the filled template as the prompt.
8. **Map** the agent ID to the bead ID in memory for lookup on completion.

---

## Feature Branches and Worktrees

For each parent task bead (`<parent-id>`):

1. Determine the parent epic (`<epic-id>`) from the task's `epic:<epic-id>` label.
2. Ensure epic branch exists:
   ```bash
   git fetch origin
   git rev-parse --verify epic/<epic-id> >/dev/null 2>&1 || git branch epic/<epic-id> origin/main
   ```
3. Ensure feature worktree exists:
   ```bash
   git worktree add .worktrees/<parent-id> -b feature/<parent-id> epic/<epic-id>
   ```
   If `.worktrees/<parent-id>` already exists, reuse it.
4. All chores for this parent run in `.worktrees/<parent-id>`.

---

## Feature PR Gate

When the `document` chore for a parent task completes:

1. Close the `document` chore.
2. Create or update a feature PR from `feature/<parent-id>` into `epic/<epic-id>`:
   ```bash
   gh pr create --base epic/<epic-id> --head feature/<parent-id> --title "[<parent-id>] <task-title>" --body "<summary>"
   ```
   If an open PR already exists, update it instead of creating a duplicate.
3. Tag the parent bead:
   ```bash
   bd tag <parent-id> awaiting-feature-pr-merge
   ```
4. Do not schedule new parent features while any `awaiting-feature-pr-merge` parent exists.
5. Poll merge state. Once merged:
   ```bash
   bd label remove <parent-id> awaiting-feature-pr-merge
   bd close <parent-id>
   ```
   Only then continue with next parent features.

---

## Fix Loop

When a verify or review stage fails:

1. **Determine the parent task**: look up the chore bead's parent via `bd show <chore-id>` (follow the `parent-child` dependency).
2. **Count existing fix rounds**: list all chore beads that are children of the parent task with label `stage:fix`. The count of these (including closed ones) is the number of fix rounds already attempted.
3. **Read `maxFixRounds`** from `skills/create-task/pipeline.json` (held in memory since initialization).
4. **If fix rounds ≥ maxFixRounds**: close the parent task bead as failed (`bd close <parent-id> --reason "Max fix rounds reached"`). Do not create another fix chore.
5. **Otherwise, create a fix chore** (`bd dep add A B` = "A depends on B"):
   ```bash
   bd create "[<parent-id>] Fix (round <N>)" --type chore --priority <same as parent>
   bd tag <fix-id> stage:fix
   bd dep add <fix-id> <parent-id> --type parent-child   # fix-chore is child of parent
   ```
6. **Find the verify chore** for this parent task (the chore with label `stage:verify` and a `parent-child` dep to the parent).
7. **Block the verify chore** on the new fix chore:
   ```bash
   bd dep add <verify-id> <fix-id> --type blocks          # verify waits for fix
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
   tail -n +<lastLine> .ralph-<bead-id>.log 2>/dev/null
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

## Shutdown

When `bd list --status=in_progress --type=chore` returns no results AND `bd ready` returns no chore beads with `stage:*` labels:

1. Regenerate `.ralph-progress.md` one final time — do not delete it.
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
| `.ralph-progress.md` | Human-readable snapshot generated by `npx tsx skills/run-beads/scripts/generate-progress.ts`. **Never hand-edit.** |
| `.ralph-*.log` | Per-bead log files written by subagents (e.g. `.ralph-abc-123.log`). |

All orchestration state is derived from beads:

| Question | How to answer |
|----------|---------------|
| What is in-flight? | `bd list --status=in_progress --type=chore` |
| What is ready? | `bd ready` — filter for chores with `stage:*` labels |
| What stage is a bead in? | Read the `stage:*` label from `bd show <id>` |
| How many fix rounds? | Count chore beads with label `stage:fix` that are children of the parent task |
| Which features are review-gated? | `bd list -l awaiting-feature-pr-merge` |
| Which epics are review-gated? | `bd list -l awaiting-epic-pr-merge` |
