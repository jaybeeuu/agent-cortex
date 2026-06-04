# Fleet — Reference

Detailed procedures for the fleet orchestration workflow. See [SKILL.md](./SKILL.md) for the top-level flow.

---

## Running a Pipeline Stage

Each pipeline stage within a parent bead is dispatched via the `subagent` tool. The `subagent` tool handles prompt composition (reading playbooks from `promptPaths`, stripping frontmatter, concatenating with the task context) and spawns an isolated PI subprocess with the stage-appropriate model and tools.

1. **Read the parent task context**: run `bd show <parent-id>` to get the full task description, acceptance criteria, and design notes.
2. **Identify the stage key** from the current pipeline position (e.g. `coding`, `verifying`, `reviewing`, `documenting`, `fixing`).
3. **Build the task context** — a string containing:
   - `bd prime` output (held in memory from initialization)
   - Parent task description from `bd show <parent-id>`
   - For `coding`, `test-writing`, `test-reviewing` stages: design notes from the parent bead
   - For `verifying` stage: `SUMMARY` and `FILES_CHANGED` from the preceding stage's REPORT
   - For `reviewing` stage: `SUMMARY` and `FILES_CHANGED` from the verify REPORT
   - For `fixing` stage: the `CHANGES_REQUESTED` list or `VERIFY_FAILURES` from the triggering REPORT (the required changes come from the fix bead's own description — read via `bd show <fix-id>`)
   - For `documenting` stage: `SUMMARY` and `FILES_CHANGED` from the review REPORT
4. **Ensure branch + worktree exist** for this parent task (see _Feature branches and worktrees_ below), then call `subagent` with `cwd` set to the worktree:

   ```
   subagent({
     stage: "<stage-key>",
     promptPaths: ["skills/run-beads/playbooks/<stage-key>.md"],
     task: "<built task context>",
     cwd: ".agent-cortex/worktrees/<parent-id>"
   })
   ```

5. **Parse the `---REPORT---` block** from the subagent's output:

   ```text
   ---REPORT---
   BEAD_ID: <id>
   STAGE_COMPLETED: <stage-key>
   SUMMARY: <2–3 sentence summary>
   FILES_CHANGED: <comma-separated list, or "none">
   OUTCOME: <SUCCESS|BLOCKED>
   BLOCKING_ISSUES:                               ← only if OUTCOME is BLOCKED
   - <specific blocking issue>
   ---
   ```

6. **Handle the outcome** per the stage outcome table below.

### Stage outcome table

| Stage | Outcome | Next action |
|-------|---------|-------------|
| `coding` | SUCCESS | Proceed to `test-writing` |
| `coding` | BLOCKED | Report blocking issues and pause for human input. Do not continue the pipeline. |
| `test-writing` | SUCCESS | Proceed to `test-reviewing` |
| `test-writing` | BLOCKED | Report blocking issues and pause. |
| `test-reviewing` | SUCCESS | Proceed to `verifying` |
| `test-reviewing` | BLOCKED | Run the **fix loop** (tests need correction before verifying). |
| `verifying` | SUCCESS (all tests pass) | Proceed to `reviewing` |
| `verifying` | FAIL (tests fail or BLOCKED) | Run the **fix loop**. |
| `reviewing` | APPROVED | Proceed to `documenting` |
| `reviewing` | CHANGES_REQUESTED | Run the **fix loop**. |
| `fixing` | SUCCESS | Return to `verifying` (re-verify after fix). |
| `fixing` | BLOCKED | Report blocking issues and pause. |
| `documenting` | SUCCESS | Open feature PR (see _Feature PR Gate_). |
| `documenting` | BLOCKED | Report blocking issues and pause. |

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
4. All stages for this parent run in `.agent-cortex/worktrees/<parent-id>`. Set `cwd` to this path in every `subagent` call. The `feature/<parent-id>` branch is the agent branch for HITL PRs.

---

## Feature PR Gate

When the `documenting` stage for a parent task completes successfully:

1. Create or update a feature PR immediately from the agent branch to the feature branch (`feature/<parent-id>` into `epic/<epic-id>`):
   ```bash
   gh pr create --base epic/<epic-id> --head feature/<parent-id> --title "[<parent-id>] <task-title>" --body "<summary>"
   ```
   If an open PR already exists, update it instead of creating a duplicate.
2. Report the PR URL in chat as soon as it is created.
3. Find the child HITL task bead for this parent with label `lifecycle:feature-pr` (created by `create-task`).
4. Update that HITL bead with the PR URL/status (comment or note) so the reviewer has the link.
5. Do not schedule new parent features while this HITL PR gate bead remains open.
6. Once the PR is merged, a human closes the HITL PR gate bead. After that, close the parent feature bead:
   ```bash
   bd close <parent-id>
   ```
   Only then continue with next parent features.

---

## Fix Loop

When a verifying, test-reviewing, or reviewing stage fails:

1. **Determine the parent task**: look up the chore bead's parent via `bd show <chore-id>` (follow the `parent-child` dependency).
2. **Count existing fix rounds**: list all chore beads that are children of the parent task with label `stage:fix`. The count of these (including closed ones) is the number of fix rounds already attempted.
3. **Read `maxFixRounds`** from `skills/create-task/pipeline.json` (held in memory since initialization).
4. **If fix rounds ≥ maxFixRounds**: close the parent task bead as failed (`bd close <parent-id> --reason "Max fix rounds reached"`). Do not create another fix chore.
5. **Otherwise, create a fix chore** with the feedback in its description so the fixing subagent can read it directly from `bd show`:
   ```bash
   fix_id=$(bd create "[<parent-id>] Fix (round <N>)" --type chore \
     --priority <same as parent> \
     --description "<CHANGES_REQUESTED list or VERIFY_FAILURES list from the triggering REPORT>" -q)
   bd tag $fix_id stage:fix
   bd dep add $fix_id <parent-id> --type parent-child   # fix-chore is child of parent
   ```
6. **Run the fix stage** via subagent:
   ```
   subagent({
     stage: "fixing",
     promptPaths: ["skills/run-beads/playbooks/fixing.md"],
     task: "<parent context + fix requirements from fix bead>",
     cwd: ".agent-cortex/worktrees/<parent-id>"
   })
   ```
7. **Close the fix chore** if the fix stage succeeds, then return to `verifying` (re-run verify stage via subagent). If the fix stage blocks, report issues and pause.

---

## HITL Pause

Proceed here when all parent beads have been pushed through their pipeline and are awaiting human review (open `lifecycle:feature-pr` beads or epics tagged `awaiting-epic-pr-merge`). Ralph stops rather than burning requests on idle loops.

1. For each epic whose feature beads are all closed but not yet tagged `awaiting-epic-pr-merge`, open/update an epic PR to main:
   ```bash
   gh pr create --base main --head epic/<epic-id> --title "[<epic-id>] Merge epic into main" --body "<epic summary>"
   ```
   Tag each epic bead with `awaiting-epic-pr-merge` until merged.
2. Run:
   ```bash
   bd dolt push
   ```
3. Collect pending HITL gate beads and their PR URLs:
   ```bash
   bd list -l lifecycle:feature-pr -l implementation-type:hitl
   bd list -l awaiting-epic-pr-merge
   ```
   For each bead, run `bd show <id>` to retrieve the PR URL from bead notes.
4. Output the **Pending Human Action** summary:
   ```
   ⏸️  Ralph is paused — human action required before work can continue.

   | Bead ID | Title | Action needed | PR |
   |---------|-------|---------------|----|
   | <id>    | <title> | Review and merge feature PR, then close this bead | <url or "–"> |
   | <id>    | <title> | Review and merge epic PR into main | <url or "–"> |
   ...

   When you've completed the above, prompt me to continue.
   ```
5. **Stop completely.** Do not continue processing beads. Wait for the user to re-prompt before doing any further work.

---

## Shutdown

When all parent beads have been processed and no HITL gates remain:

1. For each epic whose feature beads are all closed, open/update an epic PR to main:
   ```bash
   gh pr create --base main --head epic/<epic-id> --title "[<epic-id>] Merge epic into main" --body "<epic summary>"
   ```
   Tag each epic bead with `awaiting-epic-pr-merge` until merged.
2. Run:
   ```bash
   bd dolt push
   ```
3. If any HITL beads were noted during the session, output:
   ```
   All agent work is complete. The following steps require human action before work can continue:

   | Bead ID | Title | Why human action is needed |
   |---------|-------|---------------------------|
   | <id>    | <title> | <HITL reason from bead body> |
   ...

   Run `bd show <id>` for full details on each step.
   ```
4. If any epics are tagged `awaiting-epic-pr-merge`, output a **Pending Epic Review** table (epic bead ID, branch, PR URL) and stop.
5. If no HITL beads remain, output:
   ```
   All beads complete.
   ```

---

## State

All orchestration state is derived from beads:

| Question | How to answer |
|----------|---------------|
| What is in-flight? | `bd list --status=in_progress --type=chore` |
| What is ready? | `bd ready` — filter for tasks with `implementation-type:afk` |
| What stage is a bead in? | Read the current pipeline position from the last completed stage chore |
| How many fix rounds? | Count chore beads with label `stage:fix` that are children of the parent task |
| Which features are review-gated? | Find open child task beads labelled `lifecycle:feature-pr` and `implementation-type:hitl` |
| Which epics are review-gated? | `bd list -l awaiting-epic-pr-merge` |
