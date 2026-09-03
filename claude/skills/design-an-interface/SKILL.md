---
name: design-an-interface
description: "Generate multiple radically different interface designs for a module via parallel sub-agents, then compare and synthesize. Use when designing an API, exploring interface options, or \"design it twice\"."
---

# Design an Interface

## When to use

- The user wants to design an API, module boundary, or public interface.
- The user asks to explore interface options or compare module shapes.
- The user mentions "design it twice" or says the first idea is unlikely to be the best.
- An interface design step needs a guided parallel exploration — `improve-codebase-architecture` invokes this skill for its multi-design step.

## When NOT to use

- The user wants a single justified recommendation with tradeoff analysis — use `technical-direction` instead.
- The module's shape is already fixed by an upstream contract or framework, so exploring alternatives is wasted effort.
- The question is about implementation strategy, not interface shape.

## Philosophy / rationale

- **Your first idea is unlikely to be the best.** "Design It Twice" (John Ousterhout, *A Philosophy of Software Design*) holds that the first design is almost never the strongest. Generating multiple radically different candidates forces the comparison that finds the best shape.
- **Contrast, not volume, creates insight.** Similar designs from parallel agents only confirm one idea. Each agent is assigned a different constraint so divergence is guaranteed by construction.
- **Interface shape is the whole problem here.** The process stops at the interface — implementation effort is irrelevant to the comparison, because a good interface usually makes the implementation easier, not harder. Judging designs by implementation cost rewards shallow modules.

## Workflow

1. **Gather requirements.** Before designing, pin down:
   - What problem does the module solve?
   - Who are the callers (other modules, external users, tests)?
   - What are the key operations?
   - What constraints apply (performance, compatibility, existing patterns)?
   - What should be hidden inside vs exposed?

   Ask: "What does this module need to do? Who will use it?"

2. **Generate designs with parallel sub-agents.** Spawn 3+ sub-agents simultaneously with Task, each assigned a **different** constraint to guarantee radical difference. Use this prompt template per agent:

   ```
   Design an interface for: [module description]

   Requirements: [gathered requirements]

   Constraints for this design: [assign a different constraint to each agent]
   - Agent 1: "Minimize method count — aim for 1-3 methods max"
   - Agent 2: "Maximize flexibility — support many use cases"
   - Agent 3: "Optimize for the most common case"
   - Agent 4: "Take inspiration from [specific paradigm/library]"

   Output format:
   1. Interface signature (types/methods)
   2. Usage example (how a caller uses it)
   3. What this design hides internally
   4. Trade-offs of this approach
   ```

   Collect each agent's output with  when it finishes.

3. **Present designs.** Show each design sequentially — signature, usage examples, what it hides — so the user absorbs each approach before any comparison happens.

4. **Compare designs.** Compare in prose, not tables, on:
   - **Interface simplicity** — fewer methods, simpler params
   - **General-purpose vs specialized** — flexibility vs focus
   - **Implementation efficiency** — does the shape allow efficient internals?
   - **Depth** — small interface hiding significant complexity (deep module, good) vs large interface with thin implementation (shallow module, avoid)
   - **Ease of correct use** vs ease of misuse

   Highlight where the designs diverge most — that divergence is where the decision lives.

5. **Synthesize.** Ask: "Which design best fits your primary use case?" and "What elements from other designs are worth incorporating?" Often the best design combines insights from multiple options.

## Red Flags

- **Sub-agents converging on similar designs** — if two agents produce near-identical shapes, re-run with sharper, more opposed constraints. Similarity means the contrast step lost its value.
- **Skipping comparison** — jumping from presentation to a favorite design discards the whole point of exploring alternatives.
- **Sliding into implementation** — this process concerns interface shape only. Implementation details belong in a follow-up task.
- **Judging designs by implementation effort** — a design that looks harder to build may still be the deeper, better interface.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "My first design is probably fine" | That is exactly the assumption "design it twice" exists to break. Generate the alternatives before committing. |
| "The agents will just produce similar things, so why bother" | Similarity is a failure mode you control — assign opposed constraints so divergence is guaranteed by construction. |
| "I can compare these myself, no need to present each one" | Sequential presentation forces you to articulate what each design actually is before judging it, which is where the insight comes from. |

## Phase-gate checklists

- [ ] Phase 1 complete: requirements gathered and constraints listed
- [ ] Phase 2 complete: 3+ designs returned, each constrained differently
- [ ] Phase 3 complete: all designs presented sequentially
- [ ] Phase 4 complete: comparison shared and divergence highlighted
- [ ] Phase 5 complete: candidate synthesized with user input

## Cross-skill references

- `improve-codebase-architecture` invokes this skill for its multi-design step (step 5 of its workflow).
- Run `grill-with-docs` when the module's domain terminology is unsettled — design names should match the ubiquitous language.

## Examples

Input: "Design the interface for a rate limiter module"
Output: four radically different interface sketches (minimal-method, flexible, common-case-optimized, paradigm-inspired), presented sequentially, compared on simplicity, depth, and trade-offs, then synthesized into one recommended shape with the user.

## Verification checklist

- [ ] Requirements captured before any sub-agent is spawned
- [ ] At least 3 sub-agents spawned, each with a distinct constraint
- [ ] Each design reports signature, usage example, hidden complexity, and trade-offs
- [ ] Designs presented sequentially before any comparison
- [ ] Comparison covers simplicity, generality, efficiency, depth, and ease of correct use
- [ ] Synthesis asks the user which design fits their primary use case
- [ ] No implementation work performed — interface shape only