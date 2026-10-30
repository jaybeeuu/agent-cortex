# PRD to Tasks — Reference

Body templates used in the Phase 3 and Phase 4 workflow steps of `SKILL.md`.

## Epic body template

Passed as the `--description` when creating an epic bead:

```bash
bd create "<Phase Title>" --type epic --description "<epic body below>" --validate
```

```markdown
## Source

PRD: <brief reference>

## Summary

A concise description of this phase. Scope and goal, not implementation details.

## What to build

End-to-end behaviour for this phase. What a demo would show.

## Success Criteria

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

## Feature → planning → impl sequence

When a slice is several deliverables, it gets a planning bead in front of them. Ownership is
`--parent` at create time; ordering is `bd dep add`:

```bash
# The slice, as a container.
bd create "<Slice Title>" --type feature -l execution:hitl --description "<slice body>" --validate

# The planning bead: human-owned, owned by the feature, blocking every impl child.
bd create "Plan: <Slice Title>" --type task -l execution:hitl --parent <feature-id> \
  --no-inherit-labels --description "<planning body>" --validate

# One impl child per deliverable. Owned by the feature (not by the planning bead),
# labelled for the work it does.
bd create "<Deliverable title>" --type task -l execution:afk --parent <feature-id> \
  --no-inherit-labels --description "<task body above>" --validate

# Readiness gate: impl stays out of `bd ready` until the planning bead closes.
bd dep add <impl-task-id> <planning-bead-id>
```

`--no-inherit-labels` is required on both children: `bd` copies a parent's labels at create
time, so a child of a `execution:hitl` feature would silently acquire `execution:hitl`.

### Planning bead body template

Cold-start ready — another person picks it up with no chat history:

```markdown
## What and why

The deliverable this feature produces and the problem it solves.

## Decisions already made

- Decision — rationale

## Open questions / risks

- Question — who answers it

## References

- Bead IDs, files, docs consulted

## Acceptance Criteria

- [ ] The user confirms planning is sufficient for this feature.
```

## No aggregate classification

Do not tag a container with its children's execution class. A human owns an epic or feature, so
it is `execution:hitl`; each impl task states `execution:afk` or `execution:hitl` for its own
work. Aggregating upward labels a human-owned container as agent work and gives a single bead two
answers to "who does this?".