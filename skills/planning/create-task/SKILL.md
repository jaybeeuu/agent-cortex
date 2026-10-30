---
name: create-task
description: Create a task or feature bead, classify each child as AFK or HITL, and expand AFK beads into pipeline stage chores plus a HITL PR gate. Use when starting tracked work with implementation and review gates — "create a task for this", "track this end-to-end", or "get this into the ralph pipeline".
---

# Create Task

Turn a piece of work into a tracked bead, classify it for autonomous (AFK) or human-in-the-loop (HITL) execution, and — when AFK — expand it into the standard pipeline: one chore bead per stage plus a HITL PR gate task so a human always reviews the finished branch. Parameters: `title` (required), `description` (required), `priority` (0–3, default 2), `parent` (feature or epic bead ID, optional — sets ownership at create time). The description must carry the task's required section — `## Acceptance Criteria` — which `--validate` enforces; fill it from agreed answers, not assumptions (see `bd-tool` → Required sections).

## When to use

- Starting new tracked work that must move through implementation, verification, and review gates — user phrases like "create a task for this", "track this work end-to-end", or "get this into the ralph pipeline".
- Expanding an **existing** AFK task bead that has no `stage:*` chore children — run step 7 only (see _Expanding an existing bead_).
- A caller (`prd-to-tasks`, `ralph-plan`) needs one task bead with the full child-chore structure.
- A workstream of several deliverables needs a planning bead in front of them — the feature path in steps 5–6, then step 7 for each AFK impl child.

## When NOT to use

- Work that is only a raw idea, not ready to build — use `record-idea`.
- A feature that needs specification first — use `write-a-prd`, or `prd-to-tasks` to break an approved PRD into epics and tasks (`prd-to-tasks` calls this skill per task itself).
- A ticket for an external issue tracker aimed at human engineers — use `write-a-ticket`.
- A refactor that needs an incremental migration plan — use `request-refactor-plan`.

## Workflow

1. **Pick the shape.** One deliverable an agent can finish in a session → a **task** bead (steps 2–4). A workstream of several deliverables that needs design settled before code → a **feature** bead carrying a planning bead and one impl task per deliverable (steps 5–6, then step 7 for each AFK impl child).

   **Ownership is `--parent`; ordering is `bd dep add`.** `--parent` records who owns a bead at create time; a dependency records what must finish first. Never express one as the other.

2. **Create the task bead.** The description must contain the task's required section —
   `## Acceptance Criteria` — or `--validate` rejects creation. Fill it from agreed answers, not
   assumptions (see `bd-tool` → Required sections).

   ```bash
   bd create "<title>" --type task --description "<description>" --priority <priority> \
     [--parent <feature-id> --no-inherit-labels] --validate
   bd lint <new-id>
   ```

   Pass `--parent` when a container bead was supplied, and `--no-inherit-labels` with it: `bd` copies a parent's labels at create time, so a child of an `execution:hitl` feature would acquire `execution:hitl` beside the classifier's `execution:afk` — an unroutable bead. No `parent-child` dependency is needed; `--parent` already recorded ownership.

3. **Classify deterministically.** Run the `classify-bead` classifier — it resolves an existing label, the legacy `## Type` field, and explicit heuristic signals without a model call, and applies the label itself when it resolves:

   ```bash
   # Run from the TARGET project's directory — bd resolves its beads DB from cwd.
   node <skill-scripts>/../../classify-bead/scripts/classify-bead.mjs <new-id>
   ```

   - `"classification": "afk" | "hitl"` → the label is applied; branch on that class in step 4.
   - `"escalate": true` → delegate to the `classify-bead` skill as a subagent via {{TOOL:task}}; it applies the rubric and tags the bead.

   `<skill-scripts>` is the absolute path to this skill's own `scripts/` directory, resolved from wherever this skill was loaded. Sibling skills sit alongside this skill's directory in every harness, so `../../classify-bead/scripts/` resolves to the classifier.

4. **Branch on classification.**
   - **HITL** — stop here. Report the bead ID and classification to the caller. Do not create pipeline chores: a human drives the work, so the chore tree does not apply.
   - **AFK** — continue to step 7.

