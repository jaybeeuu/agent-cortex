---
"@jaybeeuu/agent-cortex": patch
---

Route ralph by `execution:afk` and give it feature decomposition (F4 of the two-axis model).

Ralph's dispatch predicate is now one query — `bd ready -l execution:afk` — and every ready
`execution:afk` bead is its work, whether that bead is a feature, a task or a chore. What happens
next is decided by the bead's *shape*: a childless `feature` bead is decomposed, a bead with no
`stage:*` chores is expanded, a `stage:*` chore is dispatched. This replaces the previous
`implementation-type:` vocabulary and, more importantly, removes a blind spot: a predicate that
looked only for "chores with `stage:*`" reported an `execution:afk` bead with no stage chores as
idle while it was work waiting for a worker.

Feature decomposition is the new behaviour (epic Q2). A ready `execution:afk` bead of type
`feature` with no children is not dispatchable work — ralph dispatches a decomposition worker that
builds the Q5 hierarchy (one `execution:hitl` planning bead plus `execution:afk` implementation
children wired to wait on it), confirms the children exist rather than trusting the report, records
the worker as `kind: "decompose"` in `state.json`, and then goes idle behind the planning bead.
Because a feature carries `execution:hitl` by default, this only ever runs for a feature a human has
deliberately relabelled `execution:afk`; the label, not the bead type, decides routing, so Q2 and Q5
hold together and Q5b's dependency gate does the pausing. The procedure lives in
`REFERENCE.md` (_Feature Decomposition_) with the trigger in `SKILL.md`, the whole flow mirrored
into `agents/ralph/agent.md`, and the planning-gate label in `agents/ralph-plan/agent.md` renamed to
match.

All HITL gate queries move to `execution:hitl` and live in one place —
`skills/workflow/ralph/scripts/pending-gates.mjs`, which counts gates on either HITL axis during the
cutover (_Gate predicate_) — and the parked-versus-pending invariant in _The in-flight invariant_ is
unchanged: dispatchable
still means ready *and* claimable, so a bead behind an open feature-PR gate stays paused work rather
than re-arming a wait over an empty agent set.
