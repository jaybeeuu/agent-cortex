# Idea Record Format

`scripts/new-idea.sh` generates this scaffold into `docs/ideas/<slug>.md` (or `docs/ideas/<slug>/<slug>.md` with `--complex`). Fill every section — a record with unfilled sections has not been captured.

## Scaffold

```md
# Idea: <title>

## Status
Backlog idea (not implementation-ready)

## Created
<YYYY-MM-DD>

## Problem
<What problem does this idea address?>

## Who benefits
<Who benefits and what improves for them?>

## Proposed outcome
<What the idea would deliver, at a capability level — not implementation detail>

## Validity check
- Evidence we already have: <what supports this idea>
- Riskiest assumption: <the assumption most likely to be wrong>
- What would invalidate this idea: <the signal that kills it>

## Constraints
<Hard limits: tech, process, scope, resourcing>

## Next validation step
<The cheapest next thing that would firm up or kill the idea>

## Notes
<Anything worth keeping for future prioritisation or review>
```

## Guidance per section

- Keep the record decision-oriented and scannable — it will be read during future prioritisation.
- `Validity check` is mandatory: evidence grounds the idea, the riskiest assumption marks where it is weakest, and the invalidation signal tells you when to drop it.
- `Next validation step` should be concrete enough to act on without re-deriving the context.