# Idea: state-in-beads-not-md

## Status
Recorded as bead `agnt-ctx-ul91` (2026-09-22) — awaiting `plan`. Merged with
`bead-progress-notes-for-session-resumption.md` into one bead state model design (this file is
Part 1: WHERE state lives).

## Created
2026-08-30

## Problem
Skills write a lot of operational documents that are never meant to be committed or read
by humans at rest — they describe transient notes/current state. Today they land as md files:
- `hitl-collab` writes `.agent-cortex/working-docs/hitl/<bead-id>/handoff.md` — one file per
  bead, near-duplicating information that already lives (or should live) on the bead.
- `run-pipeline-stage` / `ralph` write `.agent-cortex/ralph/ralph-{bead-id}.log` and
  `.agent-cortex/ralph/progress.md` for live progress surfacing.
These files duplicate bead state, rot as the bead changes, and fragment context across
files + beads. They're also invisible to `bd` tooling (search, deps, sync).

## Who benefits
Every agent skill run that produces state (hitl-collab, ralph, run-pipeline-stage, plan,
and any future skill that takes notes). The author benefits from a single source of truth,
and ralph/pipeline state stops living in a `.agent-cortex` attic that drifts from the beads.

## Proposed outcome
A general rule stored in agent docs: **any artifact that is notes/current state — not
intended as committable durable documentation — lives in the bead's fields** (`--notes`,
`--context`, `--design`), not in md files.
- Durable, committable docs (SKILL.md, REFERENCE.md, playbooks/, prompts/, docs/) stay files.
- `hitl-collab` handoff: write the handoff content into the HITL bead (`--context`/`--notes`),
  drop the `.agent-cortex/working-docs/hitl/<bead-id>/handoff.md` file flow.
- ralph progress/log lines: feed a live progress view off the beads (or a temp/log file kept
  explicitly out of the `working-docs` convention) — spike details during planning.
- `record-idea`'s caveat: this same principle is what `record-ideas-as-beads` already applies
  to idea records; this idea generalises it to operational/state artifacts.

## Validity check
- Evidence we already have: `bd` fields (`--notes`, `--context`, `--design`) support the content
  model; `record-ideas-as-beads` already proves bead-field content is workable for structured
  records (design decided 2026-08-25). Bead notes are multi-line and markdown-capable.
- Riskiest assumption: live progress surfacing (ralph's log tail / progress.md) can be
  satisfied without a scratch file — the bead-update round-trip may be too slow/chatty for
  high-frequency log lines; may need a per-run scratch log that is explicitly ephemeral and
  deleted on close, rather than a persistent working doc.
- What would invalidate this idea: if bead fields become unwieldy for large attachments (e.g.
  long PR summaries), or if a future agent needs shared state that must not be per-bead
  (cross-bead coordination) — that's a different problem, not a per-bead note.

## Constraints
- Bead content is portable and searchable: `bd show <id>` must remain a comfortable read
  surface for handoff/notes.
- Never regress committable docs into beads (AGENTS.md/skills stay in-repo markdown).
- P2 (medium): actively annoying today — hitl-collab handoff docs are already duplicating
  bead state.

## Next validation step
Pick one skill (hitl-collab is the smallest, clearest case): prototype writing the handoff
into the bead's `--context` (or `--notes`) and read it back with `bd show`, confirm the
HITL reader (ralph/plan/handoff skill) can consume bead-stored handoffs; then extend the
rule to ralph progress with an ephemeral-scratch-log fallback if needed.

## Notes
Cross-link: sibling idea `record-ideas-as-beads` (fleshed out 2026-08-25) covers ideas
specifically — once it lands, docs/ideas/ disappears and this record becomes a bead too.
The rule here is the generalisation: beads are for state, files are for durable docs.
Skills that currently write working docs: `hitl-collab` (handoff.md), `ralph` +
`run-pipeline-stage` (ralph-*.log, progress.md). Update `bd-tool`/`git-workflow`/AGENTS.md
conventions if the rule lands.