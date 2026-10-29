---
"@jaybeeuu/agent-cortex": minor
---

Add the `output-style` pi extension: it appends an always-on reply-shape block to the PI
system prompt — lead with the action, write in Simplified Technical English (ASD-STE100),
and restate context instead of citing beads, phases, or stages by ID alone.

The block lives in `extensions/output-style/output-style.md` and is also written to the managed
section of `~/.claude/CLAUDE.md` by `agent-cortex install claude`, so Claude Code receives the
same rules alongside pi.
