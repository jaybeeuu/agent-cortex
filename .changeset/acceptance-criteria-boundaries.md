---
"@jaybeeuu/agent-cortex": patch
---

`create-task` now asks for acceptance criteria that name a change's boundaries, not only its happy
path. The skill lists six kinds of boundary — a floor and a ceiling, empty versus absent,
single-fire versus double-fire, the ordering of two effects, the failure path, and a corrupt input
with its conservative default — and says to write the ones this contract has, so `tdd`'s
proportionality rule still holds. `REFERENCE.md` gains a criteria template with a function
criterion beside four boundary criteria, so an incomplete spec no longer leaves the reviewer to
invent the missing cases.
