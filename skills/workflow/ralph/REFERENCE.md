# Ralph — Reference

Detailed procedures for the ralph orchestration workflow. See [SKILL.md](./SKILL.md) for the top-level event loop; this file holds the per-procedure detail that would overflow the main skill file.

---

## The in-flight invariant

Every ralph control-flow predicate — *is any agent work in flight?*, *is there work?*, *is there
room to dispatch?*, *may we pause?*, *may we shut down?* — is answered from `state.json`'s
`inflight` list (entries carry `kind: "stage"`, `kind: "decompose"` or `kind: "expand"`) plus
`bd ready -l execution:afk`. **Never** from a chore-type `bd` query, and never from "was a chore
dispatched?".

| Question | Derive it from | Never from |
|----------|----------------|------------|
| Is any agent work in flight? | `inflight` in `.agent-cortex/ralph/state.json` — stage, decomposition **and** expansion entries | `bd list -t chore`, `bd ready -t chore`, or any "were chores dispatched?" test |
| Is anything dispatchable? | `bd ready -l execution:afk`: a `stage:*` chore, a childless `execution:afk` `feature` bead to decompose, **or** a ready, claimable chore-less `execution:afk` task bead awaiting expansion | A chore listing alone — a ready, claimable childless feature or chore-less task is work waiting, not idle |
| Is there room under the 5-feature cap? | Parent count in `inflight` | A count of chore beads |
| May ralph pause or shut down? | `inflight` empty **and** nothing dispatchable (per the row above) | "No stage worker is running" |

**`execution:afk` is the one dispatch predicate.** It answers *whose work is this* for features,
tasks and chores alike, and the bead graph answers *when*. Ralph therefore never narrows the query
— "chores with `stage:*`" would report a ready childless feature or an unexpanded task as idle
while both are work waiting for a worker.

**Dispatchable means ready *and* claimable.** `bd ready -l execution:afk` decides ready; pending human action
decides claimable: while `pending-gates.mjs` reports an unblocked `lifecycle:feature-pr` gate, ralph
schedules no new parent features (_Feature PR gate_, step 6), so a queued unexpanded `execution:afk` bead in
that state is paused work, not dispatchable work. Scoping the predicate both ways is what makes HITL Pause
reachable in the canonical post-PR state — gate open, unexpanded `execution:afk` beads queued, `inflight`
empty, no ready `stage:*` chore — instead of re-arming a PI
wait over an empty agent set forever on an idle poll.

**Why:** an expansion or decomposition worker claims no chore. A chore-only predicate therefore
reports "nothing in flight" while an agent is running, which makes ralph pause or shut down
mid-expansion and leaves the parent's freshly created `stage:*` chain undispatched. The only
legitimate chore-type control-flow predicate in ralph is the retry counter in _Cap Backstop_
(`stage:fix` children): it counts remediation history rather than in-flight work, so it may gate a
dispatch decision but it must never answer *is anything in flight?*. Every other chore-type `bd`
query used as a control-flow predicate is a bug. Structural checks that ask nothing more than
*what does this bead already have?* — the _Expansion Guard_'s `grep -c '"stage:'`, the _Cap
Backstop_'s `stage:fix` count, the _Feature Decomposition_'s child count — are not predicates and
are fine.

---

## Expansion Guard

Stage chores are pre-created, never created on demand. `create-chores.mjs` (in `skills/planning/create-task/`) reads `pipeline.json` and creates the whole chain in one shot — `code` → `verify` → `review` → `document`, plus the `featurePrReview` HITL gate, plus the `post-merge` and `housekeeping` chores blocked behind that gate — with `blocks` deps that encode the order, and with the parent's priority and inherited labels. It is idempotent: a re-run adopts the chores that already exist under the parent, creates only the missing ones, and skips deps that are already wired. Ralph's dispatch is therefore always "claim what `bd ready -l execution:afk` returns".

A ready `execution:afk` task bead with **no** `stage:*` chore children has nothing to dispatch. Expand it, then dispatch the resulting `stage:code` chore:

