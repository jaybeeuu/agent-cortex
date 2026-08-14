# Idea: Improve PI System Prompt

## Status
Backlog idea (not implementation-ready)

## Why it might be useful
PI's current system prompt is weak. Agents consistently get off track, spend excessive tokens spinning their wheels or going off on tangents, fail to check in when problems are hit, and generally behave like inexperienced code goblins. This wastes tokens, slows down task completion, and forces the user to constantly redirect the agent. A stronger system prompt would produce more focused, disciplined agents that know when to stop and ask.

## How we might do it
Build improved behavioural instructions into agent-cortex — layered on top of or replacing PI's default system prompt. Key improvements:

1. **Loop prevention / circuit-breakers** — hard limits on retry attempts (e.g. 2-attempt limit before stopping and asking), no repeated tool execution without rationale
2. **Task-focus discipline** — stronger scoping instructions, no tangential refactoring, atomic changes
3. **Check-in triggers** — explicit rules for when the agent must stop and present options to the user

A Gemini-generated execution protocol prompt exists as a possible starting point (see Notes), but will need significant customisation for agent-cortex.

## When to think about it
- Land the current work first (refactor-to-template epic, bead workflow polish, CI/CD pipeline)
- **Next priority after current work** — this is urgent-ish

## Priority
High — after current work lands. Directly impacts daily productivity and token efficiency.

## Open questions
- Layer on top of PI's default prompt, or replace it entirely?
- Should PI's current system prompt be reviewed for nonsense that can be chopped out?
- Which guardrails from the Gemini starter are genuinely useful vs redundant with existing skills (e.g. `git-workflow` already covers destructive commands, `style-code` covers scope discipline)?
- How should circuit-breakers interact with skills like `run-pipeline-stage` that already have structured workflows?

## Notes
- **Gemini starter prompt** exists (see conversation from 2026-08-05) covering loop prevention, action scope, context management, execution workflow order, and working state maintenance. Useful starting material but needs heavy customisation.
- **Incompatibility to fix**: the starter's "Working State Maintenance" section proposes `.pi/PLAN.md` files for complex tasks. This is incompatible with agent-cortex — we use **beads (bd)** for task tracking and pipeline stages, not flat markdown plan files. This section needs to be replaced with bead-aware equivalents (e.g. updating bead notes, using pipeline stage state).
- **Overlap with existing skills**: several guardrails already exist in agent-cortex skills (`git-workflow`, `style-code`, `run-pipeline-stage`). The biggest gaps are **loop prevention / circuit-breakers** and **check-in discipline** — these aren't enforced anywhere today.
