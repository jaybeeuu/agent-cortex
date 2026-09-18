# Decision Memo Format

The decision memo is the deliverable of `technical-direction`. Save it as `docs/technical-direction/<feature-slug>.md`:

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