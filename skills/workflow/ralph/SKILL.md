---
name: ralph
description: "Run all pending beads end-to-end with up to 5 concurrent pipeline-stage chores in dedicated worktrees, opening review-gated PRs immediately and pausing for human merges. Use when you want to \"run the backlog\", \"run all beads\", or \"run ralph\" with human approval gates."
---

# Ralph

Ralph is a parallel orchestration loop. It advances AFK task beads through pipeline-stage chores (`code` → `verify` → `review` → `document`), dispatching each stage as a background subagent in the feature's worktree, then opens review-gated feature and epic PRs and pauses for human merges. Ralph never writes code itself — it dispatches, tracks, and reports.

Each leaf execution bead belongs to the worker that ran it: the worker appends its milestone notes, closes the bead on both outcomes, and builds its own `stage:fix` + fresh-stage remediation chain when it fails. Ralph reads beads and routes — it never closes a leaf bead and never creates a fix bead. Its only retry control is a read-only cap backstop.

State model: task state lives in beads (ready/in_progress via `bd`); the only local file is `.agent-cortex/ralph/state.json`, holding the poll-timer shellId and the agent-ID→bead mapping. Pipeline configuration comes from `skills/planning/create-task/pipeline.json`, and stage execution belongs to the `run-pipeline-stage` skill.

## When to use

- "Run the backlog", "run all beads", "run ralph", "run everything pending".
- A planning session has produced classified, unblocked AFK task beads and you want autonomous execution with human review gates.
- You want the full pipeline (implement → verify → review → document) orchestrated concurrently, with fix loops on failure.

## When NOT to use

- Working a single bead or stage inline — use the `run-pipeline-stage` skill instead.
- Interactive planning, PRDs, or scoping — use the `plan` skill instead.
- Running as a background or delegated subagent — ralph must be the interactive foreground agent, or it cannot receive completion notifications.

## Workflow

### 1. Initialize (run once at startup)

1. Run `bd prime` and hold the output verbatim in memory.
2. Ensure `.agent-cortex/` and `.agent-cortex/worktrees/` are in the project's `.gitignore` (append any that are missing).
3. Create the workspace: `mkdir -p .agent-cortex/ralph`.
4. Initialize state: write `.agent-cortex/ralph/state.json` with `{ "timerShellId": null, "inflight": [] }`.
5. Read `skills/planning/create-task/pipeline.json` and hold it in memory — you need its `maxFixRounds` for the read-only cap backstop.
6. Run `bd ready` and classify each available bead:
   - **Chore with a `stage:*` label**: pipeline stage bead — eligible for dispatch.
   - **Task or other type without an `implementation-type:*` label**: unexpected here — classification happens at planning time via `create-task`. Do not invoke `classify-bead`; treat as needs-refinement and note it for the shutdown summary.
   - **Task labelled `implementation-type:hitl`**: skip — record the ID for the Pending Human Action summary at shutdown.
7. For each ready chore bead (up to 5), dispatch it from its parent's feature worktree (see _Dispatching a chore bead_ in REFERENCE.md — create branches/worktrees first).
8. Hand over to your harness's completion-detection mechanism: Copilot keeps a `sleep 120` poll timer running in the background; PI keeps a {{TOOL:wait_for_agents}} call outstanding over every in-flight agent ID. If no chore was dispatched and HITL gate beads are pending (`bd list -l lifecycle:feature-pr -l implementation-type:hitl` or `bd list -l awaiting-epic-pr-merge`), go straight to HITL Pause (REFERENCE.md).
9. Regenerate `.agent-cortex/ralph/progress.md`:
   ```bash
   # workspace must be the absolute path you cd'd into — never . or $(pwd)
   workspace="/absolute/path/to/worktree"
   pnpm --prefix skills/workflow/run-pipeline-stage/scripts exec tsx generate-progress.ts --workspace "$workspace" > "$workspace/.agent-cortex/ralph/progress.md"
   ```

### 2. Event loop

On each completion notification (background agent finished, or the poll timer fired):

1. Poll that parent's log for new lines — `tail -n +<nextLine> .agent-cortex/ralph/ralph-<parent-id>.log` (logs are keyed by parent bead ID, so every stage of a feature shares one file) — and post only new key events (stage transitions, test/lint results), never empty updates.
2. Read the completed agent's output with {{TOOL:read_agent}} and parse its `---REPORT---` block for `BEAD_ID`, `STAGE_COMPLETED`, and the outcome.
3. Confirm the worker closed its chore bead: `bd show <bead-id>` should read `closed` with the outcome in its close reason. If it is still open the worker died mid-stage — read its notes and re-dispatch; never close it yourself.
4. Route the parent per the dispatch table — the worker already created everything the stage needed:

   | Stage completed | Condition | Next action |
   |-----------------|-----------|-------------|
   | `code` | — | Closing the code chore unblocks the verify chore |
   | `fix` | — | Closing the fix chore unblocks the fresh stage chore it was wired to |
   | `verify` | `OUTCOME: SUCCESS` | Closing the verify chore unblocks the review chore |
   | `verify` | `OUTCOME: BLOCKED` | Create nothing — the worker built `stage:fix` + a fresh `stage:verify`; dispatch the ready fix chore |
   | `review` | `OUTCOME: SUCCESS` | Closing the review chore unblocks the document chore |
   | `review` | `OUTCOME: BLOCKED` | Create nothing — the worker built `stage:fix` + a fresh `stage:review`; dispatch the ready fix chore |
   | `document` | `OUTCOME: SUCCESS` | Open/update the feature PR now (`feature/<parent-id>` → its base branch), report the URL, and update the child HITL gate bead (`lifecycle:feature-pr`). Wait for a human to close that bead after merge, then `bd close <parent-id>` |
   | any | parent status `blocked` | Nothing — the worker hit `maxFixRounds`; record the parent for the shutdown summary |

