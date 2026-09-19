---
name: classify-bead
description: Classify a bead as AFK or HITL and apply the implementation-type label. Use when a bead is missing its implementation-type label, when picking up a bead to work on, or when any skill creates a new bead.
---

# Classify Bead

Determine whether a bead requires human action (HITL) or can be completed autonomously by an agent (AFK), then persist the result as an `implementation-type` label. A deterministic classifier settles the common cases; only genuine rubric judgement reaches a model.

## When to use

- A bead is missing its `implementation-type` label and you are about to pick it up.
- A skill has just created a new bead and needs it classified before claiming or scheduling.
- You are unsure of a bead's classification and want to resolve it deterministically.

## When NOT to use

- The bead already carries an `implementation-type` label — check `bd label list <id>` before invoking, and never re-classify a labelled bead.
- You are creating a new task — `create-task` classifies internally; do not spawn this skill separately.
- The work item is not a bead (e.g. a Jira ticket or plain code task) — use `write-a-ticket` or start the work directly.

## Invocation

Run the deterministic classifier first. It resolves the existing label, the legacy `## Type` field, and explicit heuristic signals without a model call:

```bash
# Run from the TARGET project's directory — bd resolves its beads DB from cwd.
node <skill-scripts>/classify-bead.mjs <bead-id>
```

- Output carries `"classification": "afk" | "hitl"` → done. The classifier applied the label; report the classification. Do not spawn a subagent.
- Output carries `"escalate": true` → no deterministic signal. Spawn this skill as a background subagent via {{TOOL:task}} (a small, cheap model) with the bead ID and the `bd prime` output; the subagent applies the rubric below and tags the bead.
- `--dry-run` resolves without applying the label. `--audit [--limit <n>]` reports the deterministic-vs-rubric split over recent beads.

`<skill-scripts>` is the absolute path to this skill's own `scripts/` directory, resolved from wherever this skill was loaded — it varies by harness and install location, so never hardcode one harness's path. Only run inline when no task-spawning capability exists in the current environment.

**Callers should run the classifier themselves before spawning this subagent.** If `implementation-type` is already present, or the classifier resolves the bead, there is no subagent call to make.

## Workflow

1. **Check for an existing label.** `bd label list <id>` — `implementation-type:afk` present → **AFK**; `implementation-type:hitl` present → **HITL**. Stop.

2. **Run the deterministic classifier.** `node <skill-scripts>/classify-bead.mjs <id>`. A resolved classification is already tagged; stop and report it.

3. **Apply the rubric** — only when the classifier reports `escalate: true`. Read the full bead body:

   **HITL** — a human is required if at least one of the following holds:
   - The outcome cannot be verified by an agent (e.g. visual review, stakeholder sign-off, UX judgement call).
   - A manual action only a human can perform is required (e.g. credential setup, secrets management, external service configuration, infrastructure provisioning outside the codebase).
   - A decision must be made that the agent cannot make unilaterally (e.g. architectural choice between equally valid options, regulatory or legal sign-off).

   **AFK** — otherwise: the agent can implement, verify, and complete the task autonomously, and all acceptance criteria are machine-checkable.

4. **Apply the label.** `bd tag <id> implementation-type:afk` (or `:hitl`). The classifier does this for the deterministic tiers; do it yourself only after step 3.

5. **Return the classification.** Report `AFK` or `HITL` so the calling skill or agent can act on it.

Tier precedence (label → `## Type` → heuristics → rubric), the heuristic signal list, the CLI contract, and the measured deterministic split are in `REFERENCE.md`.

## Red Flags

- Classifying a bead without the caller-side `bd label list` check — you either overwrite a recorded decision or waste a call re-reading a label that already exists.
- Spawning the rubric subagent when the classifier returned a classification — the deterministic tier is the point.
- Defaulting to HITL for a complex task whose acceptance criteria are machine-checkable — complexity alone is not a criterion.
- Choosing a class without reading the bead body when the classifier escalated.

## Common Rationalizations

| Rationalization | Rebuttal |
| "This task is complex, so it must be HITL" | Complexity is not a criterion. HITL applies only when a human is genuinely required to complete or verify. |
| "I'll mark it HITL to be safe" | HITL consumes scarce human attention. Prefer AFK — ralph's review gates still catch agent mistakes. |
| "The label is probably already there, I'll skip the check" | One `bd label list` command settles it, and the classifier checks it too. |
| "Heuristics are good enough for this one" | The classifier uses conservative, explicit signals only. If it escalated, read the body. |

## Philosophy / rationale

- Classification gates automation against human attention: AFK beads feed ralph's autonomous pipeline, HITL beads route to a person. Prefer AFK because human time is the scarce resource, and later review gates still catch agent mistakes.
- The rubric is deterministic, so most classifications are a lookup. The executable encodes that lookup once, and the model is reserved for beads whose evidence is genuinely ambiguous.

## Verification checklist

- [ ] `bd label list <id>` was checked before any other step.
- [ ] The deterministic classifier ran before any rubric subagent.
- [ ] A rubric subagent ran only when the classifier reported `escalate: true`.
- [ ] The full bead body was read before classifying from first principles.
- [ ] `bd tag <id> implementation-type:<afk|hitl>` is present afterwards.
- [ ] The calling skill or agent received the classification in the report.