5. **Feature path: create the container.** A feature is a container a person owns, so it is `execution:hitl`; its children state the class of their own work, so nothing aggregates upward.

   ```bash
   bd create "<Feature title>" --type feature --priority <priority> \
     -l execution:hitl --description "<feature body>" --validate
   ```

6. **Feature path: planning bead, then impl children.** The planning bead is the design gate; each impl child delivers one slice and waits for it.

   ```bash
   # Design gate: human-owned, owned by the feature, blocking every impl child.
   bd create "Plan: <Feature title>" --type task --priority <priority> \
     -l execution:hitl --parent <feature-id> --no-inherit-labels \
     --description "<cold-start plan>" --validate

   # One impl child per deliverable: owned by the feature, labelled for its own work.
   bd create "<Deliverable title>" --type task --priority <priority> \
     -l execution:afk --parent <feature-id> --no-inherit-labels \
     --description "<deliverable body>" --validate

   # Readiness gate: the child leaves `bd ready` until planning closes.
   bd dep add <impl-task-id> <planning-bead-id>
   ```

   The planning bead is cold-start ready — what and why, decisions already made, open questions and risks, references — and needs `## Acceptance Criteria`, which `--validate` requires for type `task` (template in `REFERENCE.md` → Hierarchy). A deliverable that genuinely needs a human — visual sign-off, credentials, hardware — is created `-l execution:hitl` and stops there.

7. **Expand into pipeline stage chores.** Run the `create-chores` script, which reads this skill's `pipeline.json` and deterministically creates all stage chores plus the PR gate bead in one shot:

   ```bash
   # Run from the TARGET project's directory — bd resolves its beads DB from cwd;
   # the skill's own location or `pnpm --prefix <scripts>` would target the wrong tree.
   node <skill-scripts>/create-chores.mjs \
     --parent <parent-id> [--priority <priority>]
   ```

   `<skill-scripts>` is the absolute path to this skill's own `scripts/` directory, resolved from wherever this skill was loaded — it varies by harness and install location, so never hardcode one harness's path.

   On the feature path, run it **once per AFK impl child**, with `--parent <impl-task-id>` — never the feature ID: stage chores inherit their parent's labels, the script checks only that it was handed a parent ID (`REFERENCE.md` → PR gate bead), so an `execution:hitl` feature parent yields a chore tree no executor routes. A deliverable created `execution:hitl` in step 6 is not expanded.

8. **Report.** Return the bead ID (or, on the feature path, the feature ID plus every planning and impl child ID), the classification of each expanded bead (`AFK`), and the created stage chore IDs from the script output (including `featurePrReview`) — one mapping per expanded impl child on the feature path.

### Expanding an existing bead

Steps 2–6 create beads; step 7 expands one. A bead that already exists but has no `stage:*` chore children — an AFK task filed before the pipeline existed, or one ralph found chore-less — is a supported entry point: run step 7's `create-chores.mjs --parent <existing-id> --priority <its-own-priority>` directly, then report the mapping. No create steps, no new description, no re-classification.

**Never re-run `create-task` for an existing bead.** It creates a bead first and expands second, so the run leaves a **second parent** beside the original, which stays chore-less — the duplicate ralph's expansion guard exists to prevent. `create-chores.mjs` expands a bead that already exists; only step 2 creates a bead.

## Red Flags