1. **Confirm it is chore-less** — a bead that already has stage chores is never expanded again:
   ```bash
   bd children <parent-id> --json | grep -c '"stage:'
   ```
   Expect `0` printed. `grep -c` exits `1` when it counts zero matches, so add `|| true` when the
   check runs under `set -e` or inside an `&&` chain — the printed count is the answer, not the exit
   status. A bead with a full chain — one `stage:*` chore per stage in `pipeline.json` (five for the
   shipped pipeline) plus the `lifecycle:feature-pr` gate — never needs an expansion. The check
   answers "no chores at all", so a **partial** chain (a lower count from a failed run) passes it
   and its missing stages never arrive. Nothing detects that automatically: re-run step 2's command
   against that parent by hand, which is idempotent.
2. **Dispatch an expansion worker** in the feature worktree (`.agent-cortex/worktrees/<parent-id>`) whose whole job is to run the pre-creator against the existing bead and report the JSON it printed:
   ```bash
   node <create-task-scripts>/create-chores.mjs \
     --parent <parent-id> --priority <parent-priority>
   ```
   `<create-task-scripts>` is the absolute path to `skills/planning/create-task/scripts/`, resolved from wherever the skill was loaded — never hardcode one harness's install path. `<parent-priority>` is the parent's own priority from `bd show <parent-id>`, so chores match the task they belong to.
3. **Record it in `inflight`** so its completion is attributable to the parent and it stays in the wait set — it has no chore, so `choreId` is `null`:
   ```json
   { "kind": "expand", "choreId": null, "parentId": "<parent-id>", "title": "<parent title>", "agentId": "<agent-id>" }
   ```
4. **Report the mapping** the worker returns — `code`, `verify`, `review`, `document`, `post-merge`, `housekeeping`, `featurePrReview` — and close nothing. The worker owns no bead on this run; the expansion is bookkeeping, not a stage.
5. **Dispatch normally.** The next `bd ready -l execution:afk` pass picks up the `stage:code` chore, and the pre-created chain carries the rest.
6. **Handle the completion as an expansion completion**, not a stage completion — see below.

**Never expand an existing bead with `create-task`** — or with any other command that creates a bead. `create-task` creates a bead first and expands second, so running it for an existing bead leaves a **second parent** beside the original, which stays chore-less and never gets dispatched. The guard exists so an `execution:afk` task bead always ends with exactly one parent: `create-chores.mjs` expands a bead that already exists; only `create-task` creates parents.

**Labels on the chain.** Stage chores inherit `execution:afk` from their parent task bead, so they surface in ralph's `bd ready -l execution:afk` query without extra tagging — an expanded task never needs its chores relabelled. The `featurePrReview` HITL gate is the one exception: it declares its own `execution:hitl` + `lifecycle:feature-pr` labels and the script passes `--no-inherit-labels` for it, so it never picks up the parent's `execution:afk`.

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

Expect one match per `stage:*` label in the chain — six for the shipped `pipeline.json`; the
`featurePrReview` gate carries `lifecycle:feature-pr` instead, so it is not counted. A lower count
means the expansion did not finish: `0` created nothing, and a partial chain leaves stages that
will never become ready. Either way, surface the worker's output in chat, record the parent for the
shutdown summary, and re-dispatch the expansion: `create-chores.mjs` is idempotent, so the second run adopts the chores that already exist, creates only the missing ones, and prints the full mapping — re-running is the recovery path. Then continue at the normal dispatch pass: either way nothing is created and nothing is closed by ralph.

---

## Feature Decomposition

Epic Q2 makes ralph responsible for decomposing a feature bead into the hierarchy; Q5 makes a
feature `execution:hitl` by default. Both hold because the **label**, not the bead type, decides
routing: a feature is invisible to ralph while it carries `execution:hitl`, and a human exposes it
to ralph by relabelling it `execution:afk` when its delivery is genuinely agent-routable. Ralph
then decomposes it once and immediately goes idle behind the planning bead — Q5b's dependency gate
does the pausing, so no extra "ready to decompose" label is needed.

