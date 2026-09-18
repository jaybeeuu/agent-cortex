# classify-bead reference

Detail behind `SKILL.md`. The executable `scripts/classify-bead.mjs` is the source of
truth for the deterministic tiers; this document mirrors it for verification.

## Tier precedence

| Tier | `source` | Evidence | Applies the label? |
|---|---|---|---|
| 1 | `label` | An `implementation-type:afk` or `implementation-type:hitl` label is already present | no — it is already there |
| 2 | `type-field` | The legacy `## Type` section in the bead body declares `AFK`/`HITL` (block or inline form, case-insensitive) | yes |
| 3 | `heuristic` | A conservative natural-language signal (below) | yes |
| 4 | *(none)* | Nothing deterministic matched → `escalate: true`; a small/cheap model applies the rubric | after the model decides |

When both `implementation-type` labels are present, AFK wins — matching the
pre-existing skill wording, which checks `implementation-type:afk` first.

The classifier runs `bd show <id> --json` and `bd tag <id> <label>`; it never
re-reads prose from the rendered `bd show` output.

## Heuristic signals

Heuristics only fire on explicit phrasing. They are checked in this order,
mirroring the rubric's "a human is required if any criterion is true" rule.

HITL (human required):

- `requires human`, `human sign-off|approval|judgement|decision`
- `manual step|action|intervention`
- `visually review|inspect|verify`
- `stakeholder sign-off|approval`
- `credentials|secrets setup|rotation|provisioning`
- `provisioning` within 40 characters of `infrastructure|infra|server|cluster`

AFK (explicitly no human):

- `no human action|input|review|intervention|judgement`

AFK (machine-checkable acceptance):

- `machine-checkable`
- `automated test|tests|check|checks|verification`

Anything else escalates. Widening this list trades model calls for
misclassification risk; only add phrasing that maps directly onto a rubric
criterion.

## CLI

```bash
node classify-bead.mjs <bead-id> [--dry-run]   # resolve (and tag) one bead
node classify-bead.mjs --audit [--limit <n>]   # measure the split over recent beads
```

Run from the target project's directory — `bd` resolves its beads DB from cwd.
JSON goes to stdout:

- Classification: `{ id, classification, source, reason, escalate, applied, label }`
- Audit: `{ sampled, bySource, deterministic, needsRubric, deterministicRatio }`

Exit codes: `0` success (including `escalate`, which is a valid outcome), `2`
usage error, `1` `bd` failure. `BD_PATH` overrides the `bd` executable.

## Measured split

This is the "measure first" number that sizes the win over spawning a subagent.
Reproduce it against the repo's beads DB:

```bash
node <skill-scripts>/classify-bead.mjs --audit --limit 100
```

Measured 2026-09-18 on `agent-cortex`: of the 100 most recently created beads,
80 resolved deterministically (all via an existing label) and 20 would need the
rubric. That 80% is the share of classifications that skip the model entirely
when the caller runs the classifier before spawning a subagent. The rate is
higher on backlogs that were labelled at planning time; freshly created beads
with neither a label nor a `## Type` field lean on the heuristic tier.
