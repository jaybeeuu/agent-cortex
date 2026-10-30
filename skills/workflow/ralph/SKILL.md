---
name: ralph
description: "Run every ready execution:afk bead end-to-end — decomposing features, expanding tasks into pipeline-stage chores, and driving up to 5 concurrent workers in dedicated worktrees while opening review-gated PRs immediately and pausing for human merges. Use when you want to \"run the backlog\", \"run all beads\", or \"run ralph\" with human approval gates."
---

# Ralph

Ralph is a parallel orchestration loop. It advances `execution:afk` beads through pipeline-stage chores (`code` → `verify` → `review` → `document`), dispatching each unit as a background subagent in its parent's worktree, then opens review-gated feature and epic PRs and pauses for human merges. Ralph never writes code itself — it dispatches, tracks, and reports.

One query decides what ralph works on: **`bd ready -l execution:afk`**. Features, tasks and chores all arrive through it, and each bead's *shape* — not a second `bd` filter — decides which procedure carries it: a childless feature is decomposed, a bead with no stage chores is expanded, a stage chore is dispatched. An `execution:afk` bead is therefore never invisible to ralph for lacking a `stage:*` label, and ralph never invents a narrower "only stage chores" predicate that would hide one.

Each leaf execution bead belongs to the worker that ran it: the worker appends its milestone notes, closes the bead on both outcomes, and builds its own `stage:fix` + fresh-stage remediation chain when it fails. Ralph reads beads and routes — it never closes a leaf bead and never creates a fix bead. Its only retry control is a read-only cap backstop.

State model: task state lives in beads (ready/in_progress via `bd`); the only local file is `.agent-cortex/ralph/state.json`, holding the agent-ID→bead mapping. Pipeline configuration comes from `skills/planning/create-task/pipeline.json`, and stage execution belongs to the `run-pipeline-stage` skill. Stage chores are pre-created from that pipeline when a task is expanded — with `blocks` deps encoding the order — so ralph's dispatch is always "claim what `bd ready -l execution:afk` returns"; it never creates a stage chore.

## When to use

- "Run the backlog", "run all beads", "run ralph", "run everything pending".
- A planning session has produced classified, unblocked `execution:afk` beads and you want autonomous execution with human review gates.
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
4. Initialize state: write `.agent-cortex/ralph/state.json` with `{ "inflight": [] }`.
5. Read `skills/planning/create-task/pipeline.json` and hold it in memory — you need its `maxFixRounds` for the read-only cap backstop.
6. Run **`bd ready -l execution:afk`**. That single query *is* the dispatch predicate — every ready `execution:afk` bead is ralph's work, whether it is a feature, a task or a chore. Classify each result by its shape to decide which procedure carries it:
   - **`feature` bead with no children**: not dispatchable work yet — decompose it (_Feature decomposition_ below) and re-run the query.
   - **Bead carrying a `stage:*` label**: a pipeline stage chore — dispatch it (_Event loop_, and _Dispatching a Chore Bead_ in REFERENCE.md).
   - **`task` or other bead with no `stage:*` chore children**: expand it first (_Expansion guard_ below), then dispatch its ready `stage:code` chore.
   - **Bead that already has its children** (a decomposed feature, an expanded task parent): skip it — it is not dispatchable itself, and its `stage:*` chore is dispatched on its own.
   `execution:hitl` beads are not in this query and are not ralph's to touch: record them for the Pending Human Action summary. That includes every feature still at its default `execution:hitl` label.
7. Dispatch each unit from its parent's worktree, up to 5 in flight: a stage chore via the event loop, a childless feature via a decomposition worker (_Feature decomposition_), a chore-less task via an expansion worker (_Expansion guard_). Create branches and worktrees first (REFERENCE.md, _Feature Branches and Worktrees_).
8. Hand over to your harness's completion-detection mechanism: PI keeps a {{TOOL:wait_for_agents}} call outstanding over every in-flight agent ID, and Claude re-invokes you as each worker completes. If no **agent work** was dispatched — `state.json`'s `inflight` holds no entries, so no stage, decomposition or expansion worker is running — and `skills/workflow/ralph/scripts/pending-gates.mjs` reports a non-empty `pendingHumanAction` (an unblocked `lifecycle:feature-pr` gate, or an epic tagged `awaiting-epic-pr-merge`), go straight to HITL Pause (REFERENCE.md). A decomposition- or expansion-only init is in flight, not idle: keep the completion mechanism running and continue at the event loop.

### 2. Expansion guard (stage chores are pre-created)

