---
"@jaybeeuu/agent-cortex": minor
---

guppi's `## Context lifecycle` now follows the boundary decision instead of ignoring it. A **stay**
compacts the window and keeps its recent tail, so the next item on the theme continues from what the
last one established without the raw turns that produced it. A **switch** flushes it, carrying
nothing into the replacement session, because a summary of the theme just left is the noise the flush
exists to remove. An **interrupt** still rewinds, and `## Interrupts` owns that protocol, so the
lifecycle cross-references it rather than restating it. A boundary now offers two outcomes — **stay**
or **switch** — and the decision is about the next **theme**, so taking a theme's second item because
its first is blocked is an ordinary stay.

Two mixed-kind token rows replace `clear_window`: `compact_window` (Claude Code's `/compact`, and the
new `request_compact` tool on pi) and `flush_window` (Claude Code's `/clear`, and the new
`request_flush` tool on pi). The new `session-transition` extension supplies both pi tools. Each
takes a one-line reason, arms a single-use request and ends the turn, and an `agent_settled` handler
performs the transition: `ctx.compact()` for a stay, and a command-dispatched `ctx.newSession()` for
a switch, because a session replacement is reachable from a command context only. No armed request
is persisted, and one arming is acted on once.

A flush carries no handoff: the replacement session is seeded with nothing, and its own session start
re-establishes the rubric and the queue. The flush's mandatory ask therefore loses its `bd remember`
theme memory, which was a handoff by another name; the trail write remains, and it is the whole
record.
