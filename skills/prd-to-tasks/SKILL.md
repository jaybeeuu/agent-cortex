---
name: prd-to-tasks
description: Break a PRD into phased epics and task beads using tracer-bullet vertical slices. Use when a PRD is approved and you need to create the executable backlog, or when ralph-plan encounters a large workstream.
argument-hint: "Break down <PRD or epic description> into epics and tasks"
---

# PRD to Tasks

Take a PRD (or equivalent specification) and produce a complete set of epics and task beads,
ready for ralph to execute. The epic bead is the source of truth — no intermediate plan file.

Designed to be invoked by `ralph-plan` (when the input is a PRD or a large workstream) or
directly by a user who has a clear spec.

## When to use

- A PRD has been written and approved — time to break it into executable chunks.
- `ralph-plan` receives a PRD as input (step 1) or encounters a large workstream (step 6).
- You have a well-understood feature and want to create the full bead tree in one pass.
- The user says "break this into tasks", "phase this PRD", "create epics from this spec".

## When NOT to use

- The work is a single self-contained task — use `create-task` instead.
- The feature is not yet specified — use `write-a-prd` or the `strategy` agent first.
- You only need to record a raw idea — use `record-idea`.
- The task is a bug fix — file directly with `create-task`.

## Philosophy / rationale

- **Epics are the source of truth.** The epic bead body contains the phase scope,
  acceptance criteria, and dependencies. No intermediate plan file means no drift between
  what was planned and what is tracked.
- **Tracer-bullet vertical slices.** Each task is a thin end-to-end path through all layers
  (schema, API, logic, UI, tests). A completed task is demoable alone. Prefer many thin
  slices over few thick ones.
- **One pass, complete output.** This skill produces the entire bead tree. The user or
  ralph-plan reviews once at the end, not piecemeal through intermediaries.

## Workflow

### Phase 1 — Understand the PRD

1. Confirm the PRD is in context (conversation, bead description, or file).
2. If you haven't explored the relevant codebase area, do so now — understand current
   architecture, existing patterns, and integration layers.
3. Identify durable architectural decisions that will apply across all phases:
   - Route structures / URL patterns
   - Database schema shape
   - Key data models
   - Authentication / authorisation approach
   - Third-party service boundaries
4. Record these in a holding note — they inform every phase.

### Phase 2 — Draft the phase breakdown

5. Break the PRD into phases. Each phase is a **tracer-bullet vertical slice**:
   - Thin but complete path through ALL integration layers.
   - Demoable or verifiable on its own.
   - Covers a specific set of user stories from the PRD.

6. For each phase, define:
   - **Title**: short descriptive name.
   - **User stories covered**: which PRD stories this phase addresses.
   - **What to build**: end-to-end behaviour description (not layer-by-layer).
   - **Acceptance criteria**: verifiable outcomes.

7. Present the proposed phases to the user. Ask:
   - Does the granularity feel right?
   - Should any phases be merged or split?
   - Are the dependency relationships correct — can any run in parallel?

8. Iterate until the user approves the breakdown.

### Phase 3 — Create epics (one per phase)

9. Create epics in dependency order (blockers first) so you can reference real bead IDs.

   ```bash
   bd create "<Phase Title>" --type epic \
     --description "<epic body from template below>"
   ```

10. Tag each epic with a priority:
    ```bash
    bd tag <epic-id> priority:p3   # default for feature work; adjust if P4/P5
    ```
    If running in the context of ralph-plan or ralph, also tag with:
    ```bash
    bd tag <epic-id> workflow:ralph
    ```

### Phase 4 — Create tasks within each epic

11. For each epic, break it into task-sized vertical slices. Each task is independently
    grabbable — a single agent (or person) can pick it up and complete it.

12. For each task, invoke `create-task`:
    ```bash
    # create-task handles classification (AFK/HITL) and pipeline expansion
    # Pass title, description (use template below), priority (inherit from epic or adjust),
    # and parent epic ID
    ```