A ready `execution:afk` bead of type `feature` with **no** children is not dispatchable work.
Decompose it:

1. **Confirm it is childless** — any existing child means the feature is already decomposed and this
   procedure does not apply:
   ```bash
   bd children <feature-id> --json
   ```
   Expect an empty list `[]`. A non-empty list, however few children, means stop here.
2. **Dispatch a decomposition worker** in the feature worktree (`.agent-cortex/worktrees/<feature-id>`) whose whole job is to run the `create-task` hierarchy flow (`prd-to-tasks` → `create-task`) for that one **existing** feature — its planning bead and impl children only, never a second feature bead — and report the IDs it created. The worker builds the Q5 shape:
   - a **planning bead** — `--parent <feature-id>`, `execution:hitl` — held for a human to confirm planning is sufficient;
   - **implementation task children** — `--parent <feature-id>`, `execution:afk`, `--no-inherit-labels` — each wired to wait on the planning bead with `bd dep add <impl-child> <planning-bead>`.

   This is the shape `create-task` builds on its feature path (`SKILL.md` steps 5–6): an `execution:hitl` planning bead owned by the feature, whose impl children depend on it, so the dependency — not a label — is the readiness gate.
3. **Record it in `inflight`** so its completion is attributable to the feature and it stays in the wait set — it holds no chore, so `choreId` is `null`:
   ```json
   { "kind": "decompose", "choreId": null, "parentId": "<feature-id>", "title": "<feature title>", "agentId": "<agent-id>" }
   ```
4. **Confirm the children exist** rather than trusting the report — the worker's IDs are a claim, the bead graph is the evidence:
   ```bash
   bd children <feature-id> --json
   ```
   Surface the created IDs in chat. An empty list means the decomposition failed: record the feature for the shutdown summary and continue — do not re-dispatch.
5. **Never re-dispatch a decomposition.** The bead creation it runs is not idempotent, so a second run duplicates the planning bead and every implementation child beside the first. This hazard belongs to `create-task`'s bead creation alone — `create-chores.mjs` is idempotent, so re-running an expansion is its recovery path.
6. **Go idle.** After decomposition nothing is dispatchable for that feature: `bd ready -l execution:afk` still lists the feature itself (it now has children, so it is skipped — never decomposed again) but none of its children until a human closes the planning bead. Returning to the event loop with *nothing* to dispatch is the correct outcome, not a failure to re-expand — that is Q5b working as designed.

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
   - The trail pointer: the worker records its own entries with `<run-pipeline-stage-scripts>/trail-entry.mjs`, so the prompt names that script rather than a log file (see _Reading the Trail_ below)
7. **Call the {{TOOL:task}} tool** with the filled prompt as `prompt` and the worktree path as `cwd`. Store the returned agentId — you need it for step 8 and for correlating the completion to its bead.

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

Exit code 0 means a clean tree with at least one commit ahead of the recorded base. A non-zero exit reports `worktree is dirty` or `no commit ahead of base`, and the stage did **not** deliver whatever its `OUTCOME` line says. Re-dispatch the same chore, or record the failure for the fix chain — never advance the parent, close the chore, or open a feature PR over uncommitted work. `post-merge` and `housekeeping` deliver no commit, so this check does not apply to them.

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

## Post-merge Check

A merge is not verified by merging. The `stage:post-merge` chore reads the CI run that GitHub started for the merge commit on the base branch and reports whether it passed. `create-chores.mjs` pre-creates that chore, labelled `lifecycle:post-merge` and blocked behind the same `lifecycle:feature-pr` gate as `stage:housekeeping`, so it stays out of `bd ready` until a human closes the gate.

```bash
node skills/workflow/ralph/scripts/post-merge-check.mjs
```

The script is deterministic: no model, no tokens, zero dependencies, async only. It prints a JSON report and exits `0` when every run for the commit passed, `1` when a run failed, and `2` when the result is inconclusive.

