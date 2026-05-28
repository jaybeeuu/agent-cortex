---
name: write-a-skill
description: Create new agent skills with canonical anatomy, progressive disclosure, and reusable helpers. Use when users ask to create, write, or redesign a skill.
---

# Writing Skills

## Process

1. **Gather requirements**
   - Clarify the skill goal and invocation triggers users would actually say.
   - Capture output contracts and any deterministic helper script needs.
2. **Draft from canonical anatomy**
   - Use `docs/skills/skill-anatomy.md` as the source of truth.
   - Keep `SKILL.md` around a 150-line target (older target ≤100 is superseded; hard cap remains 150).
   - Keep section order aligned with the anatomy guidance.
3. **Apply voice and tone rules**
   - Write imperative body instructions in second-person.
   - Prefer positive framing over prohibitions unless safety requires "do not".
   - Add short rationale sentences for non-obvious constraints.
   - Avoid ALL-CAPS emphasis.
4. **Define front-matter fields**
   - Required: `name`, `description`.
   - Optional: `argument-hint`, `disable-model-invocation` when the skill requires them.
5. **Split supporting docs intentionally**
   - Move long examples to `EXAMPLES.md`, formats to `FORMAT.md`, and edge cases to `REFERENCE.md`.
6. **Review checklist alignment**
   - Verify the final document is aligned with the anatomy-required sections and ordering.

## Description requirements

- Maximum 1024 characters.
- Exactly two sentences.
- Sentence 1: capability statement.
- Sentence 2: begins with `Use when ...` and includes concrete trigger phrases.
- Prefer plain language users naturally type.

## Template source

Do not maintain an inline canonical template here.
Use the full annotated template in `docs/skills/skill-anatomy.md`.

## When to add scripts

Add deterministic utilities in `scripts/` when repeatedly regenerating logic would be brittle or wasteful.

## Review checklist

- [ ] Uses canonical anatomy (`docs/skills/skill-anatomy.md`)
- [ ] Required sections are aligned with the anatomy order (`When to use`, optional adjacent `When NOT to use`, `Workflow`, `Verification checklist`)
- [ ] Description includes concrete trigger phrases
- [ ] Front-matter fields are correct (`name`, `description`, optional `argument-hint`, optional `disable-model-invocation`)
- [ ] Voice and tone follow imperative, positive, rationale-backed guidance
- [ ] `SKILL.md` line limit guidance follows the ~150 target / hard cap 150
