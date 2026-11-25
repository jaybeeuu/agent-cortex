---
"@jaybeeuu/agent-cortex": minor
---

Ralph's dispatch set now lives on the bead instead of in a file beside the tracker. A dispatch writes
a claim and one `dispatched: kind=<stage|decompose|expand> worker=<agent-id>; cwd=…; session=…` trail
entry on the bead that owns the work — the chore for a stage, the feature or task bead for a
decomposition or expansion worker. Handling the result appends the matching `completed:` record,
which is what takes a bead back out of the set while its status stays `in_progress`.

The in-flight set is therefore a query. The new `skills/workflow/ralph/scripts/inflight.mjs` runs one
read-only `bd list -s in_progress` and prints `{ inflight, parents, stalled, unrecorded }`, sorted by
id: the workers in flight, their parent features, the ones that are no longer alive (an expired lease
or silence past `idle-check.mjs`'s threshold, imported rather than restated), and the in-progress
beads no record explains. A completed stage leaves the set by leaving `in_progress`; a worker that
dies leaves a bead a human can find.

Ralph keeps no state file. The wake handle belongs to the mechanism that created it — a blocking wait
on PI, the harness's own event on Claude — and an existing `.agent-cortex/ralph/state.json` is ignored
rather than migrated: nothing reads it, nothing rewrites it, and no install deletes it.
