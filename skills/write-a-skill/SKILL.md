---
name: write-a-skill
description: Create new agent skills using the upstream anatomy and local repository conventions. Use when a user asks to create, rewrite, or modernize a skill.
---

# Writing Skills

## Overview

Create production-ready skills that are easy for agents to route and easy for humans to maintain.
Preserve local conventions from `AGENTS.md` while applying the upstream anatomy sections.

## When to use

Use this skill when the user needs to:

- create a new skill directory and `SKILL.md`
- rewrite an existing skill to match current anatomy
- add support files (`REFERENCE.md`, `scripts/`) for progressive disclosure

## When not to use

Do not use this skill when:

- the request is only to execute an existing skill
- the task is a bug fix in product code unrelated to skill authoring
- the user needs only a ticket, PRD, or architectural decision document

## Common rationalizations

Reject these shortcuts:

- "I'll skip explicit triggers in description; the agent will infer it."
- "One giant SKILL.md is faster than splitting references."
- "A script is overkill even if logic is deterministic and repeated."
- "I can copy old structure; anatomy updates can wait."

## Red flags

Stop and correct course if you see:

- missing anatomy headings or collapsed sections
- vague description text that does not include concrete "Use when..." triggers
- speculative steps not grounded in the user's requested scope
- instructions that duplicate deterministic logic better stored in `scripts/`

## Verification

Use evidence-based checks before handing off:

1. **Anatomy present**: confirm `SKILL.md` contains all required headings in this order.
2. **Description quality**: verify first sentence states capability and second sentence starts with "Use when".
3. **Local conventions**: verify naming, file layout, and version/changelog updates match `AGENTS.md`.
4. **Deterministic logic placement**: verify repeated deterministic operations are implemented in `scripts/`.
5. **Proof of correctness**: run relevant repo tests/checks and cite exact command output, including explicit numeric results (for example, 2 passed, 0 failed) and explicit numeric exit code (for example, exit code 0), in your report.
6. **Description limits**: confirm front-matter description stays under 1024 characters and retains explicit "Use when..." trigger language.
