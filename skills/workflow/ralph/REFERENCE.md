# Ralph — Reference

Detailed procedures for the ralph orchestration workflow. See [SKILL.md](./SKILL.md) for the top-level event loop; this file holds the per-procedure detail that would overflow the main skill file.

---

## The in-flight invariant

Every ralph control-flow predicate — *is any agent work in flight?*, *is there work?*, *is there
room to dispatch?*, *may we pause?*, *may we shut down?* — is answered from `state.json`'s
`inflight` list (entries carry `kind: "stage"` or `kind: "expand"`) plus `bd ready`. **Never**
from a chore-type `bd` query, and never from "was a chore dispatched?".

| Question | Derive it from | Never from |
|----------|----------------|------------|
| Is any agent work in flight? | `inflight` in `.agent-cortex/ralph/state.json` — stage **and** expansion entries | `bd list -t chore`, `bd ready -t chore`, or any "were chores dispatched?" test |
| Is anything dispatchable? | `bd ready`: a `stage:*` chore **or** a ready, claimable chore-less AFK task bead awaiting expansion | A chore listing alone — a ready, claimable chore-less AFK bead is work waiting, not idle |
| Is there room under the 5-feature cap? | Parent count in `inflight` | A count of chore beads |
| May ralph pause or shut down? | `inflight` empty **and** nothing dispatchable (per the row above) | "No stage worker is running" |

**Dispatchable means ready *and* claimable.** `bd ready` decides ready; the feature-PR gate
decides claimable: while a `lifecycle:feature-pr` HITL gate bead is open, ralph schedules no new
parent features (_Feature PR gate_, step 6), so a queued unexpanded AFK bead in that state is
paused work, not dispatchable work. Scoping the predicate both ways is what makes HITL Pause
reachable in the canonical post-PR state — gate open, unexpanded AFK beads queued, `inflight`
empty, no ready `stage:*` chore — instead of re-arming a PI
wait over an empty agent set forever on an idle poll.

**Why:** an expansion worker claims no chore. A chore-only predicate therefore reports "nothing
in flight" while an agent is running, which makes ralph pause or shut down mid-expansion and
leaves the parent's freshly created `stage:*` chain undispatched. The only legitimate chore-type
control-flow predicate in ralph is the retry counter in _Cap Backstop_ (`stage:fix` children): it
counts remediation history rather than in-flight work, so it may gate a dispatch decision but it
must never answer *is anything in flight?*. Every other chore-type `bd` query used as a
control-flow predicate is a bug. Structural checks that ask nothing more than *what does this bead
already have?* — the _Expansion Guard_'s `grep -c '"stage:'`, the _Cap Backstop_'s `stage:fix`
count — are not predicates and are fine.

---

## Expansion Guard

Stage chores are pre-created, never created on demand. `create-chores.mjs` (in `skills/planning/create-task/`) reads `pipeline.json` and creates the whole chain in one shot — `code` → `verify` → `review` → `document`, plus the `featurePrReview` HITL gate — with `blocks` deps that encode the order, and with the parent's priority and inherited labels. Ralph's dispatch is therefore always "claim what `bd ready` returns".

A ready AFK task bead with **no** `stage:*` chore children has nothing to dispatch. Expand it, then dispatch the resulting `stage:code` chore:

1. **Confirm it is chore-less** — a bead that already has stage chores is never expanded again:
   ```bash
   bd children <parent-id> --json | grep -c '"stage:'
   ```
   Expect `0` printed. `grep -c` exits `1` when it counts zero matches, so add `|| true` when the
   check runs under `set -e` or inside an `&&` chain — the printed count is the answer, not the exit
   status.
2. **Dispatch an expansion worker** in the feature worktree (`.agent-cortex/worktrees/<parent-id>`) whose whole job is to run the pre-creator against the existing bead and report the JSON it printed:
   ```bash
   node <create-task-scripts>/create-chores.mjs \
     --parent <parent-id> --priority <parent-priority>
   ```
   `<create-task-scripts>` is the absolute path to `skills/planning/create-task/scripts/`, resolved from wherever the skill was loaded — never hardcode one harness's install path. `<parent-priority>` is the parent's own priority from `bd show <parent-id>`, so chores match the task they belong to.