A ready `execution:afk` task bead with no `stage:*` chore children has nothing to dispatch, so it is not dispatched as work. Expand it first: dispatch a worker in the feature worktree that runs `create-chores.mjs --parent <id> --priority <parent-priority>` against the existing bead and reports the returned `code`/`verify`/`review`/`document`/`featurePrReview` mapping — the next `bd ready -l execution:afk` pass then picks up `stage:code` (see REFERENCE.md, _Expansion Guard_).

**Never expand an existing bead with `create-task`.** It creates a bead first and expands second, so the original would stay chore-less and gain a **second parent** beside it. `create-chores.mjs` expands; only `create-task` creates parents.

### 3. Feature decomposition

A ready `execution:afk` bead of type `feature` with no children is not dispatchable work — there is nothing to stage and nothing to expand. Decompose it: dispatch a worker in `.agent-cortex/worktrees/<feature-id>` that turns the feature into one `execution:hitl` planning bead plus `execution:afk` implementation children that depend on it, then continue (REFERENCE.md, _Feature Decomposition_).

A feature carries `execution:hitl` by default, so this only runs when a human has deliberately relabelled a feature `execution:afk` to make its delivery agent-routable. Decomposition is then the last thing ralph does with it for a while: the children depend on the planning bead, so once the worker reports, `bd ready -l execution:afk` returns only the feature itself — no dispatchable child — and skipping that row is the *correct* behaviour, not re-expanding. **Never re-dispatch a decomposition**: the bead creation it runs is not idempotent, so a second run duplicates the whole hierarchy.

### 4. Event loop

On each completion notification (a background agent finished):

1. Poll that parent's log for new lines — `tail -n +<nextLine> .agent-cortex/ralph/ralph-<parent-id>.log` (logs are keyed by parent bead ID, so every stage of a feature shares one file) — and post only new key events (stage transitions, test/lint results), never empty updates.
2. Read the completed agent's output with {{TOOL:read_agent}} and parse its `---REPORT---` block for `BEAD_ID`, `STAGE_COMPLETED`, and the outcome. A **decomposition** (`kind: "decompose"`) or **expansion** (`kind: "expand"`) worker has no REPORT and no leaf bead to confirm. An **expansion worker** owns no bead — confirm the parent now has `stage:*` chores (`bd children <parent-id> --json | grep -c '"stage:'`) and skip to step 5 to dispatch its ready `stage:code` chore. A **decomposition worker** — confirm the feature now has children (`bd children <feature-id> --json` returns a non-empty list), record that nothing is dispatchable for it until a human closes the planning bead, and skip to step 5; never re-decompose. If either confirmation comes back empty, the worker failed: surface its output, record the parent for the shutdown summary, and do not re-dispatch.
3. Confirm the stage worker closed its chore bead: `bd show <bead-id>` should read `closed` with the outcome in its close reason. If it is still open the worker died mid-stage — read its notes and re-dispatch; never close it yourself.
4. Route the parent per the dispatch table — nothing is created here: the pre-created chain already encodes the order, and the worker owns any remediation it needs.

   | Stage completed | Condition | Next action |
   |-----------------|-----------|-------------|
   | `code` | — | Closing the code chore unblocks the pre-created verify chore |
   | `fix` | — | Closing the fix chore unblocks the fresh stage chore it was wired to |
   | `verify` | `OUTCOME: SUCCESS` | Closing the verify chore unblocks the review chore |
   | `verify` | `OUTCOME: BLOCKED` | Create nothing — the worker built `stage:fix` + a fresh `stage:verify`; dispatch the ready fix chore |
   | `review` | `OUTCOME: SUCCESS` | Closing the review chore unblocks the document chore |
   | `review` | `OUTCOME: BLOCKED` | Create nothing — the worker built `stage:fix` + a fresh `stage:review`; dispatch the ready fix chore |
   | `document` | `OUTCOME: SUCCESS` | Open/update the feature PR now (`feature/<parent-id>` → its base branch), report the URL, and update the child HITL gate bead (`lifecycle:feature-pr`). Wait for a human to close that bead after merge, then `bd close <parent-id>` |
   | any | parent status `blocked` | Nothing — the worker hit `maxFixRounds`; record the parent for the shutdown summary |

