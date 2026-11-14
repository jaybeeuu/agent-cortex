---
"@jaybeeuu/agent-cortex": minor
---

Add the **guppi** agent — the human-in-the-loop counterpart to ralph. It is a resident,
propose-only collaborator that decides what gets planned, loads `prioritise-work`, `plan`,
`hitl-collab`, `grill-me` and `flesh-out-idea` on demand, and never executes AFK work, merges or
pushes. `using-agent-skills` now routes "what should I work on" and HITL collaboration to guppi,
and `plan` cross-references it as the entry point that decides what gets planned.
