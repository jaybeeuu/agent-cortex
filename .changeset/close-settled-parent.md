---
"@jaybeeuu/agent-cortex": minor
---

Close a settled parent bead from the `post-merge` and `housekeeping` stages. The new
`close-settled-parent.mjs` closes a parent only when every child is closed and a closed child records
the merge (`lifecycle:feature-pr`, `lifecycle:post-merge` or `stage:post-merge`), reports one verdict
per run, and is a no-op on the second call. Nothing closed the parent before, so a bead that followed
the documented path ended `in_progress` with every child closed, waiting for a human.