5. Run `bd ready -l execution:afk` and dispatch new ready work while the in-flight count is under 5 — max 5 parent features, counted from `state.json`'s `inflight` (a parent counts while any of its workers — stage, `kind: "decompose"` or `kind: "expand"` — sits in `inflight`; REFERENCE.md, _State Files_). A ready childless feature is decomposed, not staged, and a ready bead with no chore tree is expanded (see _Feature decomposition_ and _Expansion guard_ above). Before each dispatch run the read-only cap backstop (REFERENCE.md, _Cap Backstop_): at `maxFixRounds` block the parent and create nothing. Do not schedule new parent features while `pending-gates.mjs` reports a non-empty `pendingHumanAction` — that is, while a `lifecycle:feature-pr` gate is **unblocked**. Gates still blocked behind their own pipeline (pre-created for a feature that has not reached its PR stage) are parked and never stop dispatch.
6. If nothing is in flight (no stage, decomposition or expansion workers) and nothing is dispatchable (`bd ready -l execution:afk` returns no stage chore, no childless feature to decompose, and no ready, claimable chore-less task awaiting expansion — a queued `execution:afk` bead behind an open `lifecycle:feature-pr` HITL gate cannot be claimed, so it is paused work, not dispatchable work), proceed to HITL Pause (REFERENCE.md) when `pendingHumanAction` is non-empty, otherwise to Shutdown (REFERENCE.md).

### 5. Reporting status (beads are the view)

There is no status document to render. Report status in chat straight from `bd`, and give the human the same copy-paste command when they want the view themselves:

```bash
bd list --parent <parent-id>   # every chore for a feature, with its state
bd ready -l execution:afk      # the next dispatchable work
bd show <id>                   # full detail, including the worker's notes
```

### 6. Branching and review model

- **Single-feature epics** (exactly one feature task child — count with `bd children <epic-id>`, excluding chores): no epic branch. `feature/<parent-id>` is based directly on `origin/main`, its feature PR targets `main`, and no epic PR is opened.
- **Multi-feature epics** (two or more feature task children): the epic runs on `epic/<epic-id>`, based on `origin/main` — never local `main`. Each `execution:afk` parent task runs on `feature/<parent-id>`, based from its epic branch, in the dedicated worktree `.agent-cortex/worktrees/<parent-id>`.
- Feature PR gate: `feature/<parent-id>` → `epic/<epic-id>` (or → `main` for single-feature epics). Epic PR gate: `epic/<epic-id>` → `main`.
- **Never stack branches.** `feature/<parent-id>` is based on `epic/<epic-id>` (or `origin/main`), never on another `feature/*`. A dependency between two tasks lives in the bead graph (`bd dep add <waiting> <blocked-on>`) so the dependent task stays out of `bd ready` until its dependency has merged — stacking the branch defeats that gate by hand and costs a rebase-on-squash later (see `git-workflow` rule 3).
- Branch/worktree setup and the PR commands live in REFERENCE.md (_Feature branches and worktrees_, _Feature PR gate_).

### 7. HITL pause and shutdown

Both paths end in a **gated** `bd dolt push`: on a non-zero exit, retry once, then stop and report the command, exit code and stderr as a sync blocker instead of printing any completion or Pending Human Action summary. A sync that never reached the remote is a failed shutdown, not a finished one.

- **HITL Pause** — when nothing is in flight (no stage, decomposition or expansion workers), nothing is dispatchable (nothing returned by `bd ready -l execution:afk`, including no ready, claimable chore-less task awaiting expansion), and `pending-gates.mjs` reports a non-empty `pendingHumanAction` (an unblocked `lifecycle:feature-pr` gate, or an epic tagged `awaiting-epic-pr-merge`; gates still parked behind their own pipeline do not count): open/update epic PRs to `main` for multi-feature epics and tag each epic `awaiting-epic-pr-merge` (single-feature epics need none — their feature PRs already target `main`), run the gated `bd dolt push`, output the Pending Human Action table, then stop completely until re-prompted.
- **Shutdown** — when all work is complete: open/update epic PRs to `main` for multi-feature epics and tag them (single-feature epics need none), run the gated `bd dolt push`, then output the Pending Human Action / Needs Refinement / cap-blocked / Pending Epic Review summaries that apply, or "All beads complete."

## Red Flags

