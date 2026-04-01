---
name: write-a-ticket
description: Write a well-structured ticket for an external issue tracker (e.g. Jira). Use when writing tickets intended for a human engineering audience — not for creating implementation tasks in a ralph/bd loop.
---

# Write a Ticket

Tickets are for skilled engineers. They should be able to pick one up, understand the context immediately, know where to start, and deliver the right outcome — without having to ask questions or wade through noise.

**Write for clarity, not coverage.** A ticket is not a specification. Prefer one well-chosen sentence over three that say the same thing.

---

## Process

### 1. Gather context

Before drafting, confirm you have:
- The goal of the work
- Which epic, RFC, or initiative this belongs to (if any)
- Any known constraints or decisions already made
- Relevant code locations, schemas, or prior art

If anything is unclear, ask before writing.

### 2. Draft the ticket

Use the template below. Every section has a purpose — do not pad it, and do not omit a required section without good reason.

### 3. Review against the checklist

Before finalising, check:
- [ ] Could a skilled engineer start this immediately with no follow-up questions?
- [ ] Is every sentence earning its place? Remove anything that doesn't add information.
- [ ] Are acceptance criteria verifiable, not vague?
- [ ] Do technical notes point at the right things without over-prescribing the solution?

---

## Template

```markdown
## Context

<1–3 sentences. Set the scene: why does this work exist, what larger initiative is it part of?
Link to the relevant epic, RFC, ADR, or prior ticket — don't duplicate their content here.>

## Description

<What needs to be built or changed. Describe the outcome, not the implementation steps.
Be specific about scope — what is in and what is explicitly out.>

## Acceptance criteria

- [ ] <Specific, verifiable criterion>
- [ ] <Specific, verifiable criterion>
- [ ] <Specific, verifiable criterion>

## Technical notes

<Links to relevant code, suggested request/response/document schemas, architectural decisions,
or guidance the implementer should know. This is a pointer, not a design document —
if a decision needs more space, it belongs in an ADR or RFC.>

## Testing strategy

<Optional. Agreed testing levels for this change: e.g. unit, integration, contract, E2E.
Only include if there is something non-obvious to say.>

## Monitoring strategy

<Optional. How will this change be observed in production? e.g. new metrics, alerts, log events,
dashboards, or feature flag rollout stages. Only include if the change has non-obvious observability
requirements or a specific rollout approach was agreed.>

## Notes

<Optional. Anything else that is genuinely useful and doesn't fit above.>
```

---

## Guidance per section

**Context** — one job: explain *why*. A reader should understand the motivation without opening another tab. Link freely; copy-paste never.

**Description** — describes *what*, not *how*. Avoid implementation steps. If scope boundaries matter, state them explicitly ("this ticket does not include X").

**Acceptance criteria** — must be independently verifiable. Avoid "works correctly" or "is tested". Prefer "given X, the API returns Y" or "the migration runs without errors on staging".

**Technical notes** — share what the implementer needs to know, not everything you know. Good candidates: a tricky code location, a schema that has already been agreed, a constraint from an upstream system. Bad candidates: a tutorial on the technology, decisions that haven't been made yet.

**Testing strategy** — omit if the team's default testing conventions apply. Include only when this ticket has unusual testing requirements or a specific agreement was reached.

**Monitoring strategy** — omit if the change has no meaningful observability footprint. Include when the ticket introduces new metrics, requires new alerts, involves a phased rollout, or has an agreed approach to validating success in production.

**Notes** — a catch-all for genuinely relevant information that has no other home. If you're reaching for it often, the ticket probably needs restructuring.