13. After all tasks are created, tag the parent epic with the aggregate classification:
    - If **any** task is HITL, the epic is HITL:
      ```bash
      bd tag <epic-id> implementation-type:hitl
      ```
    - If **all** tasks are AFK:
      ```bash
      bd tag <epic-id> implementation-type:afk
      ```

### Phase 5 — Report

14. Present the full bead tree:
    ```
    Epic: "Phase 1 Title" (#123)
      ├── Task 1 (#124) — AFK
      ├── Task 2 (#125) — HITL (visual review)
      └── Task 3 (#126) — AFK
    Epic: "Phase 2 Title" (#127)
      ├── ...
    ```

15. If invoked by `ralph-plan`, signal completion so ralph-plan can proceed to the
    agree-with-user step. If invoked directly by a user, summarise the bead tree and
    confirm they're happy before finishing.

## Epic body template

```markdown
## Source

PRD: <brief reference>

## Summary

A concise description of this phase. Scope and goal, not implementation details.

## What to build

End-to-end behaviour for this phase. What a demo would show.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- Blocked by #<epic-id> (if any) — or "None — can start immediately"
```

## Task body template (passed to `create-task`)

```markdown
## Epic

#<epic-id> — <Epic Title>

## What to build

This vertical slice: end-to-end behaviour, not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- Blocked by #<task-id> (if any) — or "None — can start immediately"
```

## Red Flags

- **Skipping the user quiz.** The phase breakdown needs human approval before creating
  beads. Do not skip Phase 2 step 7-8.
- **Creating horizontal slices.** "All the database work first, then all the API work" is
  not tracer bullets. Every task must deliver end-to-end value.
- **Fat tasks.** If a task would take a full agent session to implement, slice thinner.
  A task should be a few RED-GREEN cycles, not a week of work.
- **Letting the plan file drift.** Epics are the SOT. Do not also write a plan file —
  the epic bead body is the plan.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll create the epics now and the tasks later" | The user has approved the phases. Create everything in one pass — that's the point of this skill. |
| "I'll write a plan file first, then convert" | The epic bead IS the plan. Writing a separate file creates drift. |
| "This phase is too small for acceptance criteria" | If it's too small for criteria, merge it with another phase. Every deliverable needs a definition of done. |
| "I know what the tasks should be, I don't need to check with the user" | The phase breakdown needs approval. The epic-level approval implies task-level trust, but you still present the full tree in Phase 5. |

## Cross-skill references

- **`create-task`** — invoked in Phase 4 for each task bead. Handles classification and
  pipeline expansion.
- **`write-a-prd`** — use this first if the feature isn't specified yet.
- **`classify-bead`** — not needed; `create-task` handles classification internally.
- **`style-comms`** — invoke before Phase 2 if you need help writing clear phase
  descriptions.

## Phase-gate checklist

- [ ] Phase 1 (Understand): architectural decisions captured, codebase explored.
- [ ] Phase 2 (Breakdown): phases drafted and user-approved.
- [ ] Phase 3 (Epics): all epic beads created, tagged with `workflow:ralph` and
      `priority:<p3|p4|p5>`.
- [ ] Phase 4 (Tasks): all task beads created via `create-task`, epic tagged with
      aggregate `implementation-type`.
- [ ] Phase 5 (Report): full bead tree presented.

## Verification checklist

- [ ] Every phase is a vertical slice (covers all layers), not a horizontal layer.
- [ ] Every task is independently grabbable (one agent can complete without others).
- [ ] All epics are tagged with `workflow:ralph` and a priority.
- [ ] All tasks are classified (AFK/HITL) via `create-task`.
- [ ] Parent epics have aggregate `implementation-type` tags.
- [ ] No intermediate plan file was created — epics are the SOT.
- [ ] Full bead tree was presented to the user (or to ralph-plan for step 7).
