# Create Task — Reference

Detail behind `skills/planning/create-task/SKILL.md`. The script (`scripts/create-chores.mjs`) is the source of truth for this contract; this document mirrors it for verification.

## Script invocation

```
node <skill-scripts>/create-chores.mjs --parent <bead-id> [--priority <0-4>]
```

- Reads `<skill>/pipeline.json`, which is mirrored by `<skill>/pipeline.formula.json` (the bd formula), and picks one of two paths per run:
  - **pour** — when a `pipeline.formula.json` exists under `.beads/formulas/` at or above the working directory *and* the parent has no stage chore yet. One `bd mol pour pipeline` creates every stage chore with its labels and stage-to-stage edges, then each step is reparented onto the parent (`bd update <step> --parent <parent>`, one call per step) and the inert molecule root is deleted (`bd delete <root> --force`). The pour record is noted on the parent bead.
  - **per-stage** — the loop: one `bd create` per missing stage chore and one `bd dep add` per missing edge. Used when the formula is absent (an older install, or a project whose installer has not run since) and when the parent already has stage chores.

  stderr states once which path ran. A pour that cannot finish is reverted and the loop runs instead, so a missing or unusable formula never fails an expansion.
- `agent-cortex install pi` / `install claude` copy the formula to `<project>/.beads/formulas/pipeline.formula.json` (the filename is the formula id) and say in their output that the copy is an untracked file. A project with no `.beads/` is reported and the install continues.
- Prints a JSON object mapping each stage ID to its chore bead ID, plus `featurePrReview` for the PR gate.
- Expands a bead that already exists — it never creates a parent.
- **Idempotent**: it reads that parent's children once (`bd children <parent-id> --json`) and adopts an existing child by its role label — `stage:<id>` for a stage chore, `lifecycle:feature-pr` for the gate — creating only what is missing. Deps that are already wired are skipped. A re-run on an expanded bead creates nothing and prints the same mapping, so re-running after a failed expansion is the recovery path. Convergence is not inherited from the pour — a second pour duplicates the whole tree silently — so a stage chore's existence is what suppresses the pour, not the parent's pour record.
- Adoption ignores bead status and reads only labels: a chore a later stage already closed is still adopted and reprinted in the mapping, which keeps a re-run convergent instead of creating a duplicate. When a role label appears twice under one parent the first-listed child wins. Adoption is scoped to that parent's children and keyed on labels, never titles, so a stray chore from another bead is never adopted.

## Stage chore beads

One per stage in `pipeline.json` (currently `code`, `verify`, `review`, `document`, `post-merge`, `housekeeping`):

- **Type**: `chore`
- **Title**: `[<parent-id>] <stage title>` (e.g. `[abc-123] Code`)
- **Description**: the stage's `description` text, carried verbatim. Expansion stores it and does nothing else with it: it never substitutes the `<ralph-scripts>` placeholder and never runs the backticked `node …` command inside it. Treat a description as text for the stage worker to read, never as something expansion acts on.
- **Labels**: `stage:<id>` (e.g. `stage:code`, `stage:verify`), plus any `labels` the stage declares — `post-merge` adds `lifecycle:post-merge`, `housekeeping` adds `lifecycle:housekeeping`
- **Dependencies**: `parent-child` to the parent bead; `blocks` between stages per each stage's `dependsOn` (the script requires `dependsOn` targets to appear earlier in `pipeline.json`)

**A stage may wait on the gate instead of a stage.** The reserved `dependsOn` target
`featurePrReview` means "blocked behind the PR gate bead". The gate is not a stage — it is created
after them — so the script wires those stages to it in a second pass, once the gate exists. Both
`post-merge` and `housekeeping` use it: each chore must not become ready until a human has merged
the PR and closed the gate, and the `blocks` edge keeps it out of `bd ready` while the feature is in
flight. The gate itself still waits on the last stage that does not wait on the gate (`document`).

## PR gate bead (`featurePrReview`)

- **Type**: `task`
- **Title**: `[<parent-id>] PR Review and Merge`
- **Labels**: `execution:hitl`, `lifecycle:feature-pr` — exactly one `execution` label. The gate declares its own labels, so the script passes `--no-inherit-labels` and it never picks up the parent's `execution:afk`. Stage chores do **not** opt out; they keep inheriting `execution:afk` from the parent.
- **Parent contract**: the parent must carry `execution:afk`. Stage chores inherit the parent's labels, so a parent labelled `execution:hitl` (or unlabelled) produces a chore tree that no executor routes. The script does not classify — it only checks that it was given a parent ID.
- **Dependencies**: `parent-child` to the parent bead; `blocks` on the final document stage chore (`document`, falling back to the last stage in `pipeline.json`).
- **Purpose**: human review of the agent PR (agent branch → feature branch) before the feature closes.

