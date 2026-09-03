---
name: plan
description: Guide a feature from first discussion through PRD and task breakdown to classified beads ready for execution, then produce a handoff bead for ralph. Use when starting a new feature, scoping work to hand off to ralph, investigating a codebase change and structuring the work, or saying "plan this" or "get this ready for ralph".
argument-hint: Feature description, PRD draft, or goal you want to plan.
---

# Plan

Orchestrate the full ideate → specify → decompose → classify → handoff workflow. Produces a complete bead tree (epics + classified tasks with pipeline stages) and a top-level bead ID to pass to a separate agent running the `ralph` skill.

Covers everything needed to prepare work for autonomous execution: understand the problem, write a PRD, break it into vertical-slice tasks, classify each one, and expand AFK tasks into pipeline-stage chore beads. Stops before execution — the user reviews the plan, then hands off a bead ID to ralph.

## When to use

- "Plan this feature for me"
- "Get this ready for ralph"
- "I need to investigate a codebase change, scope the work, and set up the beads"
- User wants the full flow: investigation → PRD → task breakdown → classified beads → handoff
- User has an existing PRD and wants to skip to the breakdown and bead creation (step in at Phase 2)

## When NOT to use

- User already has a PRD and just needs it broken into tasks — use `prd-to-tasks` directly.
- Single well-understood task that just needs a bead — use `create-task`.
- Raw idea not ready for implementation planning — use `record-idea`.
- Detailed refactor plan with commit-level steps — use `request-refactor-plan`.
- Beads already exist and just need execution — use `ralph` directly.

## Workflow

### Phase 1 — Understand and specify

Establish what needs to be built through investigation and collaborative design.

1. Ask the user to describe the problem, goal, or feature in their own words. Listen for what currently exists, what is missing, and what success looks like.

2. Explore the codebase to verify the user's assertions and understand the current state of the relevant areas. Investigate:
   - Existing architecture and data models
   - Similar features already implemented
   - Integration points (APIs, databases, third-party services)
   - Test patterns and coverage conventions

3. Interview the user relentlessly about every aspect of the plan until reaching shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. Cover:
   - Scope boundaries — what is in and what is explicitly out
   - Key data models and their relationships
   - Module boundaries and interfaces
   - Technical constraints and trade-offs
   - How each change will be verified

4. Sketch the major modules that will be built or modified. Look for opportunities to extract deep modules — ones that encapsulate significant behaviour behind a simple, testable interface.

5. Draft a PRD using the template from `write-a-prd`. Include:
   - Problem statement and solution summary
   - Numbered user stories covering all aspects
   - Implementation decisions (modules, interfaces, technical clarifications)
   - Out-of-scope items

6. Present the PRD to the user for review. Iterate until they approve it.

7. Create an epic bead from the approved PRD:
   ```bash
   bd create "<Feature Title> — PRD" --type epic \
     --description "<rendered PRD as markdown>" --priority p2
   bd tag <epic-id> workflow:plan
   ```

#### Phase 1 gate

- [ ] Codebase explored and assertions verified
- [ ] Design decisions resolved through interview
- [ ] Modules sketched and reviewed with the user
- [ ] PRD drafted and approved by the user
- [ ] Epic bead created from approved PRD

### Phase 2 — Break into tasks

Take the approved PRD and produce a set of epics and tasks using tracer-bullet vertical slices.

8. Review the user stories and implementation decisions from the PRD. Identify natural phase boundaries — each phase should be a thin end-to-end slice through all layers (schema, API, logic, UI, tests) that is demoable on its own.

9. For each phase, define:
   - **Title**: short descriptive name
   - **User stories covered**: which PRD stories this phase addresses
   - **What to build**: end-to-end behaviour description
   - **Acceptance criteria**: verifiable outcomes

10. If the work is small enough for a single epic (one phase, a few tasks), skip epics and proceed directly to Phase 3. A single epic with a few tasks dispatches through ralph more efficiently than creating unnecessary epic hierarchy. If the work has multiple distinct phases, create epics:
    ```bash
    bd create "<Phase Title>" --type epic \
      --description "<epic body with scope, criteria, dependencies>" --priority <same as parent>
    bd tag <epic-id> workflow:plan
    bd dep add <epic-id> <parent-epic-id> --type parent-child
    ```

