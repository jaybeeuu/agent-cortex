---
name: write-a-ticket
description: Write a clear, reviewable ticket for an external issue tracker (Jira, Linear, GitLab, GitHub Issues) that an engineer can act on without follow-up questions. Use when asked to "write a ticket", "file this in Jira", or "create a work item" — not for beads in a ralph/bd loop.
argument-hint: "The work to ticket: goal, epic/initiative, constraints, or paste a draft"
---

# Write a Ticket

## When to use

- Asked to "write a ticket", "file this in Jira", or "create a work item".
- Drafting an actionable work item for a human engineering audience in an external tracker.
- Reviewing an existing ticket for clarity before it goes to the team.

## When NOT to use

- Breaking a whole PRD/RFC/spec into many tickets — use `spec-to-tickets`, which calls this skill per ticket.
- Creating implementation tasks for the ralph/bd loop — those are beads executed by agents; use `prd-to-tasks` or `create-task`.
- Writing a requirements document for work that is not yet actionable — run `write-a-prd` first.

## Workflow

1. **Gather context.** Confirm the goal, the parent ticket or epic, the spec it follows, the decisions already made, and the entry point in the code. Outcome: you can state what this ticket does in one sentence. If you cannot, ask before writing.

2. **Settle open questions.** Resolve every question with the human while drafting. When a question cannot be resolved now, split a blocking spike ticket and depend on it, or ask the human to find the answer. A question may stay in the body only when the human explicitly agrees to leave it open — record it under `Open questions` with the owner of the answer. Ship no question the human has not agreed to.

3. **Draft the body** from the template below, then check it against the format rules and the verification checklist.

4. **Hand over the draft.** Present the body for review and get the human's agreement before it is created or filed. The draft is the review artefact — nothing reaches the tracker unseen.

```markdown
## Context

<1–5 sentences of pointers: parent ticket or epic, where the approach lives
(RFC/ADR section), the decisions already made, and what this depends on.
Reference these — do not explain them.>

## Description

<2–4 sentences. What this ticket does and the behaviour it produces — the goal,
stated as the lead-in to the scope bullets. Leave detail to the sections below.>

## In scope

- <a distinct deliverable this ticket owns>
- <...>

## Out of scope

- <adjacent work explicitly not included — name the ticket that owns it where known>

## Acceptance criteria

- [ ] <independently verifiable check>
- [ ] <...>

## Testing approach

<Optional. Which specs, what they assert, and any setup gotcha. Omit when team
defaults apply.>

## Technical notes

- **Entry point:** `path/to/file.ts:42` (`symbol`, `symbol`)
- <a decisive fact: a signature that changes, a library or convention to follow,
  a field injected elsewhere>

## Open questions

<Optional, and only when the human has explicitly agreed to leave a question
open. One bullet per question, each naming who owns the answer. Omit this
section when there are none.>
```

### Format rules

- **Link, don't copy.** Reference the spec by link or section; never paraphrase it. A reader who needs the rationale opens the source.
- **Point at the entry, not the inventory.** Technical notes lead with the entry point — 1–3 links to where the work begins — plus only the facts that change how it is done. A full list of touched files means you have written the code in prose.
- **Scope is the contract.** In scope and Out of scope say what the ticket owns; Technical notes only show where to begin.
- **Every bullet is a distinct deliverable or check.** Merge any two that restate each other, and cut any that add neither.
- **Bullets over paragraphs, and no tables in the body** — trackers render tables inconsistently and they are slow to scan.
- **Budgets are guidance, not limits.** Context ≤ 3 sentences; Description ≤ 4 sentences; In scope ≤ 8 bullets; Out of scope ≤ 6 bullets; Acceptance criteria ≤ 12 items; Technical notes ≤ 6 bullets. Extend a section when the work genuinely needs it — a larger scope, or detail that makes the goal clearer — but treat that as the exception, not the rule. Aim for the smallest body that is still complete.

## Red Flags

- Writing the code in prose — listing every file touched, or stepping through the edits.
- A Description that explains the RFC or the deliberation instead of stating what this ticket does.
- Acceptance criteria that cannot be verified: "works correctly", "is tested".
- Padding a section to reach a budget, or exceeding one without the work to justify it.
- Copy-pasting spec content instead of linking to it.
- Leaving a question, `TBD`, or "we need to decide" in the body when the human has not agreed to it — an unagreed open question is a blocked implementer.

## Common Rationalizations

| Rationalization                              | Rebuttal                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| "The engineer will figure it out"            | Skilled engineers can — but questions are a blocked ticket. The ticket must stand alone.                                          |
| "More detail is safer"                       | Detail helps only if it informs the implementer. Every extra sentence is noise to skim.                                           |
| "The reviewer should see every file touched" | The reviewer needs the scope and somewhere to start, not an inventory. The implementer finds the rest.                            |
| "I'll flag the open question in the ticket"  | Only if the human agrees to leave it open. Otherwise resolve it or split a spike — an unagreed question is a blocked implementer. |

## Philosophy / rationale

- **Write for clarity, not coverage.** Every line carries a fact; a long ticket of facts beats a short one of filler. Aim for the smallest body that is still complete, and extend a section only when the work demands it.
- **Scope is the contract.** In scope and Out of scope make the boundary reviewable at a glance.
- **Describe the behaviour, not the implementation.** The ticket owns the what and why; the implementer owns the how.
- **A ticket must stand alone.** Link, don't copy — readers who need the full rationale open the linked document, not a paraphrase.

## Cross-skill references

| When you need…                                          | Use this skill    |
| ------------------------------------------------------- | ----------------- |
| To break a spec into a map of tickets                   | `spec-to-tickets` |
| Tone, structure, and concision for human-facing writing | `style-comms`     |
| A requirements document that precedes the ticket        | `write-a-prd`     |

See [EXAMPLES.md](./EXAMPLES.md) for worked before/after rewrites.

## Verification checklist

- [ ] Context points at the parent, the approach, and the dependencies without explaining them
- [ ] Description states the goal and behaviour and leads into the scope bullets
- [ ] In scope and Out of scope are explicit, with every bullet a distinct deliverable
- [ ] Acceptance criteria are independently verifiable and none restate another
- [ ] Technical notes lead with the entry point and give only decisive facts
- [ ] Testing approach and Technical notes appear only when they add non-obvious information
- [ ] Every section is within its guidance budget, or the extra is justified by the work
- [ ] Any open question is one the human explicitly agreed to, listed under `Open questions` with an owner
- [ ] A skilled engineer can start immediately with zero follow-up questions
- [ ] The human reviewed the drafted body before it was created
