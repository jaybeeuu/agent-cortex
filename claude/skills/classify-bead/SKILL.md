---
name: classify-bead
description: Classify a bead as AFK or HITL and apply the implementation-type label. Use when a bead is missing its implementation-type label, when picking up a bead to work on, or when any skill creates a new bead.
---

# Classify Bead

Determine whether a bead requires human action (HITL) or can be completed autonomously by an agent (AFK), then persist the result as an `implementation-type` label.

## When to use

- A bead is missing its `implementation-type` label and you are about to pick it up.
- A skill has just created a new bead and needs it classified before claiming or scheduling.
- You are unsure of a bead's classification and want to resolve it deterministically.

## When NOT to use

- The bead already carries an `implementation-type` label — check `bd label list <id>` before invoking, and never re-classify a labelled bead.
- You are creating a new task — `create-task` classifies internally; do not spawn this skill separately.
- The work item is not a bead (e.g. a Jira ticket or plain code task) — use `write-a-ticket` or start the work directly.

## Invocation

Run this skill as a background subagent via Task so bead content never loads into the calling agent's context. Classification is a rubric lookup, not code generation — a small, cheap model is sufficient. Pass the bead ID and the `bd prime` output; the subagent runs the workflow below and reports back the classification plus the `bd tag` command it applied.

Only run inline when no task-spawning capability exists in the current environment.

**Callers should check `bd label list <id>` themselves first.** If `implementation-type` is already present, skip spawning this skill entirely — spawning a subagent purely to re-read a label that already exists wastes a full agent call.

## Workflow

1. **Check for an existing label.**

   ```bash
   bd label list <id>
   ```

   - `implementation-type:afk` present → classification is **AFK**. Stop here.
   - `implementation-type:hitl` present → classification is **HITL**. Stop here.

2. **Check the `## Type` field (back-compat).**

   ```bash
   bd show <id>
   ```

   Locate the `## Type` section in the bead body. `HITL` or `AFK` (case-insensitive) determines the classification; continue to step 4. This field predates the label system, so treat it as authoritative when present.

3. **Classify from first principles** — only when neither the label nor the `## Type` field is present. Read the full bead body and apply the rubric:

   **HITL** — the bead requires a human if at least one of the following is true:
   - The outcome cannot be verified by an agent (e.g. visual review, stakeholder sign-off, UX judgement call).
   - A manual action only a human can perform is required (e.g. credential setup, secrets management, external service configuration, infrastructure provisioning outside the codebase).
   - A decision must be made that the agent cannot make unilaterally (e.g. architectural choice between equally valid options, regulatory or legal sign-off).

   **AFK** — the agent can implement, verify, and complete the task autonomously, and all acceptance criteria are machine-checkable.

4. **Apply the label.**

   ```bash
   bd tag <id> implementation-type:afk    # or implementation-type:hitl
   ```

5. **Return the classification.** Report `AFK` or `HITL` so the calling skill or agent can act on it.

## Red Flags

- Classifying a bead without the caller-side `bd label list` check — you either overwrite a recorded decision or waste an agent spawn re-reading a label that already exists.
- Defaulting to HITL for a complex task whose acceptance criteria are machine-checkable — complexity alone is not a criterion.
- Choosing a class without reading the bead body when neither the label nor `## Type` is present.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "This task is complex, so it must be HITL" | Complexity is not a criterion. HITL applies only when a human is genuinely required to complete or verify. |
| "I'll mark it HITL to be safe" | HITL consumes scarce human attention. Prefer AFK — ralph's review gates still catch agent mistakes. |
| "The label is probably already there, I'll skip the check" | One `bd label list` command settles it. Skipping it either overwrites a decision or spawns an agent to re-read a label. |

## Philosophy / rationale

- Classification gates automation against human attention: AFK beads feed ralph's autonomous pipeline, HITL beads are routed to a person. We prefer AFK because human time is the scarce resource, and later review gates still catch agent mistakes — escalate only when completion or verification genuinely requires a human.
- The rubric is deterministic, so this skill is a lookup rather than deep reasoning — which is why a cheap subagent suffices and the step 1 early exit exists.

## Verification checklist

- [ ] `bd label list <id>` was checked before any other step.
- [ ] Classification followed the precedence order: existing label → `## Type` → first-principles rubric.
- [ ] The full bead body was read before classifying from first principles (step 3).
- [ ] `bd tag <id> implementation-type:<afk|hitl>` was applied.
- [ ] The calling skill or agent received the classification in the report.