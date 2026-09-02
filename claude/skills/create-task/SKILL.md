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

2. **Check for an existing classification label.** Run `bd label list <id>`. If `implementation-type` is already present, skip step 3 — re-classifying a labelled bead wastes a subagent call.

3. **Classify the bead.** Delegate to the `classify-bead` skill as a subagent via Task — do not classify inline. It returns `AFK` or `HITL` and applies the `implementation-type` label.

4. **Branch on classification.**
   - **HITL** — stop here. Report the bead ID and classification to the caller. Do not create pipeline chores: a human drives the work, so the chore tree does not apply.
   - **AFK** — continue to step 5.

5. **Expand into pipeline stage chores.** Run the `create-chores` script, which reads this skill's `pipeline.json` and deterministically creates all stage chores plus the PR gate bead in one shot:

   ```bash
   # Run from the TARGET project's directory — bd resolves its beads DB from cwd;
   # the skill's own location or `pnpm --prefix <scripts>` would target the wrong tree.
   <skill-scripts>/node_modules/.bin/tsx \
     <skill-scripts>/create-chores.ts \
     --parent <parent-id> [--priority <priority>]
   ```

   `<skill-scripts>` is the absolute path to this skill's own `scripts/` directory, resolved from wherever this skill was loaded — it varies by harness and install location, so never hardcode one harness's path.

6. **Report.** Return the parent bead ID, the classification (`AFK`), and the created child bead IDs from the script output (including `featurePrReview`).

## Red Flags

- **Running the script from the wrong directory.** Chores land in whatever `.beads` tree `bd` resolves from cwd — the target project's root is the only safe cwd.
- **Classifying inline.** The `classify-bead` rubric is a subagent's job (with a label short-circuit); inlining yours means re-reading bead content and drifting from the rubric.
- **Expanding an HITL bead.** If classification is HITL, stop — creating a chore tree for human-driven work is wrong.
- **Hardcoding `<skill-scripts>`.** The install path differs per harness (plugin cache, installed-plugins, dev checkout); resolve it at runtime.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I know this task is AFK — I'll skip the classify-bead call" | Classification is a rubric check against the full bead body; assumptions masked by familiarity cause mislabelled work to hit the wrong queue. |
| "I'll create the chores by hand instead of running the script" | The script is the single source of truth for titles, labels, dep chains, and the PR gate. Hand-created chores drift silently. |
| "The pipeline is overkill for this small task" | If the work is worth tracking at all, the stage chore tree is what lets ralph execute and gate it. Not ready for that? Use `record-idea`. |

## Philosophy / rationale

- **The script owns the expansion contract.** Pipeline stages, titles, labels, dependency chains, and the PR gate are deterministic — a one-shot script keeps every chore identical to the contract and reproducible across runs.
- **The PR gate is a hard human checkpoint.** Every AFK task ends with a `featurePrReview` task that blocks the final document stage, so automated work never merges without a human reviewing the branch.

## Cross-skill references

- `classify-bead` — classify the new bead via subagent (step 3).

## Examples

Input: title `Add export API to invoices`, description `…`, priority `2`, parent `epic-456`. Output: the parent bead ID plus the script's JSON mapping stage IDs → chore bead IDs, with `featurePrReview` as the HITL PR gate:

```json
{"code": "abc123", "verify": "def456", "review": "ghi789", "document": "jkl012", "featurePrReview": "bd-mno345"}
```

The full bead-property contract (titles, labels, dependencies per chore and for the PR gate) is in `REFERENCE.md`.

## Verification checklist

- [ ] Parent bead exists with the correct title, description, and priority.
- [ ] `parent-child` dependency added when a parent epic was supplied.
- [ ] `implementation-type` label present on the parent bead (`bd label list <id>`).
- [ ] HITL path: no pipeline chores created, caller told the classification. AFK path: script ran from the target project's cwd and its JSON contains every stage ID plus `featurePrReview`.
- [ ] Chore titles/labels/dependencies match the contract (`[<parent-id>] <stage title>`, `stage:<id>`, `parent-child` to parent, `blocks` per `dependsOn`), verified against `REFERENCE.md`.
- [ ] PR gate task exists with `implementation-type:hitl` + `lifecycle:feature-pr` labels and blocks the final document stage chore.
- [ ] Report returned the parent bead ID, classification, and all child bead IDs.