---
name: prd-to-plan
description: Turn a PRD into a multi-phase implementation plan using tracer-bullet vertical slices, saved as a working Markdown file in .agent-cortex/ralph/plans/. Use when user wants to break down a PRD, create an implementation plan, plan phases from a PRD, or mentions "tracer bullets".
---

# PRD to Plan

Break a PRD into a phased implementation plan using vertical slices (tracer bullets). Output is a Markdown file in `.agent-cortex/ralph/plans/`.

## Process

### 1. Confirm the PRD is in context

The PRD should already be in the conversation. If it isn't, ask the user to paste it or point you to the file.

### 2. Explore the codebase

If you have not already explored the codebase, do so to understand the current architecture, existing patterns, and integration layers.

### 3. Run the SDD pre-hook

Before planning, load cached SDD spec context so the phase breakdown reflects the latest approved architecture and constraints.

```bash
mkdir -p .agent-cortex/ralph/cache
sdd_cache_file=".agent-cortex/ralph/cache/sdd-spec-context.md"
if [ -f "$sdd_cache_file" ]; then
  cat "$sdd_cache_file"
fi
```

If the cache file exists, treat it as required input:

- Reuse the durable decisions and constraints as the baseline for the new plan.
- Only replace cached decisions when the current PRD explicitly supersedes them.
- Carry forward unresolved `Open questions` into the new plan or call them out during the quiz step.

### 4. Identify durable architectural decisions

Before slicing, identify high-level decisions that are unlikely to change throughout implementation:

- Route structures / URL patterns
- Database schema shape
- Key data models
- Authentication / authorization approach
- Third-party service boundaries

These go in the plan header so every phase can reference them.

### 5. Draft vertical slices

Break the PRD into **tracer bullet** phases. Each phase is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
- Do NOT include specific file names, function names, or implementation details that are likely to change as later phases are built
- DO include durable decisions: route paths, schema shapes, data model names
</vertical-slice-rules>

### 6. Quiz the user

Present the proposed breakdown as a numbered list. For each phase show:

- **Title**: short descriptive name
- **User stories covered**: which user stories from the PRD this addresses

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Should any phases be merged or split further?

Iterate until the user approves the breakdown.

### 7. Write the plan file

Create `.agent-cortex/ralph/plans/` if it doesn't exist. Write the plan as a Markdown file named after the feature (e.g. `.agent-cortex/ralph/plans/user-onboarding.md`). Use the template below.

<plan-template>
# Plan: <Feature Name>

> Source PRD: <brief identifier or link>

## Architectural decisions

Durable decisions that apply across all phases:

- **Routes**: ...
- **Schema**: ...
- **Key models**: ...
- (add/remove sections as appropriate)

---

## Phase 1: <Title>

**User stories**: <list from PRD>

### What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

---

## Phase 2: <Title>

**User stories**: <list from PRD>

### What to build

...

### Acceptance criteria

- [ ] ...

<!-- Repeat for each phase -->
</plan-template>

### 8. Run the SDD post-hook

After writing the plan file, persist an updated SDD context snapshot for future sessions:

```bash
mkdir -p .agent-cortex/ralph/cache
sdd_cache_file=".agent-cortex/ralph/cache/sdd-spec-context.md"
cat > "$sdd_cache_file" <<'EOF'
# SDD Spec Context Cache
Updated: <UTC ISO timestamp>
Source PRD: <bead id / link / filename>
Source plan: <path to generated plan markdown>

## Durable decisions
- ...

## Constraints
- ...

## Open questions
- ...
EOF
```

This post-hook is mandatory. Every successful `prd-to-plan` run must overwrite the cache with the latest approved context so the next session starts from the same spec baseline.
