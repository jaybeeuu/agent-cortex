---
name: technical-direction
description: Drive collaborative technical design by challenging assumptions, mapping constraints, comparing alternatives, and producing a justified recommendation. Use when user wants to decide technical direction after PRD, evaluate architecture/technology choices, or asks to design a solution with tradeoff analysis.
---

# Technical Direction

Act like a pragmatic, challenging staff engineer: constructive, direct, evidence-driven.

## Workflow

1. **Anchor on problem context**
   - Start from PRD or user brief
   - Confirm technical goals, non-goals, and decision horizon

2. **Discover constraints from codebase first**
   - Investigate architecture, existing interfaces, deployment/runtime constraints, data model boundaries, and team conventions
   - Note unknowns and risks

3. **Challenge loop (one question at a time)**
   - Ask focused, high-leverage questions
   - Challenge vague claims and hidden assumptions
   - Require explicit justification for each major decision
   - Keep drilling until constraints and tradeoffs are concrete

4. **Generate options**
   - Always include Option A (extend current approach), Option B (moderate architectural shift), and Option C (stronger alternative using new tech/pattern)
   - For each option: feasibility, complexity, migration cost, operational impact, testability, performance, and failure modes

5. **Use web research when needed**
   - Do this autonomously when codebase evidence is insufficient or a high-impact decision needs external comparison
   - Prefer authoritative sources (official docs, maintainers, widely adopted production guidance)
   - Bring findings back as tradeoffs, and retain source links as references

6. **Converge on a recommendation**
   - Select the best-fit option for current constraints
   - Explicitly explain why alternatives were not chosen
   - List decision triggers that would justify revisiting later

7. **Write decision memo**
   - Ensure `docs/technical-direction/` exists
   - Save to `docs/technical-direction/<feature-slug>.md` using this template:

```md
# Technical Direction: <Feature Name>
## Problem and target outcome
- What we are solving
- Why this matters now
## Current-state constraints
- Architecture and integration constraints
- Team/runtime/operational constraints
- Unknowns and assumptions
## Options considered
### Option A: <name>
- Approach
- Pros
- Cons
- Risks
### Option B: <name>
...
### Option C: <name>
...
## Recommendation
- Chosen approach
- Why this is best under current constraints
- Why alternatives were not selected
## Tradeoffs accepted
- Explicit compromises and consequences
## Validation plan
- Fastest experiments/spikes to de-risk decision
- Success/failure signals
## Revisit triggers
- Conditions that should force re-evaluation
## References
- Web sources used for decisions (title + URL)
- Code evidence links (repo path + line range, and permalink URL when available)
```

## Rules

- Ask questions one at a time.
- If the answer exists in the codebase, investigate before asking.
- Be challenging but collaborative; do not optimize for agreement.
- Avoid premature implementation details until direction is selected.
- Every recommendation must include explicit constraints and tradeoffs.
- When web or code sources materially inform decisions, include them in `## References`.
