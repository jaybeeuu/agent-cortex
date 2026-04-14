---
name: run-beads
description: Run one or more beads through the implement → review → fix → document pipeline. Use when you want to work through a small number of beads inline, pick up a specific bead, or work without the full ralph parallel orchestrator.
---

# Run Beads

Execute beads through the full pipeline sequentially. For parallel batch execution across many beads, use the `agent-nexus:ralph` agent instead.

## Quick Start

1. Run `bd prime` and hold the output — it goes verbatim into every subagent prompt.
2. If no bead is specified, run `bd ready` and ask the user which to work on.
3. For each bead, run it through the pipeline (see below).

## Progress Report

To generate a Markdown snapshot of all bead status (Mermaid dependency graph, active work table, completed list), run:

```bash
npx tsx skills/run-beads/scripts/generate-progress.ts [--workspace <path>]
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



Always resolve to AFK or HITL before acting on a bead:

1. Run `bd label list <id>`.
2. `implementation-type:afk` → **AFK**. `implementation-type:hitl` → **HITL**.
3. If neither label: run `bd show <id>`, find `## Type`.
   - Apply `bd tag <id> implementation-type:afk|hitl` to record the result.
   - If `## Type` is absent: invoke the `classify-bead` skill.

Do not work a HITL bead — inform the user it requires human action and why.

## Pipeline

Each bead moves through these stages in order:

| # | Stage | Notes |
|---|-------|-------|
| 1 | **coding** | Initial implementation |
| 2 | **verifying** | Run tests and linters; PASS → reviewing, FAIL → fixing |
| 3 | **reviewing** | Assess quality, correctness, and security |
| 4 | **fixing** | Apply reviewer or verifier feedback |
| 5 | **documenting** | Update shared project docs |
| 6 | **closed** | `bd close <id>` |

The fixing stage may repeat up to 3 times (revisions #2–#4). If still not approved after 4 total coding/fixing rounds, close the bead as failed.

### Stage Transitions

Before dispatching a subagent for any stage, run these two commands (replacing `<id>` and `<stage>` with the bead ID and the stage about to start):

```bash
bd tag <id> stage:<stage>
npx tsx skills/run-beads/scripts/generate-progress.ts > .ralph-progress.md
```

This tags the bead with its current stage (beads are the source of truth for stage progress) and regenerates the progress doc so any inline pairing session stays current.

## Dispatch Rules

| Stage completed | Condition | Next action |
|-----------------|-----------|-------------|
| `coding` | — | Run **verifying** stage |
| `fixing` | — | Run **verifying** stage |
| `verifying` | `VERIFY_OUTCOME: PASS` | Run **reviewing** stage |
| `verifying` | `VERIFY_OUTCOME: FAIL` | Run **fixing** stage, increment revision # |
| `reviewing` | `REVIEW_OUTCOME: APPROVED` | Run **documenting** stage |
| `reviewing` | `REVIEW_OUTCOME: CHANGES_REQUESTED` and revision < 4 | Run **fixing** stage, increment revision # |
| `reviewing` | `REVIEW_OUTCOME: CHANGES_REQUESTED` and revision ≥ 4 | `bd close <id>` — failed, max revisions reached |
| `documenting` | — | `bd close <id>` — done |

## Report Format

Every subagent prompt **must** end with this instruction:

> End your response with a `---REPORT---` block in exactly this format:
> ```
> ---REPORT---
> BEAD_ID: <id>
> STAGE_COMPLETED: <coding|verifying|reviewing|fixing|documenting>
> SUMMARY: <2–3 sentence summary of what was done>
> FILES_CHANGED: <comma-separated list, or "none">
> REVIEW_OUTCOME: <APPROVED|CHANGES_REQUESTED>  ← reviewing stage only
> CHANGES_REQUESTED:                             ← only if REVIEW_OUTCOME is CHANGES_REQUESTED
> 1. <required change>
> 2. <required change>
> VERIFY_OUTCOME: <PASS|FAIL>                    ← verifying stage only
> VERIFY_FAILURES:                               ← only if VERIFY_OUTCOME is FAIL
> - <test/lint failure summary>
> ---
> ```

Subagents report facts. **Do not ask subagents to suggest or predict the next step.**

## Prompt Templates

See [REFERENCE.md](REFERENCE.md) for the per-stage prompt templates to use when spawning subagents.
