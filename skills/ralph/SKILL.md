---
name: ralph
description: "Run all pending beads end-to-end by dispatching pipeline stages to isolated subagents with review gates: initialise, process each bead through its pipeline (code → verify → review → document, with fix loops on failure), open review-gated PRs before considering feature work complete. Use when running the full task backlog with human approval points."
---

# Fleet

Orchestration: find ready beads, process each one through its pipeline stages by dispatching to isolated subagents via the `subagent` tool. Stages run sequentially within a bead (code → verify → review → document, with fix loops). Beads are processed one at a time.

Orchestration state is derived entirely from beads — there is no separate state file. In-flight work is tracked as chore beads with status `in_progress`. Ready work is discovered via `bd ready`. Pipeline configuration and prompt templates live in `skills/create-task/`.

## Branching and Review Model

1. **Epic integration branch**: each epic runs on `epic/<epic-id>` (base: `origin/main`, never local `main`).
2. **Feature branch per parent bead**: each AFK parent task runs on `feature/<parent-task-id>`, based from its epic branch. This branch is treated as the **agent branch** for HITL PRs.
3. **Dedicated worktree per parent bead**: each feature branch uses `.agent-cortex/worktrees/<parent-task-id>`.
4. **Feature PR gate**: each feature has a child HITL task bead (`lifecycle:feature-pr`) created by `create-task`. When `document` completes, open/update PR `feature/<parent-task-id> -> epic/<epic-id>` (agent-branch → feature branch), report the PR URL immediately, then wait for the HITL PR gate bead to be closed by a human.
5. **Epic PR gate**: when an epic's feature beads are complete, open/update a PR `epic/<epic-id> -> main` and pause until merged.

See [REFERENCE.md](./REFERENCE.md) for detailed procedures: dispatching a stage, fix loop, and shutdown.

---

## Initialization

Run once at startup:

1. Run `bd prime`. Hold the full output verbatim in memory — forward it unchanged to every `subagent` call.
2. Ensure `.agent-cortex/` and `.agent-cortex/worktrees/` are in the project's `.gitignore` (append any that are missing).
3. Ensure Ralph's workspace directory exists: `mkdir -p .agent-cortex/ralph`.
4. Read `skills/create-task/pipeline.json` and hold it in memory — you need `maxFixRounds` for the fix loop.
5. Run `bd ready` to get the initial list of available beads.
6. For each available bead:
   - **Chore with a `stage:*` label**: pipeline stage bead — already dispatched; skip during init.
   - **Task or other type without an `implementation-type:*` label**: invoke the `classify-bead` skill. AFK tasks may need expansion via `create-task`; HITL tasks are noted for the shutdown summary.
   - **Task labelled `implementation-type:hitl`**: skip — record the bead ID for the **Pending Human Action** summary at shutdown.
7. For each ready AFK task bead (labelled `implementation-type:afk`), begin processing (see _Processing a parent bead_ below).

---

## Processing a parent bead

For each AFK parent task bead, work through its pipeline stages sequentially:

1. **Ensure branch + worktree** exist for this parent task (see _Feature branches and worktrees_ in REFERENCE.md). Change into the worktree directory: `cd .agent-cortex/worktrees/<parent-id>`.
2. **Run each pipeline stage** by calling the `subagent` tool with the `cwd` set to the worktree:

   ```
   subagent({
     stage: "<stage-key>",
     promptPaths: ["skills/run-beads/playbooks/<stage-key>.md"],
     task: "<bead context with bd prime output, parent task description, prior stage outputs>",
     cwd: ".agent-cortex/worktrees/<parent-id>"
   })
   ```

   Stages run in order: `coding` → `test-writing` → `verifying` → `reviewing` → `fixing` (if needed) → `test-reviewing` → `verifying` (re-verify after fix) → `documenting`.
3. **Parse the `---REPORT---` block** from the subagent's output. The report contains `BEAD_ID`, `STAGE_COMPLETED`, `SUMMARY`, `FILES_CHANGED`, `OUTCOME` (SUCCESS or BLOCKED), and `BLOCKING_ISSUES`.
4. **Handle the outcome** per the stage outcome table (see REFERENCE.md).
5. **Open PR** when the `documenting` stage completes successfully (see _Feature PR Gate_ in REFERENCE.md).
6. **Wait for HITL gate**: once the feature PR is opened, wait for the HITL PR gate bead (`lifecycle:feature-pr`) to be closed by a human. Report the PR URL and stop processing new features until the gate clears.
7. **Close the parent bead** once the HITL gate is cleared: `bd close <parent-id>`.
8. Proceed to the next ready AFK parent bead.

---

## Constraints

- **Always** run in **foreground** (interactive) mode. If you find yourself executing as a background task, immediately surface a warning to the user and ask them to re-run you in foreground mode.
- **Never** write, edit, or create source code or documentation yourself.
- **Never** edit bead task files directly — only use `bd` commands.
- **Always** use the `subagent` tool to dispatch pipeline stages — never execute stage work inline.
- **Always** include the full `bd prime` output verbatim in every `subagent` task context.
- **Always** derive orchestration state from beads — do not maintain a separate state file.
- **Max fix rounds** per task as defined by `maxFixRounds` in `skills/create-task/pipeline.json`.
- **Always** execute subagents from the parent feature worktree (`.agent-cortex/worktrees/<parent-id>`), never from repo root.
- **Never** auto-merge PRs. Merges are human-controlled.
- **Only continue past a feature review gate after the feature PR HITL task bead is closed by a human (after merge into the epic branch).**
- **Only continue past an epic review gate after the epic PR is merged into `main`.**
- **When a feature hits the HITL PR gate, push and open the PR immediately and report the URL — do not wait for explicit approval to push or create the PR.**
- **Always** bump the patch version in `plugin.json` as part of any commit that changes agent or skill files.
