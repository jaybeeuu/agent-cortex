---
"@jaybeeuu/agent-cortex": major
---

Split `prioritise-work` into two skills, because it carried two jobs and its name described only the
second — so authoring a strategy was unfindable.

`strategise` inherits the whole skill: the strategy file contract, the summary-first run, the
interview, `init`/`validate`/`bump`/`summary`, `CHALLENGE.md`, `REFERENCE.md`, the scripts and the
template. Its own description now says what it is for, and it states that it neither scores nor
ranks.

`prioritise` is new and deliberately thin: it owns the score-then-rank sequence — validate the
strategy, score each bead with `score-bead`, then rank with `hitl-queue` — and the guard that refuses
to rank when `validate` exits non-zero, naming `strategise` as the fix. It restates no rule from
either skill it calls.

The strategy file's format, version, `REQUIRED_SECTIONS` and `validate`/`bump` behaviour are
unchanged: the two scripts move byte-identical, and every strategy already committed still
validates. `strategise`'s scripts are the ones `score-bead` and `hitl-queue` import, so their import
paths and the commands in `RECOMMEND.md` and `score-bead/SKILL.md` follow the move.

This removes a skill: `prioritise-work` is no longer installed, so anyone who names it must load
`strategise` or `prioritise` instead. Nothing about the strategy file, its version or its commands
changes, so a replacement is a rename at the call site and a reload.