- **Executor.** A dispatched worker runs it from the **main checkout**, like the housekeeping stage: the commit it reads landed on the base branch, not on the feature branch. It resolves the repository slug and base branch through `gh repo view`, so nothing about this repo's slug or `main` is baked in. `--base <branch>` and `--commit <sha>` override each; the wait window is `--wait <seconds>`, default 300. Any revision either flag supplies is expanded through `git rev-parse` first, because `gh run list --commit` matches the full 40-character SHA only — a caller that reaches `gh` with a short SHA gets an empty run list, which reads as `inconclusive` rather than as an error.
- **Exit `1` files one P1 escalation per open bead.** The bead carries the run URL and the failing job name, is labelled `lifecycle:post-merge-escalation` + `execution:hitl`, and carries a `post-merge-run:<id>` marker in its description. A second run finds the open bead carrying that marker and files nothing. The escalation has no parent, so the feature bead is never reopened and never gains a child.
- **The marker bounds open beads, not runs — a known limitation.** The marker is searched with `bd list`, which omits closed beads. A run id is immutable, so one bead per run forever is the intent, but the code delivers one **open** bead per run: once a human closes the escalation, a later check of the same run files a fresh bead for it. That repeats a page nobody wants; it never drops a signal. Fixing it means searching closed beads too, which is its own change.
- **Nothing is retried.** The stage never re-runs the workflow, never retries the check for a different answer, never reverts the merge, and builds no `stage:fix` chain — a commit that already merged is not repaired by a fix round. The chore stays **open** on exit `1` and `2`.
- **GitHub-only in v1.** A repository `gh` cannot resolve to a GitHub host, or a commit with no run on the base branch, is `inconclusive`: reported, never escalated.
- **A run still in flight is not a verdict.** The wait window belongs to the check; the wait past it belongs to the harness, and the stage playbook's _Watch transport_ section is the single place the per-harness mechanism is named. A session with no watcher runs the check once with a longer window instead — that fallback is prose, so it survives both renders.
- **Ordering against housekeeping.** The two stages are siblings on the gate and neither waits on the other. Chaining `housekeeping` behind `post-merge` was rejected: an inconclusive check that nobody resolves would strand the worktree reclamation housekeeping exists to do. Putting `post-merge` after `housekeeping` was rejected too — it would make the pruner a dependency of a check that reads GitHub state, which no worktree removal can affect.

---

## Pruning Worktrees

A worktree outlives its bead: ralph leaves the directory behind when a feature closes, and a crashed run leaves one with no bead at all. `skills/workflow/ralph/scripts/prune-worktrees.mjs` converges `.agent-cortex/worktrees/*` with bead state.

```bash
node skills/workflow/ralph/scripts/prune-worktrees.mjs                  # remove closed-bead worktrees, report the rest
node skills/workflow/ralph/scripts/prune-worktrees.mjs --remove-orphans # also remove open-bead and missing-bead worktrees
```

**Candidacy comes from bead state, never from git ancestry.** The repo squash-merges, so every landed branch still reports as unmerged. A directory named after a bead that `bd show` reports `closed` is the only proof that admits removal; an open bead, a missing bead, or a bead `bd` could not answer for is kept unless `--remove-orphans` asks otherwise. A bead `bd` could not read is never removed, whatever the flags say.

**A candidate that fails a guard is refused, and the reason is printed.** The guards are: dirty working tree, `locked` worktree, detached HEAD, directory not registered with git, branch with no upstream, and branch with unpushed commits.

**Removal is three commands.** `git worktree remove <path>`, then `git branch -D <branch>`, then `git push origin --delete <branch>`. The remote branch name is the worktree's own checked-out branch, so ralph's `feature/<parent-id>` deletes `origin/feature/<parent-id>`. A remote ref that git already reports as gone is not a failure.

**Exit status is 1 whenever any scanned worktree survived the run.** An open bead counts as survival, so a normal run against a live backlog exits 1. Read the per-worktree report; do not treat the status as a verdict on the worktree you asked about.

