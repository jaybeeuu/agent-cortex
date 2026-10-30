---
name: spec-to-tickets
description: Turn a PRD, RFC, or spec into an agreed map of tickets, then draft each ticket body with the human in dependency order. Use when the user says "break this spec into tickets", "turn this RFC into tickets", or "map out the work".
argument-hint: "The spec to decompose (path or link) and the target tracker"
---

# Spec to Tickets

Turn one spec into a reviewed graph of tickets. The map is agreed before any body is
written, the drafts are reviewed as a set, and only then are tickets created.

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
- **Draft everything, then create once.** Drafts are reviewable artefacts; tickets in a tracker are not. The human reads the whole set before anything is uploaded.
- **One ticket at a time, then all at once.** Draft each body with the human so decisions stay in the open; review the finished set together so the boundary between tickets is visible.
- **Less is more.** Tickets stay scannable; the detail lives in the spec the ticket links to.

## Workflow

### Phase 1 — Ingest the spec

1. Confirm the spec is in context (file, link, or paste). If it is missing, stop and ask for it.
2. Identify the tracker and how tickets are created there — Jira, GitLab, GitHub, or beads, via CLI, MCP, or manual paste. Ask when unclear; the mechanism only affects Phase 6.
3. Explore the code the spec touches, enough to name the components each ticket will change. You cannot slice work you have not looked at.
4. Record the durable decisions that apply across every ticket — schema shape, API conventions, auth, shared models — so bodies link to them instead of repeating them.

### Phase 2 — Draft the ticket map

5. Slice the spec into tickets. Each ticket is a coherent unit of change one engineer can pick up and finish — not a layer, not a phase, not a week of work. Prefer more, thinner tickets.
6. For each ticket record a verb-first title, a one-line intent, the components it touches, and its `depends-on` edges.
7. Order the graph so dependencies come first, and mark the tickets that can run in parallel.

### Phase 3 — Agree the map

8. Write the map to `.agent-cortex/tickets/<spec-slug>-map.md` in the format from [REFERENCE.md](./REFERENCE.md), then present it. The map carries titles, intents, touchpoints, and edges — no bodies.
9. Walk the graph with the human: granularity (merge or split), ordering, parallelism, and what is out of scope entirely. Iterate until they approve. Draft no body before this gate passes.

### Phase 4 — Draft every body

10. Walk the graph in dependency order. For each ticket, draft the body with `write-a-ticket` together with the human, and write it to `.agent-cortex/tickets/<spec-slug>/<NN>-<ticket-slug>.md` in the draft format from [REFERENCE.md](./REFERENCE.md). Create nothing yet.
11. Settle every open question as you draft: resolve it, split a blocking spike ticket, or send the human to find the answer. A question stays open only if the human explicitly agrees — and then it is recorded under `Open questions` with an owner. Ship nothing unresolved that the human has not agreed to.

### Phase 5 — Review the drafts

12. Present the whole draft set for one read-through: titles, bodies, and edges together, so the boundary between tickets is visible.
13. Iterate until the human approves the set. Nothing is created before this gate passes.

### Phase 6 — Create and backfill

14. Create each ticket through the agreed mechanism, using its approved draft verbatim. [REFERENCE.md](./REFERENCE.md) lists adapter examples.
15. Backfill the real ID into the map, the draft file, and downstream tickets' dependency references.

### Phase 7 — Report

16. Present the created tickets with their IDs, edges, and any spikes, and note which can start immediately.

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
[P4: Draft every body] --(open)--> [Resolve / spike / ask]
        |
      (drafted)
        v
[P5: Review the draft set] --(revise)--> [P4: Draft every body]
        |
     (approved)
        v
[P6: Create + backfill IDs]
        |
        v
[P7: Report the graph]
```

## Red Flags

- **Drafting bodies before the map is agreed.** A granularity change rewrites bodies; agree the graph first.
- **Creating before the draft set is reviewed.** Drafts are the review artefact; upload only what the human has read.
- **Layer tickets.** "All the database work" is not a unit of change — every ticket should be independently useful.
- **Carrying an unagreed open question into a body.** Resolve it, split a spike, or get the human's explicit agreement to leave it open.
- **A missing `depends-on` edge.** Ordering is the point of the map; an unmodelled dependency surfaces later as a blocked engineer.
- **Fat tickets.** If a ticket is a week of work, split it.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll create all the tickets, then refine" | Granularity is agreed first and drafts are reviewed before creation; tickets edited in the tracker leave the map stale. |
| "The map is obvious — skip writing it down" | The map is the review artefact. The human approves a graph, not a scroll of bodies. |
| "I'll note the open question in the ticket" | Only with the human's explicit agreement. Otherwise resolve it or spike it — an unagreed question is a blocked implementer. |
| "One big ticket is simpler to track" | Big tickets hide scope and block parallel work. |

## See Also

- [write-a-ticket](../write-a-ticket/SKILL.md) — invoked for every ticket body; owns the ticket quality bar.
- [write-a-prd](../write-a-prd/SKILL.md) — load first when no spec exists.
- [prd-to-tasks](../prd-to-tasks/SKILL.md) — load when the output is beads for the ralph/bd loop rather than external tickets.
- [style-comms](../../style/style-comms/SKILL.md) — load when the map's titles and intents read loosely.

## Phase-gate checklist

- [ ] Phase 1 complete: spec in context, tracker identified, code explored, shared decisions recorded.
- [ ] Phase 2 complete: map drafted with titles, intents, touchpoints, and edges.
- [ ] Phase 3 complete: map written to `.agent-cortex/tickets/` and approved by the human.
- [ ] Phase 4 complete: every body drafted with `write-a-ticket` and written to the draft directory.
- [ ] Phase 5 complete: the draft set was reviewed and approved as a whole.
- [ ] Phase 6 complete: all tickets created and IDs backfilled into the map and the drafts.
- [ ] Phase 7 complete: graph reported with IDs, edges, and spikes.

## Verification checklist

- [ ] No body was drafted before the map was approved.
- [ ] Every ticket is a coherent unit of change, not a layer or a phase.
- [ ] Every dependency is modelled as a `depends-on` edge in the map.
- [ ] Every draft exists under `.agent-cortex/tickets/<spec-slug>/` and was approved before creation.
- [ ] Every open question shipped was explicitly agreed by the human and has an owner.
- [ ] Real ticket IDs were backfilled into the map, the drafts, and downstream dependencies.
- [ ] The map file exists at `.agent-cortex/tickets/<spec-slug>-map.md`.
