---
"@jaybeeuu/agent-cortex": minor
---

Add `recommend.mjs shortlist`, so a session that has to decide sees the queue's first ten rows as one
ranked list instead of a single recommendation it cannot argue with.

Each row is one line: rank, scope, id, total, title, the four RICE components with both multipliers,
the due moment where the bead has one, and what answering it unblocks. The top row carries
`← recommendation`; the rows, their order and every number are the queue's own. A queue with more
rows than the count states how many were omitted and the command that shows them; a queue with
fewer says the list is complete. `--top <n>` moves the count, and its default is 10.

A row other than the top is a priority challenge, never a selection: it routes to the strategy
review, so the ranking changes because the strategy changed. `recommend` still prints one row for a
session that must say one item, and every stated condition renders the same text on both commands.
