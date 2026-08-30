# Idea: record-ideas-as-beads

## Status
Fleshed out 2026-08-25 — design decisions locked in an interview; not yet implemented.

## Created
2026-08-25

## Problem
Ideas currently live as loose markdown files in `docs/ideas/`. This sits awkwardly alongside
the rest of the workflow, which is almost entirely bead-based (bd). Because ideas aren't beads,
they can't be searched with `bd label`, can't express relationships/dependencies to real tasks,
can't be given priority that surfaces alongside other work, and can't sync to remote via
`bd dolt push`. There's no clean promotion path from "idea" to "epic" to "executable task".

## Who benefits
The author's daily planning loop. Ideas are the beginning of epics, so making them first-class
beads gives a single coherent backlog where an idea can grow relationships to the tasks it
spawns. The plan/agent-nexus agents benefit too: agent-nexus will eventually schedule work
through planning stages (not just execution), and a beads-native idea record gives it a clean
input to plan against.

## Proposed outcome
Record ideas as beads labelled `kind:idea`, replacing `docs/ideas/*.md` entirely (bead-only —
files deleted after migration). `bd` already supports labels natively (`bd create -l`,
`bd label add/list`). An idea bead maps directly to an epic; promoting it means spawning task
beads as children and letting the idea bead become the epic node.

## Fleshed-out design (decided 2026-08-25)

### Label & identification
- **`kind:idea` label** marks idea beads. Ideas do NOT use `deferred` status — they stay
  `open` so they're visible to idea tooling; hiding from actionable work is done by exclusion,
  not status.
- **ralph excludes them**: ready queries use `bd ready --exclude-label kind:idea`
  (verified: `bd ready` supports `--exclude-label`). Idea beads never appear as claimable work.
- Optional companion labels: `priority:<0-4>`, `epic:<id>` once promoted.

### Flesh-out workflow (the skill that consumes them)
There should be a **flesh-out skill** (e.g. `flesh-out-idea`) that answers: *"which idea beads
are ready to be fleshed out?"* This is `bd ready -l kind:idea` — the blocker-aware ready query
scoped to ideas. Because `bd ready` already respects dependencies, an idea bead that
`depends-on` in-flight work (e.g. "needs unified-ci-pipeline landed first") naturally shows as
*not ready* until its deps close. That's exactly the semantics wanted:
- `bd ready -l kind:idea` → list & pick an idea ready for fleshing.
- The skill runs the record-idea-style interview (why / how / when / priority) at deeper depth,
  updating the bead's description/design/notes as the idea ripens.
- Once fleshed out enough, the idea can be promoted (below).

### Promotion path: idea → epic → tasks
Parent-child hierarchy (chosen over labels+deps only):
1. Idea bead starts with `kind:idea`, type defaulted appropriately (still `task` type, or set
   `epic` type on promotion).
2. On promotion: `bd label add <idea> epic:<idea-id>` (or flip to an epic label), then spawn
   task beads with `--parent <idea-id>` — children inherit the epic relationship natively.
3. The idea bead becomes the epic node; its children are the executable tasks. Closing the
   children resolves to the epic closing.

### Content model (bead fields)
Map the current idea-template sections onto bd fields:
| md template field | bd field |
|---|---|
| Title | `--title` |
| Problem / Why | `--description` |
| How we might do it | `--design` |
| When / Priority / Validity / Constraints / Notes | `--notes` (structured, keep section markers) |
| anything referential | `--context` |

Multiple sections per field use explicit markers (`## Validity check`, etc.) inside the field
so the flesh-out interview can find/update them later.

### Skill changes
- **`record-idea`**: replace scaffold-file flow (`new-idea.sh` → `docs/ideas/x.md`) with bead
  creation: interview → `bd create "<title>" -l kind:idea -d "<why>" --design "<how>"
  --notes "<when/priority/validity>"`. Keep the interview; drop the markdown scaffold script.
- New **`flesh-out-idea`** skill (see above) — validates readiness (`bd ready -l kind:idea`),
  picks an idea, drives the deepening interview, updates the bead, optionally promotes.

### Migration
- Bulk-migrate the existing `docs/ideas/*.md` records to beads: read each file, map sections to
  bd fields, `bd create -l kind:idea`, preserve priority. Run as a one-off (manual or scripted).
- Then **delete `docs/ideas/`** — bead-only going forward.
- Update `AGENTS.md` + any stale references that point at `docs/ideas/`.
- The `record-idea` skill itself must unlearn the docs/ideas path.

## Validity check
- Evidence we already have: `bd ready --exclude-label` and `bd ready -l` both exist and compose
  (label filtering + blocker-aware ready semantics) — the two core mechanisms this idea needs
  are native, no feature build. `--parent` exists for the hierarchy. 9-10 idea files exist to
  migrate; the record-idea skill and its script are the only two consumers of the file flow.
- Riskiest assumption: that keeping ideas `open` (not `deferred`) + label exclusion is
  discoverable enough — ralph, plan agents, and the author must remember the exclusion. The
  `bd-tool` skill's labels table needs `kind:idea` documented with the exclusion convention.
- What would invalidate this idea: if label-based exclusion leaks idea beads into `bd ready`
  via some path (e.g. `bd ready` without the exclude flag), or if losing the scannable
  `docs/ideas/` directory hurts occasional review more than bead queries help it.

## Constraints
- Ideas stay quick to scan: `bd list -l kind:idea` + `bd show <id>` should be a comfortable
  replacement for opening the directory.
- Idea beads must never appear in ralph's actionable-ready view.
- `record-idea` and `bd-tool` skills stay consistent — no stale references to docs/ideas.
- Priority of ideas uses the same P0-P4 scale as tasks (P4 = backlog default for ideas).

## Next validation step
Prototype one idea as a labelled bead: create it with `-l kind:idea`, confirm `bd ready`
excludes it by default and `bd ready -l kind:idea` surfaces it; then promote it (add epic label,
spawn a child task) to confirm the hierarchy reads correctly. If the prototype passes, do the
bulk migration + skill updates.

## Notes
Interview on 2026-08-25 locked: labels over status (kind:idea + ralph exclusion), bead-only
content (files deleted), parent-child promotion, and record-idea skill rewritten to create
beads. Agent-nexus is the planned consumer. Once this lands, this very record becomes an
idea-bead (and then this file is deleted — the migration eats its own tail).