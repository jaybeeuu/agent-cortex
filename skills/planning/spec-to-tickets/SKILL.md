---
name: spec-to-tickets
description: Turn a PRD, RFC, or spec into an agreed map of tickets, then draft each ticket body with the human in dependency order. Use when the user says "break this spec into tickets", "turn this RFC into tickets", or "map out the work".
argument-hint: "The spec to decompose (path or link) and the target tracker"
---

# Spec to Tickets

Turn one spec into a reviewed graph of tickets. The map is agreed before any body is
written, and each body is drafted with the human in dependency order.

## When to use

- A PRD, RFC, ADR, or spec is approved and needs to become tickets in a tracker.
- The user says "break this spec into tickets", "turn this RFC into tickets", or "map out the work".
- A large change needs a dependency graph before anyone starts implementing.

## When NOT to use

- A single ticket — use `write-a-ticket` directly.
- Decomposition into beads for the ralph/bd loop — use `prd-to-tasks`.
- No spec exists yet — use `write-a-prd` or `grill-with-docs` first.

## Philosophy / rationale

- **Agree the graph before the bodies.** Granularity decisions invalidate bodies, so the human approves titles, edges, and scope first. Bodies are cheap to write once the graph is right.
- **The map is the review artefact.** A human can judge twenty one-line intents and their edges in a minute; they cannot judge twenty full ticket bodies.
- **One ticket at a time.** Drafting each body with the human keeps decisions in the open and stops a stale assumption from propagating across the graph.
- **Less is more.** Tickets stay scannable; the detail lives in the spec the ticket links to.

## Workflow

### Phase 1 — Ingest the spec

1. Confirm the spec is in context (file, link, or paste). If it is missing, stop and ask for it.
2. Identify the tracker and how tickets are created there — Jira, GitLab, GitHub, or beads, via CLI, MCP, or manual paste. Ask when unclear; the mechanism only affects Phase 5.
3. Explore the code the spec touches, enough to name the components each ticket will change. You cannot slice work you have not looked at.
4. Record the durable decisions that apply across every ticket — schema shape, API conventions, auth, shared models — so bodies link to them instead of repeating them.

### Phase 2 — Draft the ticket map

5. Slice the spec into tickets. Each ticket is a coherent unit of change one engineer can pick up and finish — not a layer, not a phase, not a week of work. Prefer more, thinner tickets.
6. For each ticket record a verb-first title, a one-line intent, the components it touches, and its `depends-on` edges.
7. Order the graph so dependencies come first, and mark the tickets that can run in parallel.

### Phase 3 — Agree the map

8. Write the map to `.agent-cortex/tickets/<spec-slug>-map.md` in the format from [REFERENCE.md](./REFERENCE.md), then present it. The map carries titles, intents, touchpoints, and edges — no bodies.
9. Walk the graph with the human: granularity (merge or split), ordering, parallelism, and what is out of scope entirely. Iterate until they approve. Draft no body before this gate passes.

### Phase 4 — Draft each body, in order

10. Walk the graph in dependency order. For each ticket, draft the body with `write-a-ticket` together with the human.
11. Settle every open question as you draft: resolve it, split a blocking spike ticket, or send the human to find the answer. A question stays open only if the human explicitly agrees — and then it is recorded under `Open questions` with an owner. Ship nothing unresolved that the human has not agreed to.
12. Confirm the body with the human before creating anything, then record the ticket's agreed ID in the map.

### Phase 5 — Create and backfill

13. Create the ticket through the agreed mechanism, using the confirmed body verbatim. [REFERENCE.md](./REFERENCE.md) lists adapter examples.
14. Backfill the real ID into the map and into downstream tickets' dependency references.

### Phase 6 — Report

15. Present the created tickets with their IDs, edges, and any spikes, and note which can start immediately.

Workflow at a glance:

```
[Spec: PRD/RFC/ADR]
        |
        v
[P1: Ingest + explore code]
        |
        v
[P2: Draft the ticket map]
        |
        v
[P3: Agree the map] --(revise)--> [P2: Draft the ticket map]
        |
     (approved)
        v
[P4: Draft each body] --(open)--> [Resolve / spike / ask]
        |
     (settled)
        v
[P5: Create + backfill IDs] --(more tickets)--> [P4: Draft each body]
        |
      (done)
        v
[P6: Report the graph]
```

## Red Flags

- **Drafting bodies before the map is agreed.** A granularity change rewrites bodies; agree the graph first.
- **Layer tickets.** "All the database work" is not a unit of change — every ticket should be independently useful.
- **Carrying an unagreed open question into a body.** Resolve it, split a spike, or get the human's explicit agreement to leave it open.
- **A missing `depends-on` edge.** Ordering is the point of the map; an unmodelled dependency surfaces later as a blocked engineer.
- **Fat tickets.** If a ticket is a week of work, split it.
- **Repeating shared context in every body.** Link the spec and the shared decisions once.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll create all the tickets, then refine" | Granularity is agreed first; bodies written before agreement get rewritten. |
| "The map is obvious — skip writing it down" | The map is the review artefact. The human approves a graph, not a scroll of bodies. |
| "I'll note the open question in the ticket" | Only with the human's explicit agreement. Otherwise resolve it or spike it — an unagreed question is a blocked implementer. |
| "One big ticket is simpler to track" | Big tickets hide scope and block parallel work. |

## Cross-skill references

- **`write-a-ticket`** — invoked for every body; owns the ticket quality bar.
- **`write-a-prd`** — use first when no spec exists.
- **`prd-to-tasks`** — use when the output is beads for the ralph/bd loop, not external tickets.
- **`style-comms`** — invoke when drafting the map's titles and intents.

## Examples

Input: an approved RFC with eight numbered requirements and a target GitLab project.
Output: a ticket map agreed in chat and written to `.agent-cortex/tickets/<slug>-map.md`,
then tickets created in dependency order with real IDs backfilled into the map.

## Phase-gate checklist

- [ ] Phase 1 complete: spec in context, tracker identified, code explored, shared decisions recorded.
- [ ] Phase 2 complete: map drafted with titles, intents, touchpoints, and edges.
- [ ] Phase 3 complete: map written to `.agent-cortex/tickets/` and approved by the human.
- [ ] Phase 4 complete: every body drafted with `write-a-ticket`, confirmed, and its ID recorded.
- [ ] Phase 5 complete: all tickets created and IDs backfilled into the map.
- [ ] Phase 6 complete: graph reported with IDs, edges, and spikes.

## Verification checklist

- [ ] No body was drafted before the map was approved.
- [ ] Every ticket is a coherent unit of change, not a layer or a phase.
- [ ] Every dependency is modelled as a `depends-on` edge in the map.
- [ ] Every ticket body was drafted with the human and confirmed before creation.
- [ ] Every open question shipped was explicitly agreed by the human and has an owner.
- [ ] Real ticket IDs were backfilled into the map and downstream dependencies.
- [ ] The map file exists at `.agent-cortex/tickets/<spec-slug>-map.md`.
