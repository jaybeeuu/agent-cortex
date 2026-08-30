---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when the user wants to stress-test a plan against their project's language and documented decisions: "grill my plan", "check this against our docs".
---

# Grill With Docs

## When to use

- The user wants to stress-test a plan against the project's existing language: "grill my plan", "grill me on this design".
- Domain terms are fuzzy or drifting and you need to pin them against `CONTEXT.md`.
- A decision needs recording as an ADR before the design moves on.
- Invoked by `ralph-plan` when the domain language is unclear or inconsistent.

## When NOT to use

- Grilling a plan with no documentation dimension — use `grill-me` for a pure design interview.
- Deciding architecture or technology trade-offs — use `technical-direction` for a justified recommendation.
- Writing project docs without an interview; this skill extracts language from the user, it does not generate it.

## Workflow

1. **Load the domain model.** Locate and read `CONTEXT.md` (single context) or `CONTEXT-MAP.md` (multi-context; the map points to each context's glossary and `docs/adr/`). Read existing ADRs so you question from the project's actual vocabulary. If neither file exists, you are starting a fresh glossary.
2. **Grill one question at a time.** State the decision branch, give your recommended answer, and wait for feedback before continuing. If a question can be answered by exploring the codebase, explore instead of asking.
3. **Challenge against the glossary.** When a term conflicts with `CONTEXT.md`, call it out immediately: "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?" When the user uses vague or overloaded terms, propose a precise canonical term.
4. **Stress-test with concrete scenarios.** Probe domain relationships with invented edge cases that force precision about concept boundaries.
5. **Cross-reference with code.** When the user states how something works, check whether the code agrees. Surface contradictions the moment you find them.
6. **Update `CONTEXT.md` inline.** When a term resolves, write the entry right there — do not batch. Keep it a pure glossary: no implementation details, no specs, no scratch notes. Entry format and file-discovery rules live in `REFERENCE.md`.
7. **Offer ADRs sparingly.** Propose an ADR only when all three hold: hard to reverse, surprising without context, and the result of a real trade-off. If any is missing, skip it. ADR format lives in `REFERENCE.md`.
8. **Close when shared understanding is reached.** Confirm every design-tree branch is resolved or explicitly deferred, and that the glossary diff captures the session's new language.

## Red Flags

- **Batching questions** — asking several at once lets the user answer the easy ones while the hard branch dies silently.
- **Drifting into generic design Q&A** — every question must anchor in the domain model, not general software opinion.
- **Deferring `CONTEXT.md` writes** — "I'll write it up later" loses the precision of the moment; terms resolved in context get reinterpreted from memory.
- **Stuffing implementation detail into `CONTEXT.md`** — it is a glossary; specs and scratch notes belong elsewhere.
- **Offering ADRs on autopilot** — an ADR for an easily-reversed choice bloats the log and buries the real decisions.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll ask three questions at once to save a round trip" | Branches depend on each other's answers; batching forces guesswork. |
| "We both know what this term means — no need to write it" | If you won't write it down, it isn't resolved; unwritten terms get relitigated. |
| "This decision feels important, let me write an ADR" | Only hard-to-reverse, surprising, real-trade-off decisions earn an ADR. |
| "The code contradicts you, but I'll note it later" | The contradiction changes the next answer — surface it now. |

## Philosophy / rationale

- **One question at a time, with a recommended answer** — every exchange settles a branch instead of opening several, so shared understanding accumulates.
- **Capture inline, not batched** — decisions recorded in context are precise; decisions reconstructed from memory drift.
- **`CONTEXT.md` is a glossary and nothing else** — the vocabulary stays stable while the design churns around it.
- **ADRs are rare** — the three criteria keep the ADR log a history of decisions, not a diary.

## Cross-skill references

| When you need… | Use |
|---|---|
| A design interview without touching project docs | `grill-me` |
| A justified recommendation on architecture or technology | `technical-direction` |

## Examples

**Sharpening a fuzzy term**

```
User: "So cancelled orders can still ship."
You:  "CONTEXT.md defines cancellation as 'void before fulfilment begins'.
       What you describe is reversing after shipping — that's a refund. Which is it?"
User: "A refund."
```

Entry appended to CONTEXT.md the moment it resolves:

```
# refund
Reversal of an order after fulfilment has begun. Distinct from cancellation,
which voids an order before fulfilment. See cancellation.
```

## Verification checklist

- [ ] Questions asked one at a time, each with a recommended answer
- [ ] Every question answerable by code was explored in the codebase instead
- [ ] Each resolved term written to `CONTEXT.md` during the session — none batched at the end
- [ ] `CONTEXT.md` holds only glossary entries — no implementation detail, specs, or scratch notes
- [ ] Terminology conflicts and vague terms called out the moment they appeared
- [ ] Claims cross-referenced against code; contradictions surfaced
- [ ] ADRs offered only when all three criteria held (offering none is a valid outcome)
- [ ] All design-tree branches resolved or explicitly deferred before closing