5. Run `bd ready` and dispatch new ready `stage:*` chore beads while the in-flight count (`bd list --status=in_progress --type=chore`) is under 5. Before each dispatch run the read-only cap backstop (REFERENCE.md, _Cap Backstop_): at `maxFixRounds` block the parent and create nothing. Do not schedule new parent features while any `lifecycle:feature-pr` HITL gate bead is open.
6. If no chores are in-flight and `bd ready` returns no `stage:*` chores, proceed to HITL Pause (REFERENCE.md) when HITL gate beads are pending, otherwise to Shutdown (REFERENCE.md).
7. Regenerate `.agent-cortex/ralph/progress.md`.

### 3. Branching and review model

- **Single-feature epics** (exactly one feature task child — count with `bd children <epic-id>`, excluding chores): no epic branch. `feature/<parent-id>` is based directly on `origin/main`, its feature PR targets `main`, and no epic PR is opened.
- **Multi-feature epics** (two or more feature task children): the epic runs on `epic/<epic-id>`, based on `origin/main` — never local `main`. Each AFK parent task runs on `feature/<parent-id>`, based from its epic branch, in the dedicated worktree `.agent-cortex/worktrees/<parent-id>`.
- Feature PR gate: `feature/<parent-id>` → `epic/<epic-id>` (or → `main` for single-feature epics). Epic PR gate: `epic/<epic-id>` → `main`.
- Branch/worktree setup and the PR commands live in REFERENCE.md (_Feature branches and worktrees_, _Feature PR gate_).

### 4. HITL pause and shutdown

- **HITL Pause** — when no chores are in-flight, none ready, and HITL gate beads are pending: regenerate `progress.md`, open/update epic PRs to `main` for multi-feature epics and tag each epic `awaiting-epic-pr-merge` (single-feature epics need none — their feature PRs already target `main`), run `bd dolt push`, output the Pending Human Action table, then stop completely until re-prompted.
- **Shutdown** — when all work is complete: regenerate `progress.md`, open/update epic PRs to `main` for multi-feature epics and tag them (single-feature epics need none), run `bd dolt push`, then output the Pending Human Action / Needs Refinement / cap-blocked / Pending Epic Review summaries that apply, or "All beads complete."

## Red Flags

- Running as a background or delegated subagent instead of the interactive foreground agent.
- Spawning a stage runner via {{TOOL:bash}} or running a stage inline instead of {{TOOL:task}}.
- Closing a leaf execution bead, or creating a `stage:fix`/feedback bead — both belong to the worker.
- Loop counting from a stage runner's prose when the same fact is queryable from beads.
- Editing bead files directly instead of using `bd` commands.
- Auto-merging a PR, or continuing past a feature/epic gate before a human merge.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll just run this one stage inline" | An orchestrator that executes stages stops being an orchestrator — the review gates exist to catch exactly that shortcut. |
| "One more task in flight won't hurt" | The 5-task cap bounds log polling, state bookkeeping, and PR sequencing; exceeding it loses track of in-flight work. |
| "The review passed, so I can merge" | Feature and epic PR merges are human-controlled; the gate exists so a person sees every change. |
| "The worker left the chore open — I'll close it" | The worker owns that bead; an open one means it died mid-stage, so read its notes and re-dispatch instead of closing over the missing record. |

## Philosophy / rationale

- Orchestration state derives from beads so a crash loses nothing but an in-memory ID mapping: `state.json` holds only the poll-timer shellId and the agent-ID→bead mapping, never task state.
- Classification happens up-front at planning time (`create-task`), so the loop can trust `bd ready` instead of re-interpreting each bead's intent.
- Human review gates are non-negotiable because agent-authored changes still need a person to merge them.
- One owner per lifecycle: the actor that did the work records the outcome, so beads never carry an outcome written by someone who was not there.

## Phase-gate checklists

- [ ] Init complete: `bd prime` held, gitignore entries present, workspace and state.json created, pipeline.json read, first `bd ready` classified, first chores dispatched.
- [ ] Event loop handed off: completion-detection mechanism running (or HITL Pause/Shutdown started) and `progress.md` regenerated.

## Cross-skill references

- The `run-pipeline-stage` skill owns the stage-runner prompt, per-stage playbooks, the `---REPORT---` format, and the worker's remediation-chain contract — read it before dispatching any stage.
- The `create-task` skill owns `pipeline.json` and creates the `lifecycle:feature-pr` HITL gate beads.
- Do not invoke `classify-bead` from this loop — classification was already applied at planning time.

## Verification checklist

- [ ] Init ran once with observable results: `state.json` exists, `bd ready` was parsed, and the first chore beads are claimed.
- [ ] Every stage runner was spawned with {{TOOL:task}} from the parent's feature worktree, with the `---REPORT---` instruction in its prompt.
- [ ] In-flight count never exceeded 5, and the read-only cap backstop ran before every `stage:*` dispatch.
- [ ] Ralph closed no leaf execution bead and created no fix bead; every closed chore carries its worker's close reason.
- [ ] Feature and epic PRs were pushed and reported immediately at their gates, and nothing was auto-merged.
- [ ] `bd dolt push` and a final `progress.md` regeneration ran before HITL Pause/Shutdown, and the chat received no empty poll updates.