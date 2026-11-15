---
"@jaybeeuu/agent-cortex": minor
---

Rank bd due dates in the `hitl-queue`. A bead's `--due` date now multiplies its total by the
factor of the narrowest tier its remaining time fits inside — `1` more than a week out, `1.5`
within a week, `2` within two days, `4` within a day, `8` once overdue. The numbers live in the
strategy's new optional `## Deadline tiers` table, so tuning them is a strategy edit and a
`bump`, never a code change; a strategy without that section ranks on the documented default,
and `validate` fails a table it cannot read. Each row shows the deadline, the time left and the
factor, an overdue bead is flagged `OVERDUE` rather than lifted in silence, and a bead with no
due date keeps the neutral factor. A deferred bead stays out of the queue until its
`defer_until` passes, applying bd's own wake rule to bd's own field.
