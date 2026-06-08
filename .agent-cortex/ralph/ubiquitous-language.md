# Ubiquitous Language

Canonical terms for the agent-cortex bead system.

## Bead taxonomy

| Term | bd type | Meaning |
|---|---|---|
| **epic** | `epic` | A workstream, may nest sub-epics. Broken into tasks. |
| **task** | `task` | A unit of work. Has a description, priority, and acceptance criteria. |
| **stage** | `chore` (ephemeral) | One step of the implementation pipeline within a task. Auto-created during task expansion, consumed by automation, garbage-collected. |

"Chore" is an implementation detail of the `bd` tool — it is not a user-facing concept. Refer to stages, not chores.

## Pipeline

| Term | Meaning |
|---|---|
| **pipeline** | The ordered sequence of stages that implements a task. Defined in `skills/create-task/pipeline.json`. |
| **stage** | One step in the pipeline. Identified by a `stage:<id>` label (e.g. `stage:code`, `stage:verify`). |

Current pipeline stages (from `pipeline.json`): `code → verify → review → document`.

The pipeline is generic — not TDD-specific. TDD may be used within a stage (e.g. the `code` stage playbook references `tdd` skill), but the pipeline itself does not mandate TDD loops.

## Skills

| Skill | Purpose |
|---|---|
| `bd-tool` | CLI mechanics for the `bd` tool: `bd prime`, `bd ready`, `bd show`, `bd update`, `bd create`, `bd close`. Used when interacting with the task tracker directly. |
| `create-task` | Create a task bead and expand it into pipeline stage beads. |
| `run-pipeline-stage` | Execute one pipeline stage for a task. Dispatches a sub-agent following the stage's playbook, returns a REPORT. |
| `ralph` | Full orchestrator: finds ready tasks, dispatches stages via `run-pipeline-stage`, handles review gates, PRs, and shutdown. |

