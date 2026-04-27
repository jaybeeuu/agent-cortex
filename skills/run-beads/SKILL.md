---
name: run-beads
description: Execute a single pipeline stage chore bead. Use when you want to work through a small number of beads inline, pick up a specific bead, or work without the full ralph parallel orchestrator.
---

# Run Beads

Execute a single pipeline stage chore bead. Each stage bead (code, verify, review, fix, document) is created by the `create-task` skill; this skill handles executing one at a time.

## Quick Start

1. Run `bd prime` and hold the output — it goes verbatim into every subagent prompt.
2. If no bead is specified, run `bd ready` and ask the user which to work on.
3. Claim the bead with `bd update <id> --claim`.
4. Read the bead's `stage:*` label to determine which stage to execute.
5. Load the matching prompt template from `skills/create-task/templates/<stage>.md`.
6. Populate the template placeholders and spawn a subagent.

## Progress Report

To generate a Markdown snapshot of all bead status (Mermaid dependency graph, active work table, completed list), run:

```bash
pnpm --prefix skills/run-beads/scripts exec tsx generate-progress.ts [--workspace <path>]
```

To typecheck or test the scripts package:

```bash
pnpm --prefix skills/run-beads/scripts typecheck
pnpm --prefix skills/run-beads/scripts test
```

The data-fetch layer (`parseBdList` / `parseBdShow`) is kept separate from the renderer so the output format can be swapped without re-fetching.

## Progress Logging

When running inside the ralph orchestrator, subagents must write structured progress lines to `.ralph-{bead-id}.log` (appending) so ralph can surface live updates. The bead ID and log file path are provided in each prompt.

**Format** — one entry per line:
```
[ISO-timestamp] [bead-id] [stage] message
```

**When to log:**
- Stage start: `[...] [abc-123] [coding] Stage started`
- Stage transitions: `[...] [abc-123] [coding→verifying] Stage complete`, `[...] [abc-123] [verifying→reviewing] PASS`, `[...] [abc-123] [verifying→fixing] FAIL`
- Key events only:
  - Test results: `Tests: 12 passed, 0 failed`
  - Lint result: `Lint: PASS` or `Lint: FAIL — <brief reason>`
  - Build errors: `Build failed: <brief reason>`
  - Security scan result: `Security scan: PASS` or `Security scan: FAIL — <finding>`
  - Any significant blocker or decision

**How to write a log line:**
```bash
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [bead-id] [stage] message" >> .ralph-bead-id.log
```

Do not log every file read or minor action — only transitions and key events.

---



Always resolve to AFK, HITL, or NEEDS-REFINEMENT before acting on a bead:

1. Run `bd label list <id>`.
2. If `needs-refinement` label is present → **NEEDS-REFINEMENT**: skip entirely; do not claim or implement.
3. `implementation-type:afk` → **AFK**. `implementation-type:hitl` → **HITL**.
4. If neither AFK nor HITL label: run `bd show <id>`, find `## Type`.
   - Apply `bd tag <id> implementation-type:afk|hitl` to record the result.
   - If `## Type` is absent: invoke the `classify-bead` skill.

Do not work a HITL bead — inform the user it requires human action and why.
Do not work a NEEDS-REFINEMENT bead — it must be refined before it can be implemented.

## Pipeline

Each bead moves through these stages in order:

| # | Stage | Notes |
|---|-------|-------|
| 1 | **test-writing** | Write a minimal set of failing tests for the next requirement slice |
| 2 | **coding** | Make the tests pass with minimal implementation |
| 3 | **test-reviewing** | Compare tests against acceptance criteria; DONE → verifying, NEEDS_MORE → test-writing |
| 4 | **verifying** | Run tests and linters; PASS → reviewing, FAIL → coding |
| 5 | **reviewing** | Assess quality, correctness, and security |
| 6 | **fixing** | Apply reviewer feedback |
| 7 | **documenting** | Update shared project docs |
| 8 | **closed** | `bd close <id>` |

The test-writing → coding → test-reviewing loop repeats until all requirements are covered (max 5 TDD loops). The fixing stage is driven by reviewer feedback only.

### Stage Transitions

Before dispatching a subagent for any stage, run these two commands (replacing `<id>` and `<stage>` with the bead ID and the stage about to start):

```bash
bd tag <id> stage:<stage>
pnpm --prefix skills/run-beads/scripts exec tsx generate-progress.ts > .ralph-progress.md
```

This tags the bead with its current stage (beads are the source of truth for stage progress) and regenerates the progress doc so any inline pairing session stays current.

## Dispatch Rules

| Stage completed | Condition | Next action |
|-----------------|-----------|-------------|
| `test-writing` | — | Run **coding** stage |
| `coding` | — | Run **test-reviewing** stage |
| `test-reviewing` | `TEST_REVIEW_OUTCOME: NEEDS_MORE` and tddLoops < 5 | Run **test-writing** stage, increment tddLoops |
| `test-reviewing` | `TEST_REVIEW_OUTCOME: NEEDS_MORE` and tddLoops ≥ 5 | `bd close <id>` — failed, max TDD loops reached |
| `test-reviewing` | `TEST_REVIEW_OUTCOME: DONE` | Run **verifying** stage |
| `verifying` | `VERIFY_OUTCOME: PASS` | Run **reviewing** stage |
| `verifying` | `VERIFY_OUTCOME: FAIL` | Run **coding** stage |
| `reviewing` | `REVIEW_OUTCOME: APPROVED` | Run **documenting** stage |
| `reviewing` | `REVIEW_OUTCOME: CHANGES_REQUESTED` and reviewRounds < 2 | Run **fixing** stage, increment reviewRounds |
| `reviewing` | `REVIEW_OUTCOME: CHANGES_REQUESTED` and reviewRounds ≥ 2 | `bd close <id>` — failed, max review rounds reached |
| `fixing` | — | Run **test-reviewing** stage |
| `documenting` | — | `bd close <id>` — done |

## Report Format

Every subagent prompt **must** end with this instruction:

> End your response with a `---REPORT---` block in exactly this format:
> ```
> ---REPORT---
> BEAD_ID: <id>
> STAGE_COMPLETED: <test-writing|coding|test-reviewing|verifying|reviewing|fixing|documenting>
> SUMMARY: <2–3 sentence summary of what was done>
> FILES_CHANGED: <comma-separated list, or "none">
> REVIEW_OUTCOME: <APPROVED|CHANGES_REQUESTED>  ← reviewing stage only
> CHANGES_REQUESTED:                             ← only if REVIEW_OUTCOME is CHANGES_REQUESTED
> 1. <required change>
> 2. <required change>
> VERIFY_OUTCOME: <PASS|FAIL>                    ← verifying stage only
> VERIFY_FAILURES:                               ← only if VERIFY_OUTCOME is FAIL
> - <test/lint failure summary>
> TEST_REVIEW_OUTCOME: <DONE|NEEDS_MORE>         ← test-reviewing stage only
> GAPS:                                          ← only if TEST_REVIEW_OUTCOME is NEEDS_MORE
> - <uncovered requirement>
> ---
> ```

Subagents report facts. **Do not ask subagents to suggest or predict the next step.**
