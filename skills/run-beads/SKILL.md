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

## Classifying a Bead

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
| 2 | **reviewing** | Assess quality, correctness, and security |
| 3 | **fixing** | Apply reviewer feedback (skip if APPROVED) |
| 4 | **documenting** | Update shared project docs |
| 5 | **closed** | `bd close <id>` |

The fixing stage may repeat up to 3 times (revisions #2–#4). If still not approved after 4 total coding/fixing rounds, close the bead as failed.

## Dispatch Rules

| Stage completed | Condition | Next action |
|-----------------|-----------|-------------|
| `coding` | — | Run **reviewing** stage |
| `fixing` | — | Run **reviewing** stage |
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
> STAGE_COMPLETED: <coding|reviewing|fixing|documenting>
> SUMMARY: <2–3 sentence summary of what was done>
> FILES_CHANGED: <comma-separated list, or "none">
> REVIEW_OUTCOME: <APPROVED|CHANGES_REQUESTED>  ← reviewing stage only
> CHANGES_REQUESTED:                             ← only if REVIEW_OUTCOME is CHANGES_REQUESTED
> 1. <required change>
> 2. <required change>
> ---
> ```

Subagents report facts. **Do not ask subagents to suggest or predict the next step.**

## Prompt Templates

See [REFERENCE.md](REFERENCE.md) for the per-stage prompt templates to use when spawning subagents.