- **Filling acceptance criteria with assumptions.** Fabricated criteria pass `--validate` but mislead the pipeline. The description is the interview's output — confirm it with the human instead.
- **Running the script from the wrong directory.** Chores land in whatever `.beads` tree `bd` resolves from cwd — the target project's root is the only safe cwd.
- **Spawning the `classify-bead` subagent when the classifier already resolved the bead.** The deterministic script is the short-circuit; a subagent is only for `escalate: true`.
- **Skipping the classifier and classifying by hand.** The rubric is a subagent's job; a hand-rolled guess drifts from it.
- **Expanding an HITL bead.** If classification is HITL, stop — creating a chore tree for human-driven work is wrong.
- **Expanding an existing bead by re-running `create-task`.** That step creates a bead, so the original stays chore-less and gains a second parent beside it. Run `create-chores.mjs --parent <existing-id>` instead.
- **Hardcoding `<skill-scripts>`.** The install path differs per harness (plugin cache, installed-plugins, dev checkout); resolve it at runtime.
- **Creating a feature with no planning bead.** A feature that goes straight to impl children is a feature nobody designed. The planning bead keeps the children blocked until the design is confirmed.
- **Expressing ownership as a dependency.** `bd dep add <child> <parent>` mixes hierarchy into the readiness gate; pass `--parent` at create time instead.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I know this task is AFK — I'll skip the classifier" | The classifier resolves the label, `## Type`, and explicit signals in one command; skipping it leaves the bead unlabelled or forces a needless subagent. |
| "I'll create the chores by hand instead of running the script" | The script is the single source of truth for titles, labels, dep chains, and the PR gate. Hand-created chores drift silently. |
| "The pipeline is overkill for this small task" | If the work is worth tracking at all, the stage chore tree is what lets ralph execute and gate it. Not ready for that? Use `record-idea`. |

## Philosophy / rationale

- **The script owns the expansion contract.** Pipeline stages, titles, labels, dependency chains, and the PR gate are deterministic — a one-shot script keeps every chore identical to the contract and reproducible across runs.
- **The PR gate is a hard human checkpoint.** Every AFK task ends with a `featurePrReview` task that blocks the final document stage, so automated work never merges without a human reviewing the branch.
- **Each bead states its own execution class.** Containers are human-owned; the work inside them is AFK unless a deliverable genuinely needs a person. Nothing aggregates upward, so a label always answers "who does this?" for that bead.

## Cross-skill references

- `classify-bead` — deterministic classifier first, rubric subagent only on escalation (step 3).
- `prd-to-tasks` — decomposes a PRD and calls this skill per slice; a slice that needs design gets the feature path.

## Examples

Input: title `Add export API to invoices`, description `…`, priority `2`, parent `feature-456`. Output: the bead ID plus the script's JSON mapping stage IDs → chore bead IDs, with `featurePrReview` as the HITL PR gate:

```json
{"code": "abc123", "verify": "def456", "review": "ghi789", "document": "jkl012", "featurePrReview": "bd-mno345"}
```

Feature path input: "several endpoints, a UI, and a migration". Output: `feature-456` (`execution:hitl`), `plan-457` ("Plan: …", `execution:hitl`, owned by the feature, blocking every child), and one `execution:afk` impl child per deliverable, each expanded into its own stage chores plus PR gate.

The full bead-property contract (titles, labels, dependencies per chore and for the PR gate) is in `REFERENCE.md`.

## Verification checklist

- [ ] Bead created with `--validate`, and `bd lint <id>` reports no missing sections.
- [ ] `--parent` used for ownership when a container was supplied, with `--no-inherit-labels` beside it.
- [ ] `execution:afk` or `execution:hitl` label present on the bead (`bd label list <id>`) — resolved by the classifier or, on escalation, the rubric subagent.
- [ ] HITL path: no pipeline chores created, caller told the classification. AFK path: script ran from the target project's cwd and its JSON contains every stage ID plus `featurePrReview`.
- [ ] Feature path: the feature is `execution:hitl`, exactly one planning bead is owned by it and carries the cold-start contract, and every impl child is `execution:afk` and depends on the planning bead.
- [ ] Chore titles/labels/dependencies match the contract (`[<parent-id>] <stage title>`, `stage:<id>`, `parent-child` to parent, `blocks` per `dependsOn`), verified against `REFERENCE.md`.
- [ ] PR gate task exists and blocks the final document stage chore, carrying **exactly one** `execution` label — `execution:hitl` (never an inherited `execution:afk` alongside it) — plus `lifecycle:feature-pr`.
- [ ] Report returned the bead ID, classification, and all child bead IDs.
- [ ] Expansion-only run (existing bead): the create steps skipped, `create-chores.mjs` expanded that bead, and the tree still holds exactly one parent.