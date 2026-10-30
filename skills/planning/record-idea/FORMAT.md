# Idea Bead Format

An idea record is a `bd` bead, not a file. `bd create` takes the whole record in one call; this
document maps the interview onto the bead's fields and lists the content each section needs.

## Record shape

```bash
bd create "Idea: <title>" \
  -l kind:idea,execution:hitl \
  -p <P0-P4> \
  -d "<description>" \
  --design "<design>" \
  --notes "<notes>" \
  --acceptance "<promotion criteria>" \
  --validate --silent
```

- `kind:idea` marks an unscoped idea; `execution:hitl` keeps it out of agent-workable queries.
  Ideas stay `open` — hiding them from automation is done by label exclusion, not status.
- `-p` is the interview's priority. P4 (backlog) is the idea default; raise it when the user puts
  the idea ahead of current work.
- `--acceptance` carries the promotion criteria. A `task` bead requires acceptance criteria, so
  this is what keeps `bd lint` clean for ideas.
- `--validate` rejects the create when a required section is missing; `--silent` prints only the
  new bead ID so the caller can report it.

## Field mapping

Keep the `##` markers inside each field. `flesh-out-idea` locates sections by marker, so a
marker is the contract between capture and deepening.

| Idea section | Bead field |
|---|---|
| Title | `--title` / positional argument, written as `Idea: <title>` |
| `## Problem`, `## Who benefits`, `## Proposed outcome` | `-d` / `--description` |
| `## How we might do it` | `--design` |
| `## Validity check`, `## Constraints`, `## Next validation step`, `## Design so far / provenance`, `## Notes` | `--notes` |
| Promotion criteria | `--acceptance` |
| Priority | `-p` |
| Anything referential (links, prior art, related beads) | `--context` |

`--description`, `--design`, and `--notes` each hold multiple `##` sections with the markers
preserved:

```text
--description
## Problem
<what problem does this idea address?>

## Who benefits
<who benefits and what improves for them?>

## Proposed outcome
<what the idea would deliver, at a capability level — not implementation detail>

--design
## How we might do it
<the rough mechanism: skill, extension, agent, script, convention, …>

--notes
## Validity check
- Evidence we already have: <what supports this idea>
- Riskiest assumption: <the assumption most likely to be wrong>
- What would invalidate this idea: <the signal that kills it>

## Constraints
<hard limits: tech, process, scope, resourcing>

## Next validation step
<the cheapest next thing that would firm up or kill the idea>

## Design so far / provenance
<where the idea came from, partial designs, options already ruled out, links to the discussion>

## Notes
<anything worth keeping for future prioritisation or review>
```

Status and creation date are not fields — `bd` tracks status, assignee, and timestamps natively,
so recording them again duplicates state that drifts.

## Guidance per section

- Keep the record decision-oriented and scannable — it will be read during future prioritisation.
- `Validity check` is mandatory in spirit: evidence grounds the idea, the riskiest assumption
  marks where it is weakest, and the invalidation signal tells you when to drop it.
- `Next validation step` should be concrete enough to act on without re-deriving the context.
- `Design so far / provenance` is where the implementation questions land: the rough mechanism,
  constraints already spotted, and existing design thoughts or discarded options. When an answer
  is unknown, record "not considered yet" — the marker stays so the deepening pass can fill it.
- Promotion criteria in `--acceptance` name what would move the idea out of the backlog: a
  decision, a prototype result, or a dependency landing. Without it, "ready" is a feeling.
