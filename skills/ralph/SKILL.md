---
name: ralph
description: Sequential bead orchestration for PI agent. Runs pending beads through their pipeline stages inline — one at a time — opening review-gated PRs on completion. Use when you want to run the full task backlog, or when you say "run ralph", "work the beads", or "process the backlog".
---

# Ralph

Ralph is a sequential bead-orchestration workflow for the PI agent. It finds ready beads, runs each one through its pipeline stages (test-writing → coding → test-reviewing → verifying → reviewing → fixing → documenting) using PI's built-in tools, then opens review-gated PRs before stopping for human approval.

Unlike the Copilot CLI version, Ralph for PI runs **inline** — the agent executes each stage directly rather than dispatching parallel background subagents. Beads are processed one at a time.

## When to use

- "run ralph" or "start the ralph loop"
- "work through the backlog" or "process pending beads"
- "run all ready tasks" or "execute the pipeline"
- Any time you need to advance beads through implementation → review → PR

## Workflow

### 1. Initialise

1. Run `bd prime`. Hold the full output in memory — you need it for context.
2. Ensure `.agent-cortex/` and `.agent-cortex/worktrees/` are in the project's `.gitignore` (append any that are missing).
3. Create the workspace directory: `mkdir -p .agent-cortex/ralph`.
4. Run `bd ready` to list available beads.

### 2. Classify ready beads

For each bead from `bd ready`:

- **Chore bead with `stage:*` label** — pipeline stage bead that was previously created (e.g. from a feedback loop). Process it (see step 3).
- **Task bead** — inspect its labels:
  - If it has `implementation-type:hitl` — note it for the **Pending Human Action** summary at shutdown. Do not process.
  - If it has `implementation-type:afk` — proceed to step 3.
  - If it has `needs-refinement` — note it for the **Needs Refinement** summary at shutdown. Do not process.
  - If no `implementation-type:*` label — classify it: read the bead's `## Type` section from `bd show <id>`, then apply `bd tag <id> implementation-type:afk` or `bd tag <id> implementation-type:hitl`. If the `## Type` section is absent, invoke the `classify-bead` skill.
  - If a new AFK task is unexpanded (no chore children), expand it via `create-task` skill first.

### 3. Process each bead

For each AFK task bead (one at a time, in order from `bd ready`):

#### 3a. Claim and prepare

```bash
bd update <id> --claim
```

Determine the parent epic from the bead's `epic:<epic-id>` label. Ensure branch and worktree exist:

```bash
git fetch origin
git rev-parse --verify epic/<epic-id> >/dev/null 2>&1 || git branch epic/<epic-id> origin/main
git worktree add .agent-cortex/worktrees/<id> -b feature/<id> epic/<epic-id> 2>/dev/null || true
```

All stage work runs in the feature worktree (`.agent-cortex/worktrees/<id>`), not the repo root.

#### 3b. Create and run pipeline stages

For each pipeline stage in order, do the following:

**Create a chore bead for tracking:**

```bash
chore_id=$(bd create "[<id>] <Stage title>" --type chore --priority <same as parent> -q)
bd tag $chore_id stage:<stage>
bd tag $chore_id workflow:ralph
bd dep add $chore_id <id> --type parent-child
bd update $chore_id --claim
```

**Execute the stage** in the feature worktree:
1. `cd .agent-cortex/worktrees/<id>`
2. Read the stage playbook from `skills/run-beads/playbooks/<stage>.md` for stage-specific instructions.
3. Execute the stage using PI's tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`).
4. Write structured progress to `.agent-cortex/ralph/ralph-<id>.log`:
   ```bash
   mkdir -p .agent-cortex/ralph && echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [<id>] [<stage>] message" >> .agent-cortex/ralph/ralph-<id>.log
   ```

**Close the chore bead and handle the outcome:**

```bash
bd close <chore_id>
```

Use the dispatch rules below to determine the next stage.

#### Pipeline stages in order

| Stage | What to do | Next on SUCCESS | Next on BLOCKED |
|-------|-----------|-----------------|-----------------|
| **test-writing** | Write minimal failing tests for the next requirement slice. Follow `playbooks/test-writing.md`. | → coding | Block parent |
| **coding** | Make tests pass with minimal implementation. Follow `playbooks/coding.md`. | → test-reviewing | → fixing |
| **test-reviewing** | Compare tests against acceptance criteria. Follow `playbooks/test-reviewing.md`. | → verifying | → test-writing (if TDD loops < 5) or block parent |
| **verifying** | Run tests and linters. Follow `playbooks/verifying.md`. | → reviewing | → coding |
| **reviewing** | Assess quality, correctness, security. Follow `playbooks/reviewing.md`. | → documenting | → fixing (if fix rounds < maxFixRounds) or block parent |
| **fixing** | Apply feedback from review. Follow `playbooks/fixing.md`. | → test-reviewing | Block parent |
| **documenting** | Update shared project docs. Follow `playbooks/documenting.md`. | Close parent bead, open PR | Block parent |

#### Loop caps

Before creating a feedback loop chore bead, check loop counts via `bd`:

- **TDD loop cap** (test-writing feedback beads): count `bd children <id> | grep 'stage:test-writing' | wc -l`. Max 5. If reached, block the parent.
- **Fix round cap** (fixing feedback beads): count `bd children <id> | grep 'stage:fixing' | wc -l`. Max as defined by `maxFixRounds` in `skills/create-task/pipeline.json`. If reached, block the parent.

Block command: `bd update <id> --status blocked --notes "<cap> cap reached"`. Record for shutdown summary.

#### Creating feedback beads

When a stage reports `BLOCKED`, create a feedback chore bead instead of advancing:

```bash
feedback_id=$(bd create "[<id>] <Feedback title>" --type chore \
  --description "<BLOCKING_ISSUES content from the stage>" --priority <same as parent> -q)
bd tag $feedback_id stage:<next-stage>
bd tag $feedback_id workflow:ralph
bd dep add $feedback_id <id> --type parent-child
```

After creation, restart processing from the new stage. The feedback bead replaces the original next stage.

### 4. Open feature PR

When the `documenting` stage completes successfully:

1. Close the documenting chore bead.
2. Create or update a PR from the agent branch to the feature branch:
   ```bash
   gh pr create --base epic/<epic-id> --head feature/<id> --title "[<id>] <task-title>" --body "<summary from documenting stage>"
   ```
   If an open PR already exists, skip creation.
3. Report the PR URL in your response.
4. Find the child HITL task bead for this parent with label `lifecycle:feature-pr`.
5. Update that HITL bead with the PR URL:
   ```bash
   bd update <hitl-id> --notes "PR: <url>"
   ```
6. Close the parent feature bead: `bd close <id>`.
7. **Stop and report to the user.** The HITL PR gate bead must be closed by a human after the PR is merged before Ralph can continue with more beads.

### 5. Process epic PRs

When all feature beads for an epic are closed, open an epic PR to `main`:

```bash
gh pr create --base main --head epic/<epic-id> --title "[<epic-id>] Merge epic into main" --body "<epic summary>"
```

Tag the epic bead: `bd tag <epic-id> awaiting-epic-pr-merge`.

### 6. Shutdown

When no AFK beads remain and no `stage:*` chore beads are ready:

1. Regenerate progress snapshot:
   ```bash
   workspace="/absolute/path/to/worktree"
   pnpm --prefix ~/.copilot/installed-plugins/_direct/agent-cortex/skills/run-beads/scripts exec tsx generate-progress.ts --workspace "$workspace" > "$workspace/.agent-cortex/ralph/progress.md"
   ```
2. Run: `bd dolt push`
3. Report any pending human actions:
   - Open HITL PR gate beads with their PR URLs
   - Epic beads tagged `awaiting-epic-pr-merge`
   - Needs-refinement beads that were skipped
   - Blocked parents that hit loop caps
4. If everything is complete, state: `All beads complete.`

## Cross-skill references

- Use `classify-bead` when a bead is missing its `implementation-type:*` label.
- Use `run-beads` playbooks (`skills/run-beads/playbooks/<stage>.md`) for detailed stage execution instructions.
- Use `create-task` to expand AFK task beads that have no chore children.
- Use `style-code` before making code changes.
- Use `style-tests` before writing tests.

## Verification checklist

- [ ] `bd prime` output is held in memory and used for context throughout
- [ ] Every bead is classified (AFK, HITL, or needs-refinement) before processing
- [ ] Branches and worktrees exist before stage work begins
- [ ] Each pipeline stage creates a chore bead and closes it on completion
- [ ] Stage playbook is read and followed for each stage
- [ ] Loop caps (TDD max 5, fix rounds max as per pipeline.json) are enforced
- [ ] Feature PRs are opened immediately when documenting completes
- [ ] HITL PR gate beads are updated with PR URLs
- [ ] Epic PRs are opened when all feature beads are closed
- [ ] Progress snapshot is regenerated at key points and on shutdown
- [ ] `bd dolt push` is called at shutdown