**An unregistered stale directory is refused forever.** Earlier git runs may have dropped its registration, so every scan reports it and never removes it. Clean it up by hand: `git worktree prune`, then `rm -rf <path>`.

### Housekeeping chore

Pruning is a pipeline stage, not a habit: `create-chores.mjs` pre-creates a `stage:housekeeping` chore for every expanded task, carrying `lifecycle:housekeeping` and blocked behind that task's `lifecycle:feature-pr` gate. It stays out of `bd ready` until a human closes the gate, so it never competes with pipeline work.

- **Executor.** A dispatched worker — the `stage:housekeeping` chore in `bd ready -l execution:afk` — runs `prune-worktrees.mjs` from the **main checkout**, never from the feature worktree: the worktree it removes can be the parent's own. Ralph dispatches it with the main checkout as cwd for that reason.
- **Retry once.** Exit status `1` means some scanned worktree survived, and an open bead counts as survival, so a live backlog always exits non-zero. The worker therefore retries the run once. The retry is the whole allowance — never a third run.
- **Never close over a worktree the script did not remove.** The outcome comes from the per-worktree report, not the exit status: the chore succeeds when no `closed-bead` worktree is left `refused`. A closed-bead worktree still `refused` after the retry fails the chore, and the chore is left **open** with the printed reasons in its notes. A `kept` or `refused` entry for an open bead is a normal report, not a failure.

Ralph creates nothing for this stage and closes nothing: the worker owns the chore, as it owns every leaf bead.

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
4. Find the child HITL task bead for this parent with label `lifecycle:feature-pr` and `execution:hitl` (created by `create-task`).
5. Update that HITL bead with the PR URL/status (comment or note) so the reviewer has the link.
6. Do not schedule new parent features while this gate is **unblocked** — an unblocked gate is a feature genuinely awaiting a human merge (see _Gate predicate_ below).
7. Once the PR is merged, a human closes the HITL PR gate bead, which unblocks the scheduling brake **and** the pre-created `stage:post-merge` and `stage:housekeeping` chores. After that, close the parent feature bead:
   ```bash
   bd close <parent-id>
   ```
   The housekeeping run that follows removes the parent's worktree, because its bead now reads `closed`. Only then continue with next parent features.

### Gate predicate — parked vs pending

Ralph's only scheduling brake is a gate that is **unblocked**. `create-chores` pre-creates a `lifecycle:feature-pr` gate for *every* planned feature, blocked behind that feature's own `document` chore; such a gate is **parked** — the feature has not reached its PR stage — and must never stop dispatch. Only when the `document` chore closes does the gate unblock, and that is the state in which a human must merge. The feature's `stage:housekeeping` chore waits on the gate bead itself, so it becomes ready only after that human closes it.

Resolve the question with one command instead of ad-hoc `bd` queries:

```bash
node skills/workflow/ralph/scripts/pending-gates.mjs
```

| Field | Meaning | Effect on ralph |
| --- | --- | --- |
| `pendingHumanAction` | Unblocked `lifecycle:feature-pr` gates (all blockers closed) plus epics tagged `awaiting-epic-pr-merge`, each as `{ id, title, kind }` | Non-empty → do **not** schedule new parent features; the same list is the **Pending Human Action** table |
| `parked` | Open gates still blocked behind their own pipeline | Informational only — never stops dispatch, never appears in the table |

Gate queries match the HITL axis on either `execution:hitl` (current) or `implementation-type:hitl` (legacy), so gates created on either side of the two-axis migration are counted.

**Invariant — what may block a gate.** `parked` means "blocked by its own pipeline". A gate blocked by its parent **feature** bead is not parked in any harness: that bead stays open until after the merge, so the gate never reaches `bd ready`, never appears in `pendingHumanAction`, and a human merge is silently never requested. Keep the two shapes apart:

- A `create-chores` gate unblocks exactly once, when its `document` chore closes. Until then it is parked and must not stop dispatch.
- A gate must never carry a `blocks` dependency onto its own feature bead (e.g. `bd create ... --labels ...lifecycle:feature-pr` then dep it to `<id>`). Remove it with `bd dep rm <gate> <id>` if present, so the gate is unblocked while its PR awaits merge.

So the predicate is sensitive to *what* blocks a gate, not only whether something does. It is ralph's only gate predicate on every harness: the Claude-native agent file that kept an open-gate form is retired, so nothing else restates a second predicate.

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

## Reading the Trail

Ralph never tails a file. The worker writes its own bead trail at each transition through
`skills/workflow/run-pipeline-stage/scripts/trail-entry.mjs`, so progress is read from the bead:

```bash
bd show <chore-id>              # the worker's checkpoint entries: Outcome, Evidence, What is left
bd provenance log <chore-id>    # the refs it recorded: git-sha, branch, pr, work-id
bd children <parent-id>         # the whole chain's state, closed included
```

There is nothing to flush and no bookmark to keep in `state.json`: the record the orchestrator used
to poll is now the record the worker writes directly, so the per-parent log file and the line
counter that fed its tail are gone. On each completion:

1. **Read the completed worker's bead**: `bd show <chore-id>` for its entries, and
   `bd provenance log <chore-id>` for the commit, branch and PR it recorded.
2. **Post a chat summary** of what is new since the last report for that bead — the stage
   transition, the test and lint results, and the close reason. Not the entries verbatim.
3. **Post nothing when nothing new arrived** — do not spam the chat with empty polls.

---

## HITL Pause

Proceed here when no agent work is in flight (no stage, decomposition or expansion workers in `inflight`), nothing is dispatchable (`bd ready -l execution:afk` returns no `stage:*` chore, no childless feature to decompose, and no ready, claimable chore-less `execution:afk` task bead awaiting expansion), and `pending-gates.mjs` reports a non-empty `pendingHumanAction` — an **unblocked** `lifecycle:feature-pr` gate or an epic tagged `awaiting-epic-pr-merge` (see _Gate predicate_). Gates still parked behind their own pipeline do not count. Ralph stops rather than burning requests on idle polls.

1. For each **multi-feature** epic whose feature beads are all closed but not yet tagged `awaiting-epic-pr-merge`, open/update an epic PR to main (skip single-feature epics — their feature branch PRs already target `main`):
   ```bash
   gh pr create --base main --head epic/<epic-id> --title "[<epic-id>] Merge epic into main" --body "<epic summary>"
   ```
   Tag each epic bead with `awaiting-epic-pr-merge` until merged.
2. Run:
   ```bash
   bd dolt push
   ```
   **Gate on the exit status.** Non-zero: retry once, then stop and report the command, exit code and stderr as a sync blocker — no Pending Human Action table, and ralph does not claim a clean pause.
3. Collect the table rows from the script's `pendingHumanAction` list:
   ```bash
   node skills/workflow/ralph/scripts/pending-gates.mjs
   ```
   For each entry, run `bd show <id>` to retrieve the PR URL from bead notes. `kind: "feature-pr"` rows read "review and merge the feature PR"; `kind: "epic-pr"` rows read "review and merge the epic PR into main".
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

When nothing is in flight AND nothing is dispatchable — `inflight` holds no entries, `bd ready -l execution:afk` returns nothing (no `stage:*` chore, no childless feature to decompose, no ready, claimable chore-less task bead awaiting expansion) (_The in-flight invariant_ above):

1. For each **multi-feature** epic whose feature beads are all closed, open/update an epic PR to main (skip single-feature epics — no epic branch exists):
   ```bash
   gh pr create --base main --head epic/<epic-id> --title "[<epic-id>] Merge epic into main" --body "<epic summary>"
   ```
   Tag each epic bead with `awaiting-epic-pr-merge` until merged.
2. Run:
   ```bash
   bd dolt push
   ```
   **Gate on the exit status.** Non-zero: retry once, then stop and report the command, exit code and stderr as a sync blocker — no completion summary, no "All beads complete.", and the remaining shutdown steps are not run.
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

