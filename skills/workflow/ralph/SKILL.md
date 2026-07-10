---
name: ralph
description: "Run all pending beads end-to-end using parallel subagents with review gates: initialise, dispatch up to 5 concurrent pipeline-stage chores, open and report PRs immediately, then wait for merges before continuing. Use when running the full task backlog with human approval points."
---

# Fleet

Parallel task orchestration: find ready beads, dispatch them as background subagents, process each outcome through the pipeline (code → verify → review → document, with fix loops on failure), then open review-gated PRs before considering feature work complete.

Orchestration state is derived entirely from beads — there is no separate state file. In-flight work is tracked as chore beads with status `in_progress`. Ready work is discovered via `bd ready`. Pipeline configuration lives in `skills/planning/create-task/pipeline.json`. Stage runner prompt templates live in `skills/run-pipeline-stage/prompts/` and playbooks in `skills/run-pipeline-stage/playbooks/`.

## Branching and Review Model

1. **Epic integration branch**: each epic runs on `epic/<epic-id>` (base: `origin/main`, never local `main`).
2. **Feature branch per parent bead**: each AFK parent task runs on `feature/<parent-task-id>`, based from its epic branch. This branch is treated as the **agent branch** for HITL PRs.
3. **Dedicated worktree per parent bead**: each feature branch uses `.agent-cortex/worktrees/<parent-task-id>`.
4. **Feature PR gate**: each feature has a child HITL task bead (`lifecycle:feature-pr`) created by `create-task`. When `document` completes, open/update PR `feature/<parent-task-id> -> epic/<epic-id>` (agent-branch → feature branch), report the PR URL immediately, then wait for the HITL PR gate bead to be closed by a human.
5. **Epic PR gate**: when an epic's feature beads are complete, open/update a PR `epic/<epic-id> -> main` and pause until merged.

See [REFERENCE.md](./REFERENCE.md) for detailed procedures: dispatching, fix loop, log polling, and shutdown.

---

## Initialization

Run once at startup:

1. Run `bd prime`. Hold the full output verbatim in memory — forward it unchanged to every subagent.
2. Ensure `.agent-cortex/` and `.agent-cortex/worktrees/` are in the project's `.gitignore` (append any that are missing).
3. Ensure Ralph's workspace directory exists: `mkdir -p .agent-cortex/ralph`.
4. Read `skills/planning/create-task/pipeline.json` and hold it in memory — you need `maxFixRounds` for the fix loop.
5. Run `bd ready` to get the initial list of available beads.
6. For each available bead:
   - **Chore with a `stage:*` label**: pipeline stage bead — eligible for dispatch.
   - **Task or other type without an `implementation-type:*` label**: invoke the `classify-bead` skill. AFK tasks may need expansion via `create-task`; HITL tasks are noted for the shutdown summary.
   - **Task labelled `implementation-type:hitl`**: skip — record the bead ID for the **Pending Human Action** summary at shutdown.
7. For each ready chore bead (up to 5), **dispatch** it (see _Dispatching a chore bead_ in REFERENCE.md). Chores for a parent bead must run from that parent's worktree.
8. **If** any chore beads were dispatched in step 7, start the **poll timer**: run `sleep 120` as a background bash process and hold its shellId in memory. **Otherwise**, if HITL gate beads are pending (check `bd list -l lifecycle:feature-pr -l implementation-type:hitl` and `bd list -l awaiting-epic-pr-merge`), proceed to **HITL Pause** (see REFERENCE.md) immediately.
9. Regenerate `.agent-cortex/ralph/progress.md`:
   ```bash
   # workspace must be the absolute path you cd'd into — never . or $(pwd)
   workspace="/absolute/path/to/worktree"
   pnpm --prefix ~/.copilot/installed-plugins/_direct/agent-cortex/skills/run-beads/scripts exec tsx generate-progress.ts --workspace "$workspace" > "$workspace/.agent-cortex/ralph/progress.md"
   ```

---

## Event Loop

After initialization, wait for background agents or the poll timer to complete. On each completion notification:

### Poll timer completed

1. **Poll all in-flight bead logs** (see _Log polling_ in REFERENCE.md).
2. Regenerate `.agent-cortex/ralph/progress.md`.
3. **HITL pause check**: if `bd list --status=in_progress --type=chore` returns empty AND `bd ready` has no `stage:*` chore beads AND HITL gate beads are pending (`bd list -l lifecycle:feature-pr -l implementation-type:hitl` or `bd list -l awaiting-epic-pr-merge` returns results), proceed to **HITL Pause** (see REFERENCE.md) — do **not** restart the timer.
4. **Otherwise**: restart the timer: run `sleep 120` as a new background bash process, hold its shellId in memory.

