# flesh-out-idea reference

Detail behind `SKILL.md`: the queries, the round-to-round field updates, and a full promotion
transcript. Field names and section markers are the contract — see `record-idea`'s `FORMAT.md`
for the capture-side mapping this builds on.

## Queries

| Question | Command |
|---|---|
| Which ideas can be worked now? | `bd ready -l kind:idea` |
| Every idea, blocked and deferred included | `bd list -l kind:idea` |
| One idea, fields and markers | `bd show <id> --json` |
| Why is this idea blocked? | `bd show <id>` — its dependency list, with each blocker's status |

`bd ready` applies blocker-aware semantics: an idea that depends on open work is omitted, while
`bd list` still returns it. That difference is the readiness signal — there is no separate
`ready:` label to maintain.

To park an idea behind other work, express it as a dependency rather than an exclusion label:

```bash
bd dep add <idea-id> <blocker-id>    # "<idea> depends on <blocker>"
```

## Fields and verbs

| Field | Verb | Use it for |
|---|---|---|
| `--description` | `bd update <id> -d …` | Problem, who benefits, proposed outcome — rewrite when an answer supersedes the text |
| `--design` | `bd update <id> --design …` | How we might do it: mechanism, alternatives, deciding tradeoffs |
| `--notes` | `bd update <id> --append-notes …` | Validity check, constraints, next validation step, provenance — append so rounds accumulate |
| `--acceptance` | `bd update <id> --acceptance …` | Promotion criteria, restated once the interview settles what "ready" means |
| `--priority` | `bd update <id> -p <P0-P4>` | Moves as the idea gets clearer or more urgent |

Multiple `##` sections share one field; keep every marker, because that is how the next round
finds the section to update.

## Round-by-round updates

Round 1 deepens the mechanism and records what is still open:

```bash
bd update proj-idea1 \
  --design "## How we might do it

Two candidates: a pre-commit hook, or a CI gate. The hook catches the mistake earlier; the CI
gate cannot be bypassed locally. The deciding tradeoff is whether local friction is acceptable." \
  --append-notes "## Validity check

- Evidence we already have: two accidental token commits in the last six months.
- Riskiest assumption: that a hook survives the team's current tooling.
- What would invalidate this idea: a secret scanner already covering this path.

## Next validation step

Check whether the existing pre-commit config already runs a scanner." \
  -p 3
```

Round 2 corrects the design in place and appends only what changed:

```bash
bd update proj-idea1 \
  --design "## How we might do it

CI gate (chosen): pre-commit config already runs an unrelated linter and the hook is bypassed
with --no-verify, which the two incidents both used." \
  --append-notes "## Next validation step

Prototype the gate on one repository and confirm it fails on a seeded fake token."
```

## Promotion transcript

Promotion is two moves: flip the idea bead into the epic node, then create execution children
that point at it. The epic stays `execution:hitl` — a human owns the outcome even when every
child is agent-routable.

```bash
# 1. The idea bead becomes the epic node.
bd update proj-idea1 --add-label kind:epic --remove-label kind:idea -t epic

# 2. Execution children hang off it by ownership.
bd create "Add the token scanner to CI" --parent proj-idea1 \
  -l execution:afk --no-inherit-labels -t task \
  -d "Wire the scanner into the pipeline.

## Acceptance Criteria
- [ ] A seeded fake token fails the build." --validate

# 3. Ordering is a dependency, not a label.
bd create "Document the scanner baseline" --parent proj-idea1 \
  -l execution:afk --no-inherit-labels -t task \
  -d "Record the current findings so new alerts are attributable.

## Acceptance Criteria
- [ ] Baseline written and linked from the epic." --validate
bd dep add proj-idea1.2 proj-idea1.1    # the doc waits for the scanner to land
```

- `--no-inherit-labels` is required on every child: without it a child inherits `kind:epic` and
  stops reading as ordinary executable work.
- `bd update <id> --remove-label` and `--add-label` are the label verbs; `bd label add/remove`
  works too, and `bd tag <id> <label>` is the single-add shorthand.
- A promoted epic satisfies lint through `--acceptance` (or a `## Success Criteria` section); if
  the idea never got one, add it at promotion time.
- `bd close` refuses to close a bead with open children, so the epic closes after its last child
  — that ordering is the built-in completion rule, not a convention to remember.

## When a planning bead belongs in the hierarchy

If the children cannot be written down yet because the design is still unsettled, create one
planning bead as a child of the epic (`execution:hitl`) and make every implementation child depend
on it. The implementation children then surface as ready exactly when planning closes — no extra
readiness label. Use `create-task` when the children also need pipeline stage chores.