## Peer messaging (planner ↔ ralph)

The planner session (`plan` skill) and ralph are separate sessions with no shared terminal. Delivery, discovery, idle wake and the message ledger all belong to the harness's own messaging mechanism — the published **pi-peer** package on PI, a built-in facility on Claude Code. **Never build a registry, inbox, watcher or transport in its place** — this section defines only the message vocabulary and the reply rule that sit on top of it, and it is the single place both skills read.

### Transport

Send with {{TOOL:peer_send}}; list the peers you can reach with {{TOOL:peer_list}}, and address a peer only by the name or address that list reports. Where the mechanism provides a per-message intent, an idle subscription or a reply wait, use it — but never make a send depend on one.

Send from a scripted call, **never** by typing text into a busy terminal session: during the `pi-peer` package's adoption spike, stray keystrokes aimed at a running session were queued as user prompts twice, so the receiving agent read them as new instructions.

A send does not prove receipt. An inbound message may be held for approval before the receiving agent sees it, and delivery stays unconfirmed until the receiver answers.

The mechanism is supplied by the harness, and neither harness is forced into the other's: a PI session takes it from the `pi-peer` package runbook below, and a Claude Code session has it built in. **Only this subsection differs between the two installs** — the message kinds and the acknowledgement rule that follow are the same bytes on both, so a message means the same thing whichever mechanism carries it.

### The `pi-peer` package (PI)

A PI session gets its transport from this package, which a consuming repository installs itself — it is never a dependency of this package. Its `peer_get` and `peer_await` tools have no Claude Code counterpart, so they are named here and nowhere else in this convention.

#### Adoption in a consuming repository

1. **Install once per repository:** `pi install npm:@cryptolibertus/pi-peer`.
2. **List both roles** in `.pi/peers.json`: `planner` and `ralph`. The peer list is configuration, so both entries are required — see _Discovery is two-way only when both roles are listed_ below.
3. **Start each session with its own identity:** `PI_PEER_ID=planner pi` for the planning session, `PI_PEER_ID=ralph pi` for ralph. The file holds a default `localPeerId`, and `PI_PEER_ID` overrides it for the session. Confirm with `peer_list` — it reports `1 online - <peer id>` when discovery works.
4. **Send and read with the package's own tools:** `peer_send` (or `/peer send <id> "<text>" --intent <intent> --no-await`), `peer_list`, `peer_get` for a peer's current state and `peer_await` for a reply.
5. **Ignore the state files** the package writes — see _Files a consuming repository gains_ below.

#### Discovery is two-way only when both roles are listed

`.pi/peers.json` is a **static peer list, not a live registry**: the runtime merges `.pi/settings.json`, `.pi/peers.json` and the `PI_PEER_*` environment, then polls only the peers the file names. `/peer setup` never overwrites an existing `.pi/peers.json`, so a setup run in the second session leaves the file alone.

A single-entry file therefore makes discovery one-way: the listed peer sees the other as online, while the unlisted peer reports `no peers` and its sends write no message record. That is configuration, not a fault. The missing step is `/peer setup --peer <peer-id>`, which adds a trusted peer to the existing file. Two entries plus `PI_PEER_ID` per session is the whole setup — and because a send is not proof of receipt, a message stays unverified until the receiver answers.

#### Files a consuming repository gains

| File | Purpose | Tracked? |
|------|---------|----------|
| `.pi/peers.json` | the peer list plus the default `localPeerId` that `PI_PEER_ID` overrides | no |
| `.pi/peer-messages.json` | message records with source, target, status and conversation id | no |
| `.pi/peer-control-ledger.jsonl` | the control ledger | no |

All three are machine state, not tracked content. Tell the consuming repository to gitignore them: ignore `.pi/peers.json` **and** `.pi/peer-*` together. The literal path covers the peer list, which the glob does not match, and the glob covers the message and ledger files plus any further `peer-*.json` the package adds.