3. **Record it in `inflight`** so its completion is attributable to the parent and it stays in the wait set — it has no chore, so `choreId` is `null`:
   ```json
   { "kind": "expand", "choreId": null, "parentId": "<parent-id>", "title": "<parent title>", "agentId": "<agent-id>", "logLine": 1 }
   ```
4. **Report the mapping** the worker returns — `code`, `verify`, `review`, `document`, `featurePrReview` — and close nothing. The worker owns no bead on this run; the expansion is bookkeeping, not a stage.
5. **Dispatch normally.** The next `bd ready` pass picks up the `stage:code` chore, and the pre-created chain carries the rest.
6. **Handle the completion as an expansion completion**, not a stage completion — see below.

**Never expand an existing bead with `create-task`** — or with any other command that creates a bead. `create-task` creates a bead first and expands second, so running it for an existing bead leaves a **second parent** beside the original, which stays chore-less and never gets dispatched. The guard exists so an AFK task bead always ends with exactly one parent: `create-chores.mjs` expands a bead that already exists; only `create-task` creates parents.

### Expansion Completion Contract

An expansion worker is dispatched like a stage worker but is **not** one. Nothing downstream of a stage dispatch applies to it:

| Stage worker | Expansion worker |
|------|------|
| Correlates to a claimed chore: `kind: "stage"` with a `choreId` | Holds no chore: `kind: "expand"`, `choreId: null` |
| Emits a `---REPORT---` block | Emits none — it prints the `create-chores.mjs` JSON mapping |
| Owns its leaf bead, which must read `closed` | Owns nothing — no bead to close, nothing to confirm |
| Completion advances the parent along the chain | Completion means "chores now exist" — dispatch the ready `stage:code` chore |

On completion, remove the entry from `inflight` and confirm the chore tree exists rather than taking the worker's word for it:

```bash
bd children <parent-id> --json | grep -c '"stage:'
```

Expect a non-zero count — one match per `stage:*` label in the chain. A printed `0` means the
expansion failed. Surface the worker's output in chat and record the parent for the shutdown summary — **never re-dispatch the expansion**, because `create-chores.mjs` is not idempotent and a second run duplicates the chain beside the first. Then continue at the normal dispatch pass: either way nothing is created and nothing is closed by ralph.

---

## Dispatching a Chore Bead

Chores already exist, so dispatch never creates one:

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

   If this session has no subagent tool, **stop and say so**. Do not substitute a backgrounded CLI run (`pi -p … &`): that launch has no completion signal, so a finished worker and a killed one look identical, which is how stages came to be reported complete over uncommitted trees. Record the bead for the shutdown summary and tell the human the session needs restarting with the subagent extension loaded.
8. **Record the base commit** before the worker starts — you verify delivery against it (_Verified Completion_ below):
   ```bash
   git -C .agent-cortex/worktrees/<parent-id> rev-parse HEAD
   ```
9. **Map** the agent ID to the bead ID in memory for lookup on completion.

### Verified Completion

A worker's `---REPORT---` is a claim about the worktree, not evidence of it. Verify the delivery before advancing the parent:

```bash
node scripts/lib/verify-worker-tree.mjs --worktree .agent-cortex/worktrees/<parent-id> --base <base>
```

Exit code 0 means a clean tree with at least one commit ahead of the recorded base. A non-zero exit reports `worktree is dirty` or `no commit ahead of base`, and the stage did **not** deliver whatever its `OUTCOME` line says. Re-dispatch the same chore, or record the failure for the fix chain — never advance the parent, close the chore, or open a feature PR over uncommitted work.

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
   **`<base>` is `epic/<epic-id>` or `origin/main` — never another `feature/*` branch.** If this
   task depends on another unmerged task, its `blocks` edge already keeps it out of `bd ready`;
   do not create the worktree early to get ahead, and never reuse a sibling task's worktree — that
   silently stacks the branches and turns the dependency into a squash-merge conflict later.
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