11. Present the proposed phase/task breakdown to the user. Ask:
    - Does the granularity feel right?
    - Should any phases be merged or split?
    - Are the dependency relationships correct — can any run in parallel?

12. Iterate until the user approves the breakdown. Every phase and task must represent a thin vertical slice.

#### Phase 2 gate

- [ ] Phases identified as vertical slices (not horizontal layers)
- [ ] Each phase has documented acceptance criteria
- [ ] Breakdown approved by the user

### Phase 3 — Create and classify beads

For each task (within each epic), create a bead, classify it, and expand AFK tasks into pipeline-stage chore beads.

13. For each task in dependency order (blockers first), create the task bead via `create-task`:
    ```bash
    # create-task handles: bead creation → classify → AFK: expand into pipeline stages → HITL: stop
    ```
    Pass the parent epic ID (if epics are used) so tasks are nested under their epic.

14. After all tasks in an epic are created, tag the parent epic with the aggregate classification:
    - If **any** task is HITL: `bd tag <epic-id> implementation-type:hitl`
    - If **all** tasks are AFK: `bd tag <epic-id> implementation-type:afk`

15. Present the full bead tree to the user:
    ```
    Epic: "Phase 1 Title" (#epic-abc)
      ├── Task 1: "..." (#task-123) — AFK
      ├── Task 2: "..." (#task-456) — HITL (visual review)
      └── Task 3: "..." (#task-789) — AFK
    Epic: "Phase 2 Title" (#epic-def)
      ├── ...
    ```

#### Phase 3 gate

- [ ] All tasks created via `create-task`
- [ ] All tasks classified (AFK or HITL)
- [ ] AFK tasks expanded into pipeline-stage chore beads plus PR gate
- [ ] Parent epics tagged with aggregate `implementation-type`
- [ ] Full bead tree presented to the user

### Phase 4 — Prepare handoff to ralph

Deliver a handoff bead and instructions for running ralph.

16. Determine the entry point:
    - **Single epic**: the epic ID is the handoff bead.
    - **Multiple independent epics**: create a parent meta-epic that groups them:
      ```bash
      bd create "<Feature Title> — Implementation" --type epic \
        --description "Meta-epic grouping all phases for execution. See child epics for detail." \
        --priority <same>
      bd dep add <epic-1> <meta-epic> --type parent-child
      bd dep add <epic-2> <meta-epic> --type parent-child
      ```
      The meta-epic ID is the handoff bead.
    - **Sequentially dependent epics**: the first unblocked epic is the handoff bead — ralph will discover the rest via `bd ready` as dependencies clear.

17. Tag the handoff bead for ralph's discovery:
    ```bash
    bd tag <handoff-id> workflow:ralph
    ```

18. Push the bead state:
    ```bash
    bd dolt push
    ```

19. Present the handoff summary:
    ```
    ✅ Plan complete. Ready for ralph.

    Handoff bead: #<handoff-id>

    To execute, tell an agent:

        Use the ralph skill. Start from bead #<handoff-id>.

    Full bead tree:

    | Bead ID | Title | Type | Classification |
    |---------|-------|------|---------------|
    | #epic   | Phase 1 | epic | AFK |
    | #task   | Task 1 | task | AFK (4 chore beads + PR gate) |
    | #task   | Task 2 | task | HITL |
    | ...     | ...    | ...  | ... |
    ```

#### Phase 4 gate

- [ ] Handoff bead identified and tagged `workflow:ralph`
- [ ] Bead state pushed with `bd dolt push`
- [ ] Handoff summary presented with the exact instruction to give an agent

## Phase-gate checklist

- [ ] Phase 1: PRD drafted and approved, epic bead created
- [ ] Phase 2: Task breakdown approved, epics created (if needed)
- [ ] Phase 3: All tasks created, classified, expanded, tree presented
- [ ] Phase 4: Handoff bead prepared, state pushed, summary delivered

## Red Flags

