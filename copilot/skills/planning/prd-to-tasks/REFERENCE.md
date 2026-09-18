# PRD to Tasks — Reference

Body templates used in the Phase 3 and Phase 4 workflow steps of `SKILL.md`.

## Epic body template

Passed as the `--description` when creating an epic bead:

```bash
bd create "<Phase Title>" --type epic --description "<epic body below>"
```

```markdown
## Source

PRD: <brief reference>

## Summary

A concise description of this phase. Scope and goal, not implementation details.

## What to build

End-to-end behaviour for this phase. What a demo would show.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- Blocked by #<epic-id> (if any) — or "None — can start immediately"
```

## Task body template

Passed as the `description` to `create-task` for each task bead:

```markdown
## Epic

#<epic-id> — <Epic Title>

## What to build

This vertical slice: end-to-end behaviour, not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- Blocked by #<task-id> (if any) — or "None — can start immediately"
```

## Aggregate classification tags

After all tasks in an epic exist, tag the epic with the aggregate classification:

```bash
bd tag <epic-id> implementation-type:hitl    # if any task is HITL
bd tag <epic-id> implementation-type:afk     # if all tasks are AFK
```