### Background agent completed

1. **Poll that bead's log** to flush any final lines.
2. **Read** the completed agent's full output with `read_agent`.
3. **Identify the bead**: parse the `---REPORT---` block for `BEAD_ID` and `STAGE_COMPLETED`.
4. **Close** the chore bead: `bd close <bead-id>`.
5. **Handle stage outcome**:

   | Stage completed | Condition | Next action |
   |-----------------|-----------|-------------|
   | `code` | — | Closing the code chore unblocks the verify chore. |
   | `fix` | — | Closing the fix chore unblocks the verify chore. |
   | `verify` | `VERIFY_OUTCOME: PASS` | Closing the verify chore unblocks the review chore. |
   | `verify` | `VERIFY_OUTCOME: FAIL` | Run the **fix loop** (see REFERENCE.md). |
   | `review` | `REVIEW_OUTCOME: APPROVED` | Closing the review chore unblocks the document chore. |
   | `review` | `REVIEW_OUTCOME: CHANGES_REQUESTED` | Run the **fix loop** (see REFERENCE.md). |
   | `document` | — | Open/update feature PR immediately (`feature/<parent-id> -> epic/<epic-id>`), report the PR URL, then update the child HITL PR gate bead (`lifecycle:feature-pr`) with the PR URL/status. Wait for human to close that HITL bead after merge, then close the parent task bead. |

6. **Check for newly ready beads**: run `bd ready` and inspect results:
    - **Chore beads with `stage:*` label**: dispatch if in-flight count (from `bd list --status=in_progress --type=chore`) is < 5.
    - **Task beads without `implementation-type:*` label**: invoke `classify-bead`. Note HITL tasks for shutdown; expand AFK tasks via `create-task` if needed.
   - If any feature PR gate bead (`lifecycle:feature-pr`, `implementation-type:hitl`) is open, do **not** schedule new parent features. Keep working only already in-flight chores.
7. **Check shutdown or pause**: if `bd list --status=in_progress --type=chore` returns no results AND `bd ready` returns no chore beads with `stage:*` labels:
   - If HITL gate beads are pending (`bd list -l lifecycle:feature-pr -l implementation-type:hitl` or `bd list -l awaiting-epic-pr-merge` returns results), proceed to **HITL Pause** (see REFERENCE.md).
   - Otherwise, proceed to **Shutdown** (see REFERENCE.md).
8. Regenerate `.agent-cortex/ralph/progress.md`.

---

## Constraints

- **Always** run in **foreground** (interactive) mode. If you find yourself executing as a background task, immediately surface a warning to the user and ask them to re-run you in foreground mode.
- **Never** write, edit, or create source code or documentation yourself.
- **Never** edit bead task files directly — only use `bd` commands.
- **ALWAYS call the `task` tool to spawn subagents** — never use bash, never run stages inline, never use any other tool. This is your only spawning mechanism.
- **Always** derive orchestration state from beads — do not maintain a separate state file.
- **Always** include the full `bd prime` output verbatim in every `task` tool prompt.
- **Always** keep the poll timer running — restart it immediately after it fires — **unless** the HITL pause condition is met (no chores in-flight, no `stage:*` chores ready, HITL gate beads pending), in which case proceed to **HITL Pause** (see REFERENCE.md) and stop instead.
- **Never** post empty poll updates to chat — only surface new log content.
- **Max 5** tasks in-flight at once.
- **Max fix rounds** per task as defined by `maxFixRounds` in `skills/planning/create-task/pipeline.json`.
- **Always** execute chore subagents from the parent feature worktree (`.agent-cortex/worktrees/<parent-id>`), never from repo root.
- **Never** auto-merge PRs. Merges are human-controlled.
- **Only continue past a feature review gate after the feature PR HITL task bead is closed by a human (after merge into the epic branch).**
- **Only continue past an epic review gate after the epic PR is merged into `main`.**
- **When a feature hits the HITL PR gate, push and open the PR immediately and report the URL — do not wait for explicit approval to push or create the PR.**
- **Always** bump the patch version in `plugin.json` as part of any commit that changes agent or skill files.