Run whenever completion handling is triggered (an agent completion):

1. **Read in-flight entries**: `inflight` in `.agent-cortex/ralph/state.json` — every dispatched worker, stage (`kind: "stage"`) or expansion (`kind: "expand"`). Each entry carries `parentId` and `logLine`.
2. For each in-flight entry, read new lines from its **parent's** log file — logs are keyed by **parent** bead ID, so all stages of a feature share one file:
   ```bash
   tail -n +<logLine> .agent-cortex/ralph/ralph-<parentId>.log 2>/dev/null
   ```
3. For each entry that has new lines:
   - **Post a chat summary** of new key events (stage transitions and notable events — not every line verbatim):
     ```
     📋 [parent-id] <title>
        coding → verifying  (or whatever transition)
        Tests: 12 passed, 0 failed
     ```
   - Update `logLine` in `state.json` for that entry.
4. If no entry had new lines, post nothing — do not spam the chat with empty polls.

---

## HITL Pause

Proceed here when no agent work is in flight (no stage workers and no expansion workers in `inflight`), nothing is dispatchable (no `stage:*` chore beads ready, no ready, claimable chore-less AFK task bead awaiting expansion), and HITL gate beads are pending (open `lifecycle:feature-pr` beads or epics tagged `awaiting-epic-pr-merge`). Ralph stops rather than burning requests on idle polls.

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
5. **Stop completely.** Stop the wake mechanism as the wake section describes. Do not continue the event loop. Wait for the user to re-prompt before doing any further work.

---

## Shutdown

When nothing is in flight AND nothing is dispatchable — `inflight` holds no entries, `bd ready` returns no chore beads with `stage:*` labels, and no ready, claimable chore-less AFK task bead is awaiting expansion (_The in-flight invariant_ above):

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
| `.agent-cortex/ralph/state.json` | Runtime bookkeeping only: the in-flight agent-ID→bead mapping. Shape: `{ "inflight": [ { "kind": "stage", "choreId": "...", "parentId": "...", "title": "...", "agentId": "...", "logLine": 1 } ] }`. An expansion worker is recorded with `"kind": "expand"` and `"choreId": null` — it holds no chore but still occupies the wait set and the in-flight check. Initialise at startup with `{ "inflight": [] }`. Update after every dispatch and every agent completion. **Never hand-edit.** |
| `.agent-cortex/ralph/ralph-*.log` | Per-parent log files written by subagents — every stage chore of a feature appends to `.agent-cortex/ralph/ralph-<parent-id>.log` (e.g. `ralph-abc-123.log`). |

All task state is derived from beads; `state.json` holds only runtime bookkeeping:

| Question | How to answer |
|----------|---------------|
| What is in-flight? | The `inflight` entries in `.agent-cortex/ralph/state.json` — `kind: "stage"` for a dispatched stage chore, `kind: "expand"` for an expansion worker. Expansion workers hold no chore, so beads alone under-report in-flight work. |
| What is ready? | `bd ready` — filter for chores with `stage:*` labels. An AFK task bead with no `stage:*` children needs expansion first (_Expansion Guard_). |
| What stage is a bead in? | Read the `stage:*` label from `bd show <id>` |
| Which agent-ID maps to which bead? | `inflight` entries in `.agent-cortex/ralph/state.json` |
| How many fix rounds? | Count chore beads with label `stage:fix` that are children of the parent task (`bd children <parent-id> --json | grep -c '"stage:fix"'`). Read `maxFixRounds` from `skills/planning/create-task/pipeline.json`. Read-only: used for the cap backstop, never to build remediation. |
| Which features are review-gated? | Find open child task beads labelled `lifecycle:feature-pr` and `implementation-type:hitl` |
| Which epics are review-gated? | `bd list -l awaiting-epic-pr-merge` |
