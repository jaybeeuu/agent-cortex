# Ralph — Reference

Detailed procedures for the ralph orchestration workflow. See [SKILL.md](./SKILL.md) for the top-level event loop; this file holds the per-procedure detail that would overflow the main skill file.

---

## Dispatching a Chore Bead

1. **Claim** the bead: `bd update <id> --claim`.
2. **Read its `stage:*` label** from `bd show <id>`.
3. **Load the universal stage runner prompt** from `skills/workflow/run-pipeline-stage/prompts/stage-runner.md`.
4. **Read the parent task context**: follow the `parent-child` dependency to the parent task bead, run `bd show <parent-id>` to get the full task description.
5. **Ensure branch + worktree exist for this parent task** (see _Feature branches and worktrees_ below), then note the worktree path — you'll pass it as `cwd` to {{TOOL:task}}.
6. **Fill in the prompt** — replace placeholders with:
   - Stage from bead label (`stage:<stage>`) for `<stage>`
   - The leaf execution bead ID and its `bd show` output for the bead specification. Do **not** inject `bd prime` output — the stage runner runs `bd prime` itself if it needs project context
   - Parent task description from `bd show <parent-id>`
   - For `fix` stage: `FILES_CHANGED` from the preceding stage's report (the required changes come from the fix bead's own description — read via `bd show <fix-id>`)
   - For `verify`, `review`, `document` stages: `SUMMARY` and `FILES_CHANGED` from the preceding stage's report
   - Log file path `.agent-cortex/ralph/ralph-<parent-id>.log` — logs are keyed by **parent** bead ID, so every stage chore of a feature appends to the same file
7. **Call the {{TOOL:task}} tool** with the filled prompt as `prompt` and the worktree path as `cwd`. Store the returned agentId — you need it for step 8 and for log polling.
8. **Map** the agent ID to the bead ID in memory for lookup on completion.

---

## Feature Branches and Worktrees

For each parent task bead (`<parent-id>`):

1. Determine the parent epic (`<epic-id>`) from the task's `epic:<epic-id>` label and count its feature task children (`bd children <epic-id>`, excluding chores). An epic with exactly one feature child is a **single-feature epic**.
2. **Single-feature epics (1 feature child)**: skip the epic branch entirely. Base `feature/<parent-id>` directly on `origin/main`; its HITL PR targets `main`, and no epic PR is opened later.
3. **Multi-feature epics (2+ feature children)**: ensure the epic branch exists (always based on the latest `origin/main`, never local `main`):
   ```bash
   git fetch origin
   git rev-parse --verify epic/<epic-id> >/dev/null 2>&1 || git branch epic/<epic-id> origin/main
   ```
4. Ensure feature worktree exists (base on `epic/<epic-id>` for multi-feature epics, `origin/main` for single-feature):
   ```bash
   # <base> is epic/<epic-id> for multi-feature epics, origin/main for single-feature
   git worktree add .agent-cortex/worktrees/<parent-id> -b feature/<parent-id> <base>
   ```
   If `.agent-cortex/worktrees/<parent-id>` already exists, reuse it.
5. All chores for this parent run in `.agent-cortex/worktrees/<parent-id>`. The `feature/<parent-id>` branch is the agent branch for HITL PRs.

---

## Feature PR Gate

When the `document` chore for a parent task completes:

