# Idea: qa-extension

## Status
Backlog idea (not implementation-ready)

## Created
2026-07-12

## Problem
When an agent needs clarification during a task (e.g. during a grilling session, resolving ambiguity, or making a recommendation), it has no structured way to ask the user a question and wait for an answer. The current workaround is unstructured prompting — the agent guesses, rambles, or proceeds with incomplete information. This makes grilling sessions less productive and wastes turns.

## Who benefits
Anyone using PI agents for interactive work — especially during planning, grilling, and design sessions where the model needs to ask a series of questions one at a time and get focused answers.

## Proposed outcome
A PI extension that registers a `qa` or `ask` tool that the LLM can call to ask the user a question. The tool:
- Presents the question (and optionally multiple-choice options or a recommendation)
- Pauses the agent and waits for the user's response
- Returns the user's answer to the model so it can continue
- Supports multi-turn Q&A sessions (series of questions)

This mirrors the built-in `ask_clarification` / `question` tools in Claude Code, GitHub Copilot Chat, and similar coding agents.

## Validity check
- Evidence we already have: The PI extension API supports custom tools with user interaction via `ctx.ui` (input, confirm, select). The `subagent` extension already demonstrates complex async tool patterns. Claude Code and Copilot both ship this — it's a proven pattern.
- Riskiest assumption: That the tool execution model in PI can support a "pause and wait for user input" flow without blocking the agent loop awkwardly.
- What would invalidate this idea: If PI adds a built-in `ask_user` tool, or if the UX of blocking the agent loop for input feels worse than the current unstructured approach.

## Constraints
- Must work in both TUI and RPC modes (graceful fallback in non-interactive modes)
- Should support at minimum: free-text input, confirm/deny, and multiple-choice selection
- Questions and answers should be visible in the session history so they survive compaction
- Must handle abort (Ctrl+C mid-question) gracefully

## Next validation step
1. **Investigate existing extensions first** — search PI's built-in tools, extension registry, and community repos for an existing `ask`/`qa`/`question` tool before building. May already be available.
2. If no existing extension: check the PI tool execution model to see if a custom tool can return a partial result and then receive follow-up input from the user. Look at how `ctx.ui.input()` and `ctx.ui.confirm()` behave inside tool execution — can they block and return, or do they need a different pattern?

## Notes
- **Needs investigation** — check for existing PI extensions/tools before building.
- Initial conversation 2026-07-12. Motivated by making grilling sessions more efficient — the grill-me skill asks one question at a time, and a structured Q&A tool would make that flow tighter.
- Related to `grill-me` skill (`skills/productivity/grill-me/SKILL.md`) — this extension could become the runtime that grill-me delegates its questioning to.
- Possible names: `/ask`, `qa`, `question` tool.
