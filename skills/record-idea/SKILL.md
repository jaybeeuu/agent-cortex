---
name: record-idea
description: Capture early-stage ideas into a structured backlog record, including a high-level validity check before implementation planning. Use when the user shares a new idea that is not ready to build yet and wants it written to the ideas backlog.
---

# Record Idea

Capture a not-ready idea into `.agent-cortex/ralph/ideas` after a short, high-level interview that pressure-tests the concept.

## Workflow

1. **Interview at high level (one question at a time)**
   - Why might it be useful? Who benefits and what improves?
   - How might we do it? Sketch the rough approach — no implementation detail.
   - When should we think about it? Are there triggers, dependencies, or timing signals?
   - What priority does this feel like relative to current work?
2. **Pressure-test briefly**
   - Challenge weak points (scope, feasibility, opportunity cost).
   - Keep discussion strategic; do not drift into implementation detail.
3. **Choose record shape**
   - **Simple idea**: `.agent-cortex/ralph/ideas/<idea-name>.md`
   - **Complex idea**: `.agent-cortex/ralph/ideas/<idea-name>/<idea-name>.md` with optional supporting docs in the same folder.
4. **Create the record file**
   - Run:
     ```bash
     bash skills/record-idea/scripts/new-idea.sh --title "<idea title>" [--complex]
     ```
5. **Write the idea record**
   - Fill the scaffold with concise content from the interview.
   - Keep it decision-oriented and easy to scan later.

## Idea Record Template

```md
# Idea: <title>

## Status
Backlog idea (not implementation-ready)

## Why it might be useful
<Who benefits and what improves?>

## How we might do it
<Rough approach — no implementation detail>

## When to think about it
<Triggers, dependencies, or timing signals that would make this timely>

## Priority
<Relative priority and reasoning>

## Notes
<Anything worth keeping for future prioritisation/review>
```

## Output

Return:

1. The file path created.
2. A 2–3 sentence summary of the recorded idea.
3. The suggested priority and when it might become timely.
