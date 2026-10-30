---
name: prd-to-tasks
description: Break a PRD into phased epics and task beads using tracer-bullet vertical slices. Use when a PRD is approved and you need to create the executable backlog, when the user says "break this into tasks", "phase this PRD", or "create epics from this spec", or when ralph-plan encounters a large workstream.
argument-hint: "Break down <PRD or epic description> into epics and tasks"
---

# PRD to Tasks

Take an approved PRD and produce a complete set of epics and task beads, ready for ralph to
execute. The epic bead is the source of truth — no intermediate plan file.

## When to use

- A PRD has been written and approved — time to break it into executable chunks.
- `ralph-plan` receives a PRD as input or encounters a large workstream.
- You have a well-understood feature and want the full bead tree created in one pass.
- The user says "break this into tasks", "phase this PRD", or "create epics from this spec".

## When NOT to use

- A single self-contained task — use `create-task` instead.
- A feature that is not yet specified — use `write-a-prd` or the `strategy` agent first.
- A raw idea that needs capturing — use `record-idea`.
- A bug fix — file it directly with `create-task`.

## Philosophy / rationale

- **Epics are the source of truth.** Each epic bead body carries the phase scope, acceptance
  criteria, and dependencies; no plan file means no drift between planned and tracked.
- **Tracer-bullet vertical slices.** Each task is a thin end-to-end path through every layer
  (schema, API, logic, UI, tests), demoable alone. Prefer many thin slices over few thick ones.
- **One pass, complete output.** Produce the whole bead tree in one pass; the user or
  ralph-plan reviews once at the end, not piecemeal through intermediaries.

## Workflow

### Phase 1 — Understand the PRD

1. Confirm the PRD is in context (conversation, bead description, or file).
2. Explore the relevant codebase area if you have not already — current architecture and
   integration layers.
3. Record the durable architectural decisions that apply across all phases, as examples
   not an exhaustive list: route structures or URL patterns, database schema shape, key
   data models, auth approach, third-party service boundaries. This shared skeleton informs
   every phase.

### Phase 2 — Draft the phase breakdown

4. Break the PRD into phases. Each phase is a **tracer-bullet vertical slice**: thin but
   complete through all integration layers, demoable or verifiable on its own, and
   covering a specific set of user stories.
5. For each phase define its **title**, **user stories covered**, **what to build**
   (end-to-end behaviour, not layer-by-layer), and **success criteria** — the epic's required
   `## Success Criteria`. The interview is complete only when every phase has agreed criteria;
   never invent them.
6. Present the proposed phases and ask about granularity, merges or splits, and which
   phases can run in parallel. Iterate until the user approves.

### Phase 3 — Create epics (one per phase)

7. Create epics in dependency order (blockers first) so you can reference real bead IDs,
   using the epic body template in [REFERENCE.md](./REFERENCE.md). The body must carry
   `## Success Criteria`; `--validate` rejects it otherwise:

   ```bash
   bd create "<Phase Title>" --type epic -l execution:hitl --description "<epic body from REFERENCE.md>" --validate
   bd lint <epic-id>
   ```

   An epic is a container and a person decides when it closes, so it is `execution:hitl` in its own right — not because of what its children are.

8. Tag each epic with a priority (`p3` default; adjust for p4/p5), and `workflow:ralph`
   when running under ralph-plan or ralph.

### Phase 4 — Create tasks within each epic

9. Break each epic into task-sized vertical slices that are independently grabbable, then
   invoke `create-task` for each — it handles AFK/HITL classification and pipeline
   expansion. Pass the task body template from REFERENCE.md, the priority, and the parent
   epic ID.
10. Do not aggregate a child's classification onto its epic. Every bead states its own execution class, and a container's class is `execution:hitl` because a human owns it — copying `execution:afk` upward because the children happen to be AFK labels a human-owned container as agent work.
11. When a slice is really several deliverables, use the feature shape from `create-task` steps 5–6 instead of fattening one task: a feature bead owns a planning bead that blocks one impl child per deliverable (`REFERENCE.md` → Feature → planning → impl sequence). The planning bead is where the design the PRD left open gets settled, so `bd ready` surfaces the impl children only once planning closes.

### Phase 5 — Report

12. Present the full bead tree: each epic with its tasks, classifications, and IDs.
13. If invoked by `ralph-plan`, signal completion so it can proceed; if invoked directly,
    summarise the tree and confirm the user is happy before finishing.

## Red Flags

- **Skipping the phase approval step.** The breakdown needs human sign-off (Phase 2 step 6)
  before any bead is created.
- **Creating horizontal slices.** "All the database work, then all the API work" is not a
  tracer bullet — every task must deliver end-to-end value.
- **Fat tasks.** If a task would take a full agent session, slice thinner. A task is a few
  RED-GREEN cycles, not a week of work.
- **Letting a plan file drift in.** The epic bead is the plan — a separate file creates
  drift and is ignored by ralph.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll create the epics now and the tasks later" | Phases are already approved — create everything in one pass. |
| "I'll write a plan file first, then convert" | The epic bead IS the plan. A separate file creates drift. |
| "This phase is too small for acceptance criteria" | If it is too small for criteria, merge it with another phase. Every deliverable needs a definition of done. |
| "I know the tasks — no need to check with the user" | The phase breakdown still needs approval, and the full tree is presented in Phase 5. |

## See Also

- [create-task](../create-task/SKILL.md) — invoked for every task bead; owns classification and pipeline expansion.
- [write-a-prd](../write-a-prd/SKILL.md) — load first when the feature is not yet specified.
- [style-comms](../../style/style-comms/SKILL.md) — load before the phase-description step when the writing reads loosely.

## Examples

Input: an approved PRD with a numbered list of user stories.
Output: a dependency-ordered tree of epic and task beads:

```
Epic: "Phase 1 — Auth" (#123) — HITL
  ├── Task 1 (#124) — AFK
  ├── Task 2 (#125) — HITL (visual review)
  ├── Task 3 (#126) — AFK
  └── Feature 4 (#128) — HITL
        ├── Plan: Feature 4 (#129) — HITL, blocks #130
        └── Task 5 (#130) — AFK
Epic: "Phase 2 — Dashboard" (#127) — HITL (blocked by #123)
```

## Phase-gate checklists

- [ ] Phase 1 complete: PRD confirmed, codebase explored, architectural decisions captured.
- [ ] Phase 2 complete: phases drafted and approved by the user.
- [ ] Phase 3 complete: epics created in dependency order and tagged (priority, plus
      `workflow:ralph` under ralph-plan/ralph), and `bd lint` clean.
- [ ] Phase 4 complete: tasks created via `create-task`; no execution label aggregated from
      children onto a parent.
- [ ] Phase 5 complete: full bead tree presented and confirmed.

## Verification checklist

- [ ] Every phase is a vertical slice covering all layers, not a horizontal layer.
- [ ] Every task is independently grabbable by a single agent.
- [ ] All epics are tagged with a priority (and `workflow:ralph` when under ralph).
- [ ] Epics created with `--validate`; `bd lint` reports no missing sections for the created tree.
- [ ] All tasks are classified AFK/HITL via `create-task`.
- [ ] Every epic and feature container carries `execution:hitl`, and every task states its own
      `execution:afk`/`execution:hitl`.
- [ ] Every impl child of a feature depends on that feature's planning bead.
- [ ] No execution label was aggregated from children onto a parent.
- [ ] No intermediate plan file was created — epics are the source of truth.
- [ ] The full bead tree was presented to the user, or to ralph-plan for its next step.