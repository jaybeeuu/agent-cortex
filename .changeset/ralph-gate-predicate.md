---
"@jaybeeuu/agent-cortex": patch
---

Make ralph's PR gate brake depend on a gate being *unblocked*, and count gates
on the current HITL label axis.

`create-chores` pre-creates a `lifecycle:feature-pr` gate for every planned
feature, blocked behind that feature's own `document` chore. Ralph's rule — "do
not schedule new parent features while any HITL gate bead is open" — therefore
matched every unstarted feature, so the brake was permanently on: with eight
open gates, none of them actionable, no new feature could ever be dispatched.
The pause query had drifted the other way: it filtered on the legacy
`implementation-type:hitl` axis only, so gates migrated to `execution:hitl`
were invisible and pending human action was under-reported.

- `skills/workflow/ralph/scripts/pending-gates.mjs` resolves the question in one
  place: `pendingHumanAction` holds unblocked gates plus epics tagged
  `awaiting-epic-pr-merge` and is the only scheduling brake; `parked` holds
  gates still blocked behind their own pipeline, which never stop dispatch and
  never appear in the Pending Human Action table.
- Gate queries match `lifecycle:feature-pr` on either HITL axis, so gates
  created on either side of the two-axis migration are counted.
- ralph's composable agent source (`agents/ralph/agent.md`) and the ralph skill
  and REFERENCE now point at the script instead of restating ad-hoc `bd` queries
  that had already drifted.
- `agents-native/ralph.md` (the Claude harness) keeps the **open**-gate form and
  only takes the dual-axis query: its gates stay blocked for their whole life —
  `create-task` blocks them behind a `document` chore no Claude ralph closes, and
  the native route deps them onto the still-open feature bead — so the unblocked
  predicate would never fire there and ralph would report "All beads complete."
  with PRs unmerged. REFERENCE.md now states the invariant: a gate blocked by its
  parent feature bead is not parked in any harness, so a gate must not carry a
  `blocks` dependency onto its own feature.

Reconcile with agnt-ctx-s5xd.10 (ralph harness unification) when that rewrites
ralph's agent files — it owns collapsing the two predicates into one.
