---
name: write-a-ticket
description: Write a well-structured ticket for an external issue tracker (e.g. Jira) aimed at skilled human engineers. Use when asked to "write a ticket", "create an issue", "open a Jira item", or draft work for a human engineering audience — not for creating implementation tasks in the ralph/bd loop.
---

# Write a Ticket

Tickets are for skilled engineers: they should be able to pick one up, understand the context immediately, know where to start, and deliver the right outcome without asking questions or wading through noise.

Write for clarity, not coverage. A ticket is not a specification — prefer one well-chosen sentence over three that say the same thing.

## When to use

- Asked to "write a ticket", "create an issue", "open a Jira item", or "file a bug" in an external tracker.
- Drafting any work item for a human engineering audience in an external issue tracker.

## When NOT to use

- Creating implementation tasks for the ralph/bd loop — use `create-task` instead.
- Writing product requirement documents — use `write-a-prd` instead.
- Capturing early-stage ideas that are not ready to build — use `record-idea` instead.
- Tickets for non-engineering audiences — a different structure would communicate better.

## Philosophy / rationale

- A ticket is the boundary between planning and doing: its job is to make the next engineer productive, not to archive the conversation that produced it. This is why linking beats copy-pasting — linked sources keep one version of the truth.
- Concision is a form of respect. Engineers skim; short, decision-dense tickets let the signal survive the skim. Padding reads as a lack of understanding of what matters.

## Workflow

1. Gather context: the goal of the work, the owning epic/RFC/initiative, any agreed constraints or decisions, and relevant code locations, schemas, or prior art. Ask the user anything still unclear before drafting.
2. Draft the ticket using the template below. Every section has a purpose — do not pad it, and do not omit a required section without a good reason.
3. Review the draft against the Verification checklist before finalising.

## Red Flags

- **Padding sections to look thorough.** A padded "Context" or "Notes" buries the signal the reader needs.
- **Copy-pasting epic or RFC content.** Duplicated content drifts; link to the source instead.
- **Implementation steps in Description.** The ticket describes the outcome; the implementer chooses the how.
- **Acceptance criteria that cannot be verified.** "Works correctly" and "is tested" are not criteria.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "The more detail, the better" | More words mean more noise. Every sentence must earn its place. |
| "I'll paste the conversation so nothing is lost" | The reader needs the decisions, not the journey. |
| "It's a small ticket — skip the review" | Small tickets are where the signal is most easily buried. Apply the same checklist. |
| "The team convention is to include this section" | Sections exist to communicate, not to satisfy a template. Omit when they add nothing. |

## Template

```markdown
## Context

<1–3 sentences: why this work exists and what larger initiative it is part of.
Link to the epic, RFC, ADR, or prior ticket — do not duplicate their content.>

## Description

<What needs to be built or changed. Describe the outcome, not the implementation
steps. Be specific about scope — what is in and what is explicitly out.>

## Acceptance criteria

- [ ] <Specific, verifiable criterion>
- [ ] <Specific, verifiable criterion>

## Technical notes

<Links to relevant code, agreed schemas, or architectural decisions the
implementer should know. This is a pointer, not a design document — decisions
that need more space belong in an ADR or RFC.>

## Testing strategy

<Optional. Include only when this change has non-obvious testing requirements
or a specific testing agreement was reached.>

## Monitoring strategy

<Optional. Include only when the change has a non-obvious observability
footprint: new metrics, alerts, log events, dashboards, or a phased rollout.>

## Notes

<Optional. Anything genuinely useful that fits nowhere else. If you reach
here often, the ticket probably needs restructuring.>
```

## Section guidance

| Section | Job | Rule |
|---|---|---|
| Context | Explain why | One to three sentences; link, never copy-paste. |
| Description | State what, not how | Name scope boundaries explicitly ("does not include X"). |
| Acceptance criteria | Be independently verifiable | "Given X, the API returns Y"; avoid "works correctly". |
| Technical notes | Point, don't design | A tricky location, an agreed schema, an upstream constraint. Not a tutorial, not undecided decisions. |
| Testing strategy | Flag unusual needs | Omit when the team's default testing conventions apply. |
| Monitoring strategy | Flag observability needs | Omit when the change has no meaningful production footprint. |
| Notes | Catch-all | Frequent use means the ticket needs restructuring. |

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Implementation tasks for the ralph/bd loop | `create-task` |
| A product requirements document | `write-a-prd` |
| Early-stage idea capture | `record-idea` |

## Examples

See `EXAMPLES.md` for before/after rewrites of vague acceptance criteria and padded Context sections.

## Verification checklist

- [ ] A skilled engineer could start immediately with no follow-up questions
- [ ] Every sentence earns its place — nothing pads
- [ ] Acceptance criteria are specific and verifiable, not vague
- [ ] Technical notes point at the right things without over-prescribing the solution
- [ ] Epic/RFC content is linked, not copy-pasted
- [ ] Testing and monitoring sections included only when they add information