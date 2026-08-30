---
name: write-a-ticket
description: Write a well-structured ticket for an external issue tracker (e.g. Jira) that an engineer can act on without follow-up questions. Use when asked to "write a ticket", "file this in Jira", or "create a work item" — not for creating implementation tasks in a ralph/bd loop.
argument-hint: "The work to ticket: goal, epic/initiative, constraints, or paste a draft"
---

# Write a Ticket

## When to use

- Asked to "write a ticket", "file this in Jira", or "create a work item".
- Drafting an actionable work item for a human engineering audience in an external issue tracker (Jira, Linear, GitHub Issues).
- Checking an existing ticket for clarity before it goes to the team.

## When NOT to use

- Creating implementation tasks for the ralph/bd loop — those are beads executed by agents, not tickets read by engineers.
- Writing a requirements document for a feature that is not yet actionable — run `write-a-prd` first and link the PRD from the ticket.

## Workflow

1. **Gather context.** Confirm the goal of the work, the epic/RFC/initiative it belongs to (if any), known constraints or decisions, and relevant code locations, schemas, or prior art. Outcome: you can state the ticket's purpose in one sentence. If you cannot, ask before writing.

2. **Draft the ticket.** Work through the template below. Every section has a purpose — write it only if it earns its place, and never omit a required section without recording why.

```markdown
## Context

<1–3 sentences: why this work exists, and which epic/RFC/ADR it belongs to. Link to it — never copy-paste its content.>

## Description

<What to build or change. Describe the outcome, not the implementation steps, and state scope explicitly — what is in and what is out.>

## Acceptance criteria

- [ ] <Specific, independently verifiable criterion — e.g. "given X, the API returns Y">
- [ ] <...>

## Technical notes

<Links to relevant code, agreed schemas, architectural decisions, or upstream constraints. A pointer, not a design document — decisions that need more space belong in an ADR or RFC.>

## Testing strategy

<Optional. Only when testing needs are non-obvious or a level was agreed — unit, integration, contract, E2E. Omit when team defaults apply.>

## Monitoring strategy

<Optional. Only when the change adds metrics, alerts, log events, dashboards, or a phased rollout. Omit when there is no meaningful observability footprint.>

## Notes

<Optional. Genuinely useful details with no other home. If you reach for this often, restructure the ticket.>
```

3. **Review against the checklist.** Work through the verification checklist below before finalising.

## Red Flags

- Writing implementation steps into the description — describe the outcome, not the how.
- Acceptance criteria that cannot be verified: "works correctly", "is tested".
- Copy-pasting context instead of linking to the epic, RFC, or ADR.
- Padding sections with filler to look complete — a short, accurate ticket beats a padded one.
- Omitting a required section without recording why.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "The engineer will figure it out" | Skilled engineers can — but questions are a blocked ticket. The ticket must stand alone. |
| "More detail is safer" | Detail only helps if it informs the implementer. Every extra sentence is noise to skim. |
| "We will verify acceptance criteria in review" | Unverifiable criteria cannot be checked. Write given/outcome pairs instead. |
| "We will discuss the details in standup" | The ticket is the record. If it cannot stand alone, the discussion is lost. |

## Philosophy / rationale

- **Write for clarity, not coverage.** A ticket is not a specification. One well-chosen sentence beats three that say the same thing.
- **Describe the outcome, not the implementation.** The ticket owns the what and why; the implementer owns the how.
- **A ticket must stand alone.** Link, don't copy — readers who need the full rationale should open the linked document, not a paraphrase.

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Tone, structure, and concision for human-facing writing | `style-comms` |
| A requirements document that precedes the ticket | `write-a-prd` |

## Examples

### Vague vs verifiable acceptance criteria

| Instead of… | Write… |
|---|---|
| "The export feature works" | "Given exports enabled, selecting 'Export CSV' downloads `<account>-export-<date>.csv`" |
| "Adds tests for the new endpoint" | "POST /v1/orders returns 201 with the created order for valid input and 422 with field errors for schema violations" |

### Context that links vs context that copies

| Instead of… | Write… |
|---|---|
| Four paragraphs paraphrasing the ADR | "Follows ADR-014 (token refresh). This ticket adds only the retry path — see ADR link." |

## Verification checklist

- [ ] Context explains why the work exists; the reader needs no other tab open
- [ ] Description states the outcome, not implementation steps, and defines scope
- [ ] Acceptance criteria are independently verifiable — no "works correctly" or "is tested"
- [ ] Technical notes link to code or schemas without prescribing the solution
- [ ] Testing/Monitoring/Notes present only when they add non-obvious information
- [ ] Every sentence passes the "does this add information?" test
- [ ] A skilled engineer can start immediately with zero follow-up questions