- Running as a background or delegated subagent instead of the interactive foreground agent.
- Spawning a stage runner via {{TOOL:bash}} or running a stage inline instead of {{TOOL:task}}.
- Closing a leaf execution bead, or creating a `stage:fix`/feedback bead — both belong to the worker.
- Creating a stage chore, or running `create-task` for an existing bead — the chain is pre-created and `create-task` would add a second parent.
- Re-dispatching a decomposition because "the feature still looks idle" — the children are blocked on the planning bead, which is Q5b working, not a failure. Never re-create the hierarchy.
- Reaching for a narrower dispatch query (`bd ready -t chore`, "chores with `stage:*`") — an `execution:afk` bead with no stage chores is work waiting for expansion, not work that does not exist.
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
| "This bead has no chores — I'll create them as I go" | The whole chain is pre-created with `blocks` deps; hand-creating stages duplicates chores and loses the order. Expand with `create-chores.mjs` instead. |
| "That feature came back ready again, so I'll decompose it a second time" | The implementation children depend on the planning bead, so nothing is ready until a human closes it. Re-decomposing duplicates the hierarchy; idling *is* the correct outcome. |

## Philosophy / rationale

- Orchestration state derives from beads so a crash loses nothing but an in-memory ID mapping: `state.json` holds only the agent-ID→bead mapping, never task state.
- Every control-flow predicate — is anything in flight, is there work, is there room, may we pause or shut down — derives from `state.json`'s `inflight` (`kind: "stage"`, `kind: "decompose"` or `kind: "expand"`) plus `bd ready -l execution:afk`, never from a chore-type `bd` query: an expansion or decomposition worker owns no stage chore, so a chore-only predicate reports idle while an agent is running (REFERENCE.md, _The in-flight invariant_).
- One predicate answers both *who runs this* and *when*: `execution:afk` says it is agent work and the bead graph says it is ready, so ralph needs no label that encodes "not really work yet" — a childless feature is routed by its type, not excluded by a filter. Classification happens up-front at planning time (`create-task`), so the loop can trust the query instead of re-interpreting each bead's intent.
- Human review gates are non-negotiable because agent-authored changes still need a person to merge them.
- One owner per lifecycle: the actor that did the work records the outcome, so beads never carry an outcome written by someone who was not there.

## Phase-gate checklists

- [ ] Init complete: `bd prime` held, gitignore entries present, workspace and state.json created, pipeline.json read, first `bd ready -l execution:afk` classified, first agent work dispatched (a stage chore, a decomposition worker or an expansion worker).
- [ ] Event loop handed off: completion-detection mechanism running (or HITL Pause/Shutdown started) — a decomposition- or expansion-only init is in flight, not idle.

## See Also

- [run-pipeline-stage](../run-pipeline-stage/SKILL.md) — owns the stage-runner prompt, per-stage playbooks, the `---REPORT---` format, and the worker's remediation chain. Read it before dispatching any stage.
- [create-task](../../planning/create-task/SKILL.md) — owns `pipeline.json` and the HITL gate beads; its `scripts/pending-gates.mjs` is the only home of the gate queries.
- [prd-to-tasks](../../planning/prd-to-tasks/SKILL.md) — load when the decomposition worker expands a feature into slices.

Do not invoke `classify-bead` from this loop — classification was applied at planning time.

## Verification checklist

- [ ] Init ran once with observable results: `state.json` exists, `bd ready -l execution:afk` was parsed, and agent work is in flight — a stage chore claimed, or a decomposition or expansion worker dispatched for a bead that needed one.
- [ ] Every stage runner was spawned with {{TOOL:task}} from the parent's feature worktree, with the `---REPORT---` instruction in its prompt.
- [ ] Every dispatch came from `bd ready -l execution:afk` — no narrower chore-only filter was used to decide that a bead was not work.
- [ ] A childless `execution:afk` feature was decomposed exactly once into a planning bead plus `execution:afk` children depending on it, and was not re-decomposed on later idle passes.
- [ ] In-flight count never exceeded 5, and the read-only cap backstop ran before every `stage:*` dispatch.
- [ ] Every in-flight, dispatchable-work, HITL-pause, and shutdown predicate was read from `state.json`'s `inflight` (stage, decomposition **and** expansion workers) plus `bd ready -l execution:afk`, with the ready, claimable scope of a chore-less `execution:afk` task bead — never from a chore-only `bd` query, and never counting a bead an open `lifecycle:feature-pr` gate blocks from being claimed.
- [ ] Ralph closed no leaf execution bead and created no fix bead; every closed chore carries its worker's close reason.
- [ ] Any chore-less `execution:afk` task bead was expanded with `create-chores.mjs` (one parent bead), never with `create-task`.
- [ ] Feature and epic PRs were pushed and reported immediately at their gates, and nothing was auto-merged.
- [ ] Every `bd dolt push` before HITL Pause/Shutdown exited 0 — a non-zero exit was retried once, then surfaced as a blocker (command, exit code, stderr) with no completion or Pending Human Action summary printed; status was reported from `bd` commands rather than a generated file, and the chat received no empty poll updates.