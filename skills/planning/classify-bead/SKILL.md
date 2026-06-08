---
name: classify-bead
description: Classify a bead as AFK or HITL and apply the implementation-type label. Use when a bead is missing its implementation-type label, when picking up a bead to work on, or when any skill creates a new bead.
---

# Classify Bead

Determine whether a bead requires human action (HITL) or can be completed autonomously by an agent (AFK), then persist the result as a label.

## When to use

- When picking up a bead that is missing the `implementation-type` label.
- Immediately after creating a new bead, before claiming or scheduling it.
- Any time you are unsure of a bead's classification.

## Invocation

**Always run this skill as a subagent** (background `general-purpose` agent) to avoid loading bead content into the calling agent's context. Pass the bead ID and the `bd prime` output. The subagent runs the procedure below and reports back the classification and the `bd tag` command it applied.

Only run inline (without a subagent) if no task-spawning capability is available in the current environment.

## Procedure

### 1. Check for an existing label

```bash
bd label list <id>
```

- If `implementation-type:afk` is present → classification is **AFK**. Stop here.
- If `implementation-type:hitl` is present → classification is **HITL**. Stop here.

### 2. Check the `## Type` field (back-compat)

```bash
bd show <id>
```

Locate the `## Type` section in the bead body.

- If the value is `HITL` (case-insensitive) → classification is **HITL**. Proceed to step 4.
- If the value is `AFK` (case-insensitive) → classification is **AFK**. Proceed to step 4.

### 3. Classify from first principles

If neither the label nor the `## Type` field is present, read the full bead body and apply this rubric:

**HITL** — the bead requires a human if at least one of the following is true:
- The outcome cannot be verified by an agent (e.g. visual review, stakeholder sign-off, UX judgement call).
- The work requires a manual action only a human can perform (e.g. credential setup, secrets management, external service configuration, infrastructure provisioning outside the codebase).
- A decision must be made that the agent cannot make unilaterally (e.g. architectural choice between equally valid options, regulatory or legal sign-off).

**AFK** — the agent can implement, verify, and complete the task autonomously, and all acceptance criteria are machine-checkable.

Prefer AFK. Do not classify as HITL just because the task is complex — only when the agent genuinely cannot complete or verify it without human involvement.

### 4. Apply the label

```bash
bd tag <id> implementation-type:afk    # or implementation-type:hitl
```

### 5. Return the classification

Report back `AFK` or `HITL` so the calling skill or agent can act on it.
