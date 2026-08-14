# Idea: PI Task Memory Skill

## Status
Backlog idea (not implementation-ready)

## Why it might be useful
PI has no built-in task memory. Agents lose context between sessions — they can't track what a task has done, what decisions were made, or where they left off. A skill that persists task-scoped knowledge in structured markdown would let agents pick up work without re-discovering context from scratch, and give humans a readable audit trail they can review or promote into real documentation.

## How we might do it
**Possibly build on top of `bd remember`** rather than creating a separate storage system. Worth exploring whether `bd remember`'s existing infrastructure (persistence, cross-session survival, auto-injection) could be extended with task-scoping and structure, vs building something standalone.
- **Task-linked** — memories keyed to specific bead/task IDs so they can be retrieved in context
- **Progressively discoverable** — the agent recalls relevant memories as it picks up work, not all at once
- **Structured** — consistent format that's easy to scan, edit, or promote
- **Promotable** — easy to elevate a memory into real repo documentation (e.g. `docs/`, `AGENTS.md`) once it's proven stable

If `bd remember` turns out to be the right foundation, the skill would add **task-scoping discipline, structure, and a promotion workflow** on top. But that's to be determined.

## When to think about it
- After the current skill set stabilises (refactor-to-template work, bead workflow, CI/CD pipeline)
- Not blocked by anything, but benefits from a stable foundation

## Priority
Low / backlog — useful but not urgent. Current memory surfaces (bd remember, context-mode) cover some of the gap already.

## Open questions
- What triggers writing a memory? (Agent decides? Skill hook on task close? Specific prompts?)
- What does "progressively discoverable" mean in practice — agent reads task memories at session start, or on-demand when picking up a task?
- What does "elevate into docs" look like — export memory to markdown file, or just reference the memory in docs?
- How to structure memory keys for task-scoping? (e.g. `task-<bead-id>-<topic>`, or a naming convention?)

## Notes
- **What bd remember already provides**: persistent cross-session memories, auto-injection at `bd prime`, searchable via `bd memories <keyword>`, stored in Dolt database.
- **Worth exploring**: could this skill layer task-scoping discipline (memories keyed to bead IDs), structured format, progressive discovery (not all memories at once), and a promotion workflow on top of `bd remember`? Or does it need its own system?
- Could be a **PI extension** (event hooks) rather than a skill (invoked on-demand) if memories should be written automatically during task work.