### Message kinds

The kinds map **onto** the transport's own intents where it has them (PI's `pi-peer`: `ask`, `review`, `notify`, `coordinate`, `task`); they never replace or re-implement the transport protocol.

| Kind | Carries | Maps to intent | Direction |
|------|---------|----------------|-----------|
| `handoff` | bead id + one-line scope | `task` | planner → ralph |
| `done` | bead id + run summary | `notify` | ralph → planner |
| `blocked` | gate bead id awaiting a human | `notify` | ralph → planner |
| `failed` | bead id + reason | `notify` | ralph → planner |
| `update` | bead id + stage progress | `notify` | ralph → planner |
| `get` | peer id, asks for current state | `coordinate` | either → either |
| `ask` | question text, needs an answer | `ask` | either → either |

Write the kind as the first word of the message text, e.g. `handoff agnt-ctx-abc.1 — implement the retry budget`.

### Acknowledgement rule

Statuses stay `running` or `queued` until the receiver answers, so **a sender cannot tell "delivered" from "done"**. Every inbound `handoff`, `get` and `ask` must be answered with exactly one of three reply kinds:

- `done` — carried out; name the bead id and give a one-line result (for `get`, the requested state).
- `blocked` — cannot proceed; name the gate bead that is waiting for a human.
- `failed` — could not be carried out; name the bead and the reason.

`update`, `done`, `blocked` and `failed` are reports, so they need no reply. Never leave a `handoff`, `get` or `ask` unanswered — reply that it is queued rather than staying silent.

---

## State Files

Status is read from beads — there is no rendered status document to build or refresh:

```bash
bd list --parent <parent-id>   # every chore for a feature, with its state
bd ready -l execution:afk      # the next dispatchable work
bd show <id>                   # full detail, including the worker's notes
```

| File | Purpose |
|------|---------|
| `.agent-cortex/ralph/state.json` | Runtime bookkeeping only: the in-flight agent-ID→bead mapping. Shape: `{ "inflight": [ { "kind": "stage", "choreId": "...", "parentId": "...", "title": "...", "agentId": "..." } ] }`. A decomposition worker is recorded with `"kind": "decompose"` and an expansion worker with `"kind": "expand"`, both with `"choreId": null` — they hold no chore but still occupy the wait set and the in-flight check. Initialise at startup with `{ "inflight": [] }`. Update after every dispatch and every agent completion. **Never hand-edit.** |

All task state is derived from beads; `state.json` holds only runtime bookkeeping:

| Question | How to answer |
|----------|---------------|
| What is in-flight? | The `inflight` entries in `.agent-cortex/ralph/state.json` — `kind: "stage"` for a dispatched stage chore, `kind: "decompose"` for a feature-decomposition worker, `kind: "expand"` for an expansion worker. Decomposition and expansion workers hold no chore, so beads alone under-report in-flight work. |
| What is ready? | `bd ready -l execution:afk` — the single dispatch predicate. Each result is routed by its shape: a childless `feature` bead is decomposed (_Feature Decomposition_), a bead with no `stage:*` children is expanded (_Expansion Guard_), a `stage:*` chore is dispatched. |
| What stage is a bead in? | Read the `stage:*` label from `bd show <id>` |
| Which agent-ID maps to which bead? | `inflight` entries in `.agent-cortex/ralph/state.json` |
| How many fix rounds? | Count chore beads with label `stage:fix` that are children of the parent task (`bd children <parent-id> --json | grep -c '"stage:fix"'`). Read `maxFixRounds` from `skills/planning/create-task/pipeline.json`. Read-only: used for the cap backstop, never to build remediation. |
| Which features are review-gated? | `pendingHumanAction` entries with `kind: "feature-pr"` from `pending-gates.mjs` — unblocked `lifecycle:feature-pr` gates on either HITL axis. A gate in `parked` is pre-created but not yet actionable |
| Which epics are review-gated? | `bd list -l awaiting-epic-pr-merge` |
