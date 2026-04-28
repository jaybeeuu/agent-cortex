---
name: fleet
description: "Run all pending beads end-to-end using parallel subagents: initialise, dispatch up to 5 concurrent pipeline-stage chores, process completions, and loop until the backlog is empty. Use when running the full task backlog, batch execution, working through all pending work, or when ralph invokes parallel orchestration."
---

# Fleet

Parallel task orchestration: find ready beads, dispatch them as background subagents, process each outcome through the pipeline (code → verify → review → document, with fix loops on failure), and repeat until no chore beads remain.

Orchestration state is derived entirely from beads — there is no separate state file. In-flight work is tracked as chore beads with status `in_progress`. Ready work is discovered via `bd ready`. Pipeline configuration and prompt templates live in `skills/create-task/`.

See [REFERENCE.md](./REFERENCE.md) for detailed procedures: dispatching, fix loop, log polling, and shutdown.

---

## Initialization

Run once at startup:

1. Run `bd prime`. Hold the full output verbatim in memory — forward it unchanged to every subagent.
2. Ensure `.ralph-progress.md` and `.ralph-*.log` are in the project's `.gitignore` (append any that are missing).
3. Read `skills/create-task/pipeline.json` and hold it in memory — you need `maxFixRounds` for the fix loop.
4. Run `bd ready` to get the initial list of available beads.
5. For each available bead:
   - **Chore with a `stage:*` label**: pipeline stage bead — eligible for dispatch.
   - **Task or other type without an `implementation-type:*` label**: invoke the `classify-bead` skill. AFK tasks may need expansion via `create-task`; HITL tasks are noted for the shutdown summary.
   - **Task labelled `implementation-type:hitl`**: skip — record the bead ID for the **Pending Human Action** summary at shutdown.
6. For each ready chore bead (up to 5), **dispatch** it (see _Dispatching a chore bead_ in REFERENCE.md).
7. Start the **poll timer**: run `sleep 120` as a background bash process and hold its shellId in memory.
8. Regenerate `.ralph-progress.md`:
   ```bash
   npx tsx skills/run-beads/scripts/generate-progress.ts > .ralph-progress.md
   ```

---

## Event Loop

After initialization, wait for background agents or the poll timer to complete. On each completion notification:

### Poll timer completed

1. **Poll all in-flight bead logs** (see _Log polling_ in REFERENCE.md).
2. **Restart the timer**: run `sleep 120` as a new background bash process, hold its shellId in memory.
3. Regenerate `.ralph-progress.md`.

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
   | `document` | — | Close the **parent task** bead: `bd close <parent-id>`. |

6. **Check for newly ready beads**: run `bd ready` and inspect results:
   - **Chore beads with `stage:*` label**: dispatch if in-flight count (from `bd list --status=in_progress --type=chore`) is < 5.
   - **Task beads without `implementation-type:*` label**: invoke `classify-bead`. Note HITL tasks for shutdown; expand AFK tasks via `create-task` if needed.
7. **Check shutdown condition**: if `bd list --status=in_progress --type=chore` returns no results AND `bd ready` returns no chore beads with `stage:*` labels, proceed to **Shutdown** (see REFERENCE.md).
8. Regenerate `.ralph-progress.md`.

---

## Constraints

- **Never** write, edit, or create source code or documentation yourself.
- **Never** edit bead task files directly — only use `bd` commands.
- **Always** spawn subagents in **background** mode so multiple tasks run concurrently.
- **Always** derive orchestration state from beads — do not maintain a separate state file.
- **Always** include the full `bd prime` output verbatim in every subagent prompt.
- **Always** keep the poll timer running — restart it immediately after it fires.
- **Never** post empty poll updates to chat — only surface new log content.
- **Max 5** tasks in-flight at once.
- **Max fix rounds** per task as defined by `maxFixRounds` in `skills/create-task/pipeline.json`.
- **Always** pause and present all changes to the user for review and explicit approval before committing or pushing anything.
- **Always** bump the patch version in `plugin.json` as part of any commit that changes agent or skill files.
