---
"@jaybeeuu/agent-cortex": minor
---

Add the `session-clear` extension, which registers `/clear` in pi: keep the session display name,
model, thinking level, and active agent, and drop the transcript context. It captures the identity
as plain data, replaces the session with `ctx.newSession({ parentSession })` so the cleared session
stays the parent in `/tree` and `/resume`, then the replacement instance re-applies the name and
restores the model and thinking level only when they differ from the replacement's own values. It
appends a `session-clear` provenance entry, reports the clear in one line, never prompts, never
summarises, and never deletes the cleared session file. PI-only: Claude Code already ships `/clear`,
so the audit in `docs/claude-hooks.md` records no hook port.
