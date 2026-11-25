---
"@jaybeeuu/agent-cortex": minor
---

Add the `feedback` skill: one finding — a defect noticed while working, a design objection, a missing
capability — filed as a local item through the `feedback` command instead of hand-written markdown.
The item carries `title`, `date`, `source`, `area` and `severity` and the three sections `What
happened`, `Evidence` and `Proposed change`; `REFERENCE.md` states that shape once, so the command
that renders it and the agent that reads it cannot drift. A finding is never published — no issue, no
push, no pull request, no release — and its text never enters a shared artefact. The destination
resolves from `AGENT_CORTEX_FEEDBACK_DEST`, then `~/.agent-cortex/feedback.json`, then
`~/.agent-cortex/feedback/`, and the skill reports which path was used; a configured path that cannot
be used is reported, then the item is filed into the default with both paths named. Counting defect
classes across beads stays in `review-report`.
