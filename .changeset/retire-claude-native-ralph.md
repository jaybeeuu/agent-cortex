---
"@jaybeeuu/agent-cortex": minor
---

Ship the real ralph to Claude Code. `agents-native/ralph.md` is deleted along with the `DEFER` and
`buildNatives` path in `bin/installers/claude.mjs`, so every harness now composes the same ralph body
and differs only in its wake mechanism (`agents/ralph/<harness>/wake.md`). `SKILL_EXCLUDE` is gone too,
so the Claude plugin gains the `ralph` and `run-pipeline-stage` skills it previously stripped.

The native copy was authored before the chore model existed and had drifted: it ignored chore beads,
counted fix rounds in its own prose, and ran an implement → review loop with no verify or document
stage — while pi and Copilot ran the real orchestrator. Its description advertised that stale cycle.
`agents/ralph/claude/frontmatter.json` now matches the composed agent, and a test asserts the three
composed bodies are identical once frontmatter and the wake section are removed.