- **Skipping the codebase investigation.** Surface-level understanding produces PRDs that miss integration constraints, existing patterns, or prior art. Always explore before designing.
- **Skipping the user interview.** The agent has incomplete context. The interview resolves ambiguities that would otherwise surface mid-execution as rework.
- **Creating horizontal slices.** "All the DB work first, then all the API work" is not tracer bullets. Every task must deliver end-to-end value.
- **Moving past Phase 2 without user approval.** The task breakdown shapes the entire execution. Do not create beads until the breakdown is approved.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I know what needs to be built, I don't need a PRD" | A written PRD is the shared contract between the user, the planner, and the executor. It catches unstated assumptions. |
| "I'll refine the tasks as I go" | The plan phase is the right time to refine. Mid-execution task changes cause rework in the bead dependency graph and confuse ralph's stage tracking. |
| "This is a small change, I can just hand it straight to ralph" | For genuinely small changes — a single well-understood task — use `create-task` directly and skip this skill. This skill is for work that needs scoping. |
| "I already know the phases, skip the quiz" | The quiz is where edge cases surface. Present the proposed breakdown for quick confirmation rather than skipping. |

## Philosophy / rationale

- **Tracer-bullet vertical slices** mean each completed task is independently demoable and verifiable. This avoids the "everything works but nothing is finished" trap.
- **The bead graph is the plan.** By storing scope, dependencies, and classification in beads, there is no separate document to drift. The handoff is just a bead ID.
- **Planning and execution are separate concerns.** The plan skill works with the user to get the right scope and structure. Ralph then executes autonomously within that structure. Separating them means the user reviews once, not piecemeal.
- **AFK by default.** Classify tasks as AFK unless a human is genuinely required. Agent capability grows over time — tasks that feel HITL today may be AFK tomorrow.

## Cross-skill references

- `write-a-prd` — PRD template and interview workflow for Phase 1 (this skill incorporates the approach inline rather than delegating, to maintain a single coherent conversation).
- `prd-to-tasks` — For the task breakdown step in Phase 2. If the PRD is already written and only decomposition is needed, use that skill directly.
- `create-task` — Invoked in Phase 3 for each task. Handles bead creation, classification via `classify-bead`, and pipeline expansion for AFK tasks.
- `classify-bead` — Invoked internally by `create-task`; not invoked directly by this skill.
- `ralph` — The downstream skill that consumes the handoff bead. Run a separate agent with "Use the ralph skill. Start from bead #<handoff-id>."
- `record-idea` — Use this instead if the idea is not ready for implementation planning.
- `style-comms` — Invoke during Phase 1 if the user stories or implementation decisions need clearer writing.
- `style-documentation` — Invoke during Phase 1 to align PRD documentation conventions with project standards.

## Examples

**Input:** "Plan this for me — I want to add a webhook notification system so external services can subscribe to order events."

**Output after Phase 4:**
```
✅ Plan complete. Ready for ralph.

Handoff bead: #epic-abc123

To execute, tell an agent:

    Use the ralph skill. Start from bead #epic-abc123.

Full bead tree:

| Bead ID | Title | Type | Classification |
|---------|-------|------|---------------|
| #epic-abc123  | Webhook Notification System — PRD | epic | AFK |
| #task-456 | Create webhook subscription schema + API | task | AFK (4 chore beads + PR gate) |
| #task-789 | Implement event dispatch and retry logic | task | AFK (4 chore beads + PR gate) |
| #task-012 | Build subscriber management UI | task | HITL (visual review) |
```

## Verification checklist

- [ ] Codebase was explored before drafting the PRD
- [ ] User interview completed — each design branch resolved before moving to the next
- [ ] PRD written with user stories and implementation decisions
- [ ] PRD approved by the user before bead creation
- [ ] Epic bead created from the approved PRD body
- [ ] Task breakdown uses vertical slices (each task covers all layers — schema, API, logic, UI if applicable, tests)
- [ ] Task breakdown approved by the user before moving to Phase 3
- [ ] All tasks created via `create-task` (which handles classification, pipeline expansion, and PR gate creation)
- [ ] Parent epics tagged with aggregate `implementation-type` (AFK if all children AFK, HITL if any child is HITL)
- [ ] Full bead tree presented to the user before handoff
- [ ] Handoff bead tagged `workflow:ralph`
- [ ] Bead state pushed with `bd dolt push`
- [ ] Handoff summary includes the exact instruction to give an agent