1. Confirm the document worker closed its own chore (`bd show <id>` reads `closed`); do not close it yourself.
2. Create or update a feature PR immediately from the agent branch to the feature branch (`feature/<parent-id>` into `epic/<epic-id>`; into `main` for single-feature epics):
   ```bash
   # <base> is epic/<epic-id> for multi-feature epics, main for single-feature
   gh pr create --base <base> --head feature/<parent-id> --title "[<parent-id>] <task-title>" --body "<summary>"
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

## Cap Backstop (read-only)

Ralph never builds remediation. The worker that fails a stage creates its own `stage:fix` chore, a fresh instance of the failed stage blocked on that fix, and re-blocks the later stages behind the fresh bead (see the `run-pipeline-stage` skill, _Remediation Children_). Ralph only guards the cap, and only reads:

1. **Read `maxFixRounds`** from `skills/planning/create-task/pipeline.json` (held in memory since initialization).
2. **Count existing fix rounds** for the parent — closed chores count:
   ```bash
   fix_rounds=$(bd children <parent-id> --json | grep -c '"stage:fix"')
   ```
3. **Before dispatching any `stage:*` chore of that parent**, if `fix_rounds >= maxFixRounds`: create nothing and block the parent, so a human sees it in the shutdown summary:
   ```bash
   bd update <parent-id> --status blocked \
     --append-notes "[<ISO-timestamp>] max fix rounds reached (<fix_rounds>/<maxFixRounds>)"
   ```
4. Ralph does **not** close the parent as failed and does **not** reopen or re-wire any chore — the worker already closed the failed leaf bead and the fresh stage bead is already blocked on its fix.

---

## Log Polling

Run whenever polling is triggered (timer or agent completion):

1. **Query in-flight beads**: `bd list --status=in_progress --type=chore`. Extract each bead's ID and title.
2. For each in-flight bead, read new lines from its **parent's** log file — logs are keyed by **parent** bead ID, so all stages of a feature share one file. Track the next unread line number per parent in memory, starting at 1:
   ```bash
   tail -n +<lastLine> .agent-cortex/ralph/ralph-<parent-id>.log 2>/dev/null
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

1. For each **multi-feature** epic whose feature beads are all closed but not yet tagged `awaiting-epic-pr-merge`, open/update an epic PR to main (skip single-feature epics — their feature branch PRs already target `main`):
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
5. **Stop completely.** Do not restart the poll timer. Do not continue the event loop. Wait for the user to re-prompt before doing any further work.

---

## Shutdown

When `bd list --status=in_progress --type=chore` returns no results AND `bd ready` returns no chore beads with `stage:*` labels:

1. For each **multi-feature** epic whose feature beads are all closed, open/update an epic PR to main (skip single-feature epics — no epic branch exists):
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
5. If any epics are tagged `awaiting-epic-pr-merge`, output a **Pending Epic Review** table (epic bead ID, branch, PR URL) and stop.
6. If no HITL beads remain, output:
   ```
   All beads complete.
   ```

---

## State Files

Status is read from beads — there is no rendered status document to build or refresh:

```bash
bd list --parent <parent-id>   # every chore for a feature, with its state
bd ready                       # the next dispatchable work
bd show <id>                   # full detail, including the worker's notes
```

| File | Purpose |
|------|---------|
| `.agent-cortex/ralph/state.json` | Runtime bookkeeping only: the poll-timer shellId (Copilot) and the in-flight agent-ID→bead mapping. Shape: `{ "timerShellId": null, "inflight": [ { "choreId": "...", "parentId": "...", "title": "...", "agentId": "...", "logLine": 1 } ] }`. Initialise at startup with `{ "timerShellId": null, "inflight": [] }`. Update after every dispatch and every agent completion. **Never hand-edit.** |
| `.agent-cortex/ralph/ralph-*.log` | Per-parent log files written by subagents — every stage chore of a feature appends to `.agent-cortex/ralph/ralph-<parent-id>.log` (e.g. `ralph-abc-123.log`). |

All task state is derived from beads; `state.json` holds only runtime bookkeeping:

| Question | How to answer |
|----------|---------------|
| What is in-flight? | `bd list --status=in_progress --type=chore` |
| What is ready? | `bd ready` — filter for chores with `stage:*` labels |
| What stage is a bead in? | Read the `stage:*` label from `bd show <id>` |
| Which agent-ID maps to which bead? | `inflight` entries in `.agent-cortex/ralph/state.json` |
| How many fix rounds? | Count chore beads with label `stage:fix` that are children of the parent task (`bd children <parent-id> --json | grep -c '"stage:fix"'`). Read `maxFixRounds` from `skills/planning/create-task/pipeline.json`. Read-only: used for the cap backstop, never to build remediation. |
| Which features are review-gated? | Find open child task beads labelled `lifecycle:feature-pr` and `implementation-type:hitl` |
| Which epics are review-gated? | `bd list -l awaiting-epic-pr-merge` |
