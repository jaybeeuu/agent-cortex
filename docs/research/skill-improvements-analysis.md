# Skill Improvements: Lessons from addyosmani/agent-skills

This is a promoted research note.


> Source: https://github.com/addyosmani/agent-skills  
> Reviewed: 2026-05-26

## Summary

Compared our skills with addyosmani/agent-skills across structure, tone, and evidence-backed
patterns. Their skills are consistently richer (200–350 lines vs our 50–170), follow a strict
shared skeleton, and include several patterns backed by LLM research that we currently lack.

---

## What they do that we don't

### 1. "Common Rationalizations" table

Every skill includes a table debunking common excuses for not following it:

| Rationalization | Reality |
|---|---|
| "Tests slow me down" | Tests slow you now. They speed you up every change later. |

**Evidence**: LLM sycophancy research (Perez et al.; Anthropic Constitutional AI) shows models
rationalise away inconvenient instructions. Naming these in the prompt preemptively counters
the behaviour.

---

### 2. "When NOT to use" sections

Every skill explicitly states when _not_ to invoke it:

> "When NOT to use: Single-line fixes, typo corrections, or changes where requirements are
> unambiguous and self-contained."

**Evidence**: Wang et al. (SuperNaturalInstructions, 2022) — explicit out-of-scope boundaries
reduce false-positive invocations and improve precision.

---

### 3. "Red Flags" list

Concrete, detectable anti-patterns named inline:

- "Bug fixes without reproduction tests"
- "Tests that pass on the first run"

**Evidence**: Contrastive examples (positive + negative) improve instruction adherence. Naming
failure modes alongside correct behaviour helps models self-correct.

---

### 4. Verification checklists at the end

Every skill ends with a checkbox list:

```
- [ ] Every new behavior has a corresponding test
- [ ] All tests pass: `npm test`
```

**Evidence**: Wei et al. (Chain-of-Thought, 2022) — decomposing into explicit steps reduces
omission errors and improves task completion reliability.

---

### 5. Concrete code/output examples

Skills show realistic before/after examples, not just abstract descriptions.

**Evidence**: Brown et al. (GPT-3, 2020) — few-shot examples consistently outperform abstract
prose descriptions for in-context learning.

---

### 6. 100-line limit is too restrictive

Our `write-a-skill` caps SKILL.md at 100 lines. The addyosmani skills are 200–350 lines and
their richness (rationalizations, red flags, examples, checklists) directly follows from that
budget. The constraint is working against us.

**Proposed change**: "prefer under 150 lines; overflow rarely-needed reference detail into
REFERENCE.md" — keeping SKILL.md as the primary working document rather than gutting it.

---

## What we do better

- **Workflow depth**: `run-beads` + `ralph` encode a full pipeline (test-writing → coding →
  verifying → reviewing → fixing → documenting) that the external skills can't match.
- **Philosophy**: `tdd` has a more rigorous treatment of vertical slicing and horizontal-slice
  anti-patterns than the external TDD skill.
- **Domain specificity**: our skills are tightly integrated with `bd`, worktrees, and the ralph
  orchestrator — that's genuine value the external repo can't offer.
- **Progressive disclosure**: `REFERENCE.md` + `EXAMPLES.md` support already documented.

---

## Bead IDs

| Improvement | Status |
|---|---|
| Common Rationalizations tables | Planned |
| When NOT to use sections | Planned |
| Red Flags sections | Planned |
| Verification checklists | Planned |
| Concrete examples | Planned |
| Reconsider 100-line limit | Done (raised to 150) |
| ASCII workflow diagrams | Done (ASCII-only style guide in skill-anatomy.md) |
| Cross-references between skills | Planned |
| Consistent skeleton template | Partially adopted |

[Inspirations](../inspirations.md)
