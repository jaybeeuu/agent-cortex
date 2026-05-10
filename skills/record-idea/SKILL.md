---
name: record-idea
description: Capture early-stage ideas into a structured backlog record, including a high-level validity check before implementation planning. Use when the user shares a new idea that is not ready to build yet and wants it written to the ideas backlog.
---

# Record Idea

Capture a not-ready idea into `.working-docs/ideas` after a short, high-level interview that pressure-tests the concept.

## Workflow

1. **Interview at high level (one question at a time)**
   - Clarify: problem, target user, expected value, key constraints, and why now.
   - Clarify: assumptions, key risks, and what would prove/disprove the idea.
2. **Pressure-test validity**
   - Challenge weak points (scope, feasibility, dependency, opportunity cost).
   - Keep discussion strategic; do not drift into implementation detail.
3. **Choose record shape**
   - **Simple idea**: `.working-docs/ideas/<idea-name>.md`
   - **Complex idea**: `.working-docs/ideas/<idea-name>/<idea-name>.md` with optional supporting docs in the same folder.
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

## Problem
<What problem exists today?>

## Who benefits
<Primary user/persona and context>

## Proposed outcome
<What improvement should exist if this works?>

## Validity check
- Evidence we already have:
- Riskiest assumption:
- What would invalidate this idea:

## Constraints
<Hard constraints, dependencies, and limits>

## Next validation step
<Smallest test or research step to learn quickly>

## Notes
<Anything worth keeping for future prioritisation/review>
```

## Output

Return:

1. The file path created.
2. A 2–3 sentence summary of the recorded idea.
3. The single riskiest assumption to revisit during prioritisation.