## Hierarchy

Ownership is `--parent` at create time; ordering is `bd dep add`. The full shape for a
workstream, from container down to stage chore:

| Level | Type | Execution | Created by | Ownership |
|---|---|---|---|---|
| Feature | `feature` | `execution:hitl` | `create-task` step 5 | — |
| Planning bead ("Plan: <feature title>") | `task` | `execution:hitl` | `create-task` step 6 | `--parent <feature>` |
| Impl task (one per deliverable) | `task` | `execution:afk` | `create-task` step 6 | `--parent <feature>` |
| Stage chore | `chore` | inherited `execution:afk` | `create-chores.mjs` | `--parent <impl-task>` |
| PR gate | `task` | `execution:hitl` | `create-chores.mjs` | `--parent <impl-task>`, `--no-inherit-labels` |

Stage chores come from running `create-chores.mjs` once per impl task (`--parent <impl-task>`),
never against the feature itself — its parent must carry `execution:afk`.

Every impl task depends on the planning bead (`bd dep add <impl-task> <planning-bead>`), so
`bd ready` withholds them until planning closes. Nothing aggregates a child's execution class
onto its parent: the container is human-owned because a person decides when it is done, and
each child states the class of its own work.

### Planning bead body

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

## Acceptance criteria template

`## Acceptance Criteria` is the whole spec a reviewer checks against, so write one criterion for
the behaviour the change adds and one for each boundary of the contract it touches. These are the
kinds of boundary a change can have — cover the ones this contract has, never all six by default:

| Kind | The question it answers |
|---|---|
| Floor and ceiling | What does a value at the minimum, past the maximum, or a non-integer where a count is required do? |
| Empty versus absent | Does an empty collection behave the same as a missing one? |
| Single-fire versus double-fire | What does a second event, or an action armed twice, do? |
| Ordering of two effects | Which effect happens first, and what does a partial run leave behind? |
| Failure path | What happens when the third party refuses, and what state survives? |
| Corrupt input | What does unparseable input do, and which conservative default does it fall back to? |

```markdown
## Acceptance Criteria

- [ ] `transferCredits` moves the amount between the two accounts and returns both new balances.
- [ ] A transfer of `0`, or one above the source balance, is refused and both balances stay unchanged.
- [ ] An empty transfer list is a no-op; a missing transfer list is an error.
- [ ] A transfer the ledger rejects leaves both balances unchanged and reports the ledger's reason.
- [ ] A transfer record with an unparseable amount is refused, so a corrupt input never moves funds.
```

The first row is the function criterion; the rest are boundaries — a ceiling, empty versus absent,
the failure path, and a corrupt input. A contract with a single path needs a single criterion:
`tdd` already states that you cannot test everything, so a table of six pasted into every bead is
a defect, not thoroughness.

## Current pipeline stages

| id | title | dependsOn |
|---|---|---|
| code | Code | — |
| verify | Verify | code |
| review | Review | verify |
| document | Document | review |
| post-merge | Post-merge check | `featurePrReview` — the PR gate bead, not a stage |
| housekeeping | Housekeeping | `featurePrReview` — the PR gate bead, not a stage |

`maxFixRounds: 4` — the maximum fix-retry rounds allowed for a stage's verify loop before the PR gate. Adjust stages only in `pipeline.json`; the script and templates follow it.

`post-merge` and `housekeeping` both wait on the gate and on nothing else: they become ready
together when a human closes it. Neither waits on the other. Chaining housekeeping behind
`post-merge` was rejected because a post-merge check that stays open — an inconclusive run nobody
resolves — would then strand the worktree reclamation housekeeping exists to do. Putting
`post-merge` after `housekeeping` was rejected too: it would make the pruner a dependency of a
check that reads GitHub state, which no worktree removal can affect.

## Stage templates

`templates/` holds one prompt skeleton per stage; a dispatcher fills one to compose that stage's
chore prompt. The REPORT contract is not defined here —
`skills/workflow/run-pipeline-stage/prompts/stage-runner.md` owns it and every template mirrors it.
Drift between the two fails silently: a worker that follows a drifted template emits a well-formed
block with keys no one reads, so routing stops at that stage. Drift has already broken routing
twice. Compare a template with the authority whenever either changes. The intended guard is a lint
parity check beside `scripts/check-skill-frontmatter.mjs`, not a test — a test here would assert on
file text, which is a content inventory, and `style-tests` bans that shape.
