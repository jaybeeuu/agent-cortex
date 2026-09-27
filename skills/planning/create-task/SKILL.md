---
name: create-task
description: Create a task bead, classify it as AFK or HITL, and if AFK expand it into pipeline stage chores plus a HITL PR gate. Use when starting tracked work with implementation and review gates — "create a task for this", "track this end-to-end", or "get this into the ralph pipeline".
---

# Create Task

Turn a piece of work into a tracked bead, classify it for autonomous (AFK) or human-in-the-loop (HITL) execution, and — when AFK — expand it into the standard pipeline: one chore bead per stage plus a HITL PR gate task so a human always reviews the finished branch. Parameters: `title` (required), `description` (required), `priority` (0–3, default 2), `parent` (epic bead ID, optional — sets a `parent-child` dependency).

## When to use

- Starting new tracked work that must move through implementation, verification, and review gates — user phrases like "create a task for this", "track this work end-to-end", or "get this into the ralph pipeline".
- A caller (`prd-to-tasks`, `ralph-plan`) needs one task bead with the full child-chore structure.

## When NOT to use

- Work that is only a raw idea, not ready to build — use `record-idea`.
- A feature that needs specification first — use `write-a-prd`, or `prd-to-tasks` to break an approved PRD into epics and tasks (`prd-to-tasks` calls this skill per task itself).
- A ticket for an external issue tracker aimed at human engineers — use `write-a-ticket`.
- A refactor that needs an incremental migration plan — use `request-refactor-plan`.

## Workflow

1. **Create the parent bead.**

   ```bash
   bd create "<title>" --description "<description>" --priority <priority>
   ```

   If a `parent` epic was provided, record the dependency:

   ```bash
   bd dep add <new-id> <parent> --type parent-child
   ```

2. **Classify deterministically.** Run the `classify-bead` classifier — it resolves an existing label, the legacy `## Type` field, and explicit heuristic signals without a model call, and applies the label itself when it resolves:

   ```bash
   # Run from the TARGET project's directory — bd resolves its beads DB from cwd.
   node <skill-scripts>/../../classify-bead/scripts/classify-bead.mjs <new-id>
   ```

   - `"classification": "afk" | "hitl"` → the label is applied; branch on that class in step 3.
   - `"escalate": true` → delegate to the `classify-bead` skill as a subagent via {{TOOL:task}}; it applies the rubric and tags the bead.

   `<skill-scripts>` is the absolute path to this skill's own `scripts/` directory, resolved from wherever this skill was loaded. Sibling skills sit alongside this skill's directory in every harness, so `../../classify-bead/scripts/` resolves to the classifier.

3. **Branch on classification.**
   - **HITL** — stop here. Report the bead ID and classification to the caller. Do not create pipeline chores: a human drives the work, so the chore tree does not apply.
   - **AFK** — continue to step 4.

4. **Expand into pipeline stage chores.** Run the `create-chores` script, which reads this skill's `pipeline.json` and deterministically creates all stage chores plus the PR gate bead in one shot:

   ```bash
   # Run from the TARGET project's directory — bd resolves its beads DB from cwd;
   # the skill's own location or `pnpm --prefix <scripts>` would target the wrong tree.
   <skill-scripts>/node_modules/.bin/tsx \
     <skill-scripts>/create-chores.ts \
     --parent <parent-id> [--priority <priority>]
   ```

   `<skill-scripts>` is the absolute path to this skill's own `scripts/` directory, resolved from wherever this skill was loaded — it varies by harness and install location, so never hardcode one harness's path.

5. **Report.** Return the parent bead ID, the classification (`AFK`), and the created child bead IDs from the script output (including `featurePrReview`).

## Red Flags

- **Running the script from the wrong directory.** Chores land in whatever `.beads` tree `bd` resolves from cwd — the target project's root is the only safe cwd.
- **Spawning the `classify-bead` subagent when the classifier already resolved the bead.** The deterministic script is the short-circuit; a subagent is only for `escalate: true`.
- **Skipping the classifier and classifying by hand.** The rubric is a subagent's job; a hand-rolled guess drifts from it.
- **Expanding an HITL bead.** If classification is HITL, stop — creating a chore tree for human-driven work is wrong.
- **Hardcoding `<skill-scripts>`.** The install path differs per harness (plugin cache, installed-plugins, dev checkout); resolve it at runtime.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I know this task is AFK — I'll skip the classifier" | The classifier resolves the label, `## Type`, and explicit signals in one command; skipping it leaves the bead unlabelled or forces a needless subagent. |
| "I'll create the chores by hand instead of running the script" | The script is the single source of truth for titles, labels, dep chains, and the PR gate. Hand-created chores drift silently. |
| "The pipeline is overkill for this small task" | If the work is worth tracking at all, the stage chore tree is what lets ralph execute and gate it. Not ready for that? Use `record-idea`. |

## Philosophy / rationale

- **The script owns the expansion contract.** Pipeline stages, titles, labels, dependency chains, and the PR gate are deterministic — a one-shot script keeps every chore identical to the contract and reproducible across runs.
- **The PR gate is a hard human checkpoint.** Every AFK task ends with a `featurePrReview` task that blocks the final document stage, so automated work never merges without a human reviewing the branch.

## Cross-skill references

- `classify-bead` — deterministic classifier first, rubric subagent only on escalation (step 2).

## Examples

Input: title `Add export API to invoices`, description `…`, priority `2`, parent `epic-456`. Output: the parent bead ID plus the script's JSON mapping stage IDs → chore bead IDs, with `featurePrReview` as the HITL PR gate:

```json
{"code": "abc123", "verify": "def456", "review": "ghi789", "document": "jkl012", "featurePrReview": "bd-mno345"}
```

The full bead-property contract (titles, labels, dependencies per chore and for the PR gate) is in `REFERENCE.md`.

## Verification checklist

- [ ] Parent bead exists with the correct title, description, and priority.
- [ ] `parent-child` dependency added when a parent epic was supplied.
- [ ] `implementation-type` label present on the parent bead (`bd label list <id>`) — resolved by the classifier or, on escalation, the rubric subagent.
- [ ] HITL path: no pipeline chores created, caller told the classification. AFK path: script ran from the target project's cwd and its JSON contains every stage ID plus `featurePrReview`.
- [ ] Chore titles/labels/dependencies match the contract (`[<parent-id>] <stage title>`, `stage:<id>`, `parent-child` to parent, `blocks` per `dependsOn`), verified against `REFERENCE.md`.
- [ ] PR gate task exists and blocks the final document stage chore, carrying **exactly one** `implementation-type` label — `implementation-type:hitl` (never an inherited `implementation-type:afk` alongside it) — plus `lifecycle:feature-pr`.
- [ ] Report returned the parent bead ID, classification, and all child bead IDs.