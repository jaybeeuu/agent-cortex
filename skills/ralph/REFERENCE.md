# Ralph — Reference

Detailed procedures for the sequential bead orchestration workflow. See [SKILL.md](./SKILL.md) for the top-level workflow.

---

## Feature branches and worktrees

For each parent task bead (`<id>`):

1. Determine the parent epic (`<epic-id>`) from the task's `epic:<epic-id>` label via `bd show <id>`.
2. Ensure the epic branch exists (always based on the latest `origin/main`, never local `main`):
   ```bash
   git fetch origin
   git rev-parse --verify epic/<epic-id> >/dev/null 2>&1 || git branch epic/<epic-id> origin/main
   ```
3. Ensure feature worktree exists:
   ```bash
   git worktree add .agent-cortex/worktrees/<id> -b feature/<id> epic/<epic-id> 2>/dev/null || true
   ```
   If `.agent-cortex/worktrees/<id>` already exists, the command fails silently — reuse it.
4. All stage work runs in `.agent-cortex/worktrees/<id>`. The `feature/<id>` branch is the agent branch for HITL PRs.

---

## Stage execution

Each stage is executed inline by the PI agent in the feature worktree. The playbook at `skills/run-beads/playbooks/<stage>.md` provides stage-specific instructions.

### Common execution pattern

```bash
cd .agent-cortex/worktrees/<id>
```

1. **Read the playbook** with `read skills/run-beads/playbooks/<stage>.md`.
2. **Execute** using PI tools:
   - `bash` for running tests, linters, git operations
   - `read` for reviewing files
   - `edit` for precise code changes
   - `write` for new files
   - `grep`/`find`/`ls` for codebase exploration
3. **Log progress** to `.agent-cortex/ralph/ralph-<id>.log`:
   ```bash
   echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [<id>] [<stage>] message" >> .agent-cortex/ralph/ralph-<id>.log
   ```
4. **Close the chore bead** once the stage outcome is determined.

### Stage output contracts

Each stage must produce a clear outcome before closing its chore bead:

- **test-writing**: All tests fail as expected. `FILES_CHANGED` lists test files.
- **coding**: All tests pass. Implementation is minimal. `FILES_CHANGED` lists source/test files.
- **test-reviewing**: Tests are assessed against acceptance criteria. Outcome is SUCCESS (all requirements testable) or BLOCKED (missing coverage).
- **verifying**: Test suite and linters run. Outcome is PASS (green) or FAIL (red).
- **reviewing**: Quality assessment done. Outcome is APPROVED or CHANGES_REQUESTED.
- **fixing**: All requested changes applied. Outcome is SUCCESS or BLOCKED.
- **documenting**: Docs updated. Outcome is SUCCESS or BLOCKED.

---

## Feature PR gate

When the `documenting` stage completes successfully:

1. Close the documenting chore bead.
2. Switch to the feature worktree and create/update the PR:
   ```bash
   cd .agent-cortex/worktrees/<id>
   git add -A && git commit -m "[<id>] <summary>"
   git push origin feature/<id>
   gh pr create --base epic/<epic-id> --head feature/<id> \
     --title "[<id>] <task-title>" --body "<summary from documenting>"
   ```
   If an open PR already exists, skip creation (or update with `gh pr edit`).
3. Report the PR URL in your response.
4. Find the child HITL task bead with label `lifecycle:feature-pr`:
   ```bash
   bd list -l lifecycle:feature-pr -l implementation-type:hitl | grep "<id>"
   ```
5. Update that HITL bead with the PR URL:
   ```bash
   bd update <hitl-id> --notes "PR: <url>"
   ```
6. Close the parent feature bead: `bd close <id>`.
7. **Stop and report to the user.** The HITL PR gate bead must be closed by a human after the PR is merged before Ralph can continue.

---

## Epic PR gate

When all feature beads for an epic are closed:

1. Switch to the epic branch:
   ```bash
   git checkout epic/<epic-id>
   git merge feature/<id-1> feature/<id-2> ...
   git push origin epic/<epic-id>
   ```
2. Create the epic PR to `main`:
   ```bash
   gh pr create --base main --head epic/<epic-id> \
     --title "[<epic-id>] Merge epic into main" \
     --body "<epic summary from bead description>"
   ```
3. Tag the epic: `bd tag <epic-id> awaiting-epic-pr-merge`.
4. Report the PR URL. Ralph stops until the epic PR is merged.

---

## Progress snapshot

Generate a Markdown snapshot of all bead status:

```bash
workspace="/absolute/path/to/worktree"
pnpm --prefix ~/.copilot/installed-plugins/_direct/agent-cortex/skills/run-beads/scripts exec tsx generate-progress.ts --workspace "$workspace" > "$workspace/.agent-cortex/ralph/progress.md"
```

- `workspace` must be an **absolute** path — never `.` or `$(pwd)`.
- Regenerate after completing a bead, after opening a PR, and at shutdown.
- **Never hand-edit** the progress file.

---

## State reference

All orchestration state is derived from beads via `bd` commands:

| Question | Answer |
|----------|--------|
| What is ready? | `bd ready` — filter for chore beads with `stage:*` labels or AFK task beads |
| What stage is a bead in? | Read the `stage:*` label from `bd show <id>` |
| How many TDD loops? | `bd children <parent-id> \| grep 'stage:test-writing' \| wc -l` |
| How many fix rounds? | `bd children <parent-id> \| grep 'stage:fixing' \| wc -l` |
| Which features are review-gated? | `bd list -l lifecycle:feature-pr -l implementation-type:hitl` |
| Which epics are review-gated? | `bd list -l awaiting-epic-pr-merge` |
| What is the parent task? | `bd show <chore-id>` — follow the `parent-child` dependency |
| What is the feature PR URL? | `bd show <hitl-id>` — read from bead notes |

---

## Shutdown summary formats

### Pending human actions

```
All agent work is complete. The following steps require human action:

| Bead ID | Title | Action needed | PR |
|---------|-------|---------------|----|
| <id>    | <title> | Review and merge feature PR, then close this bead | <url> |
| <id>    | <title> | Review and merge epic PR into main | <url> |
```

### Needs refinement

```
The following beads need refinement before they can be implemented:

| Bead ID | Title |
|---------|-------|
| <id>    | <title> |

Remove the `needs-refinement` label once ready.
```

### Blocked from loop caps

```
The following features were blocked after reaching their retry cap:

| Bead ID | Title | Reason |
|---------|-------|--------|
| <id>    | <title> | Max TDD loops reached (5) |
| <id>    | <title> | Max fix rounds reached (<N>) |
```
