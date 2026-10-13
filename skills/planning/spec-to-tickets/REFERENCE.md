# Spec to Tickets — Reference

Supporting formats for `spec-to-tickets`. Load this when writing the map, drafting tickets,
or creating them.

## Ticket map format

Written to `.agent-cortex/tickets/<spec-slug>-map.md` at Phase 3 step 8. `.agent-cortex/*`
is gitignored, so the map is a local review artefact — not a committed plan file.

```markdown
# <Spec title> — ticket map

- **Source:** <link or path to the PRD/RFC/spec>
- **Tracker:** <Jira | GitLab | GitHub | beads>
- **Status:** draft | agreed | created

## Shared decisions

- <schema/API/auth decision every ticket relies on, with a link>

## Tickets

| # | Title | Intent | Touches | Depends on | Ticket ID |
|---|---|---|---|---|---|
| T1 | Add grease sampling to the monitor | Read grease levels alongside oil on each poll | `src/monitor/` | — | — |
| T2 | Surface grease readings in the dashboard | Show grease next to oil on the status panel | `src/web/` | T1 | — |

## Ordering

T1 -> T2, T3    (T2 and T3 can run in parallel)

## Out of scope

- <work the spec mentions that these tickets deliberately exclude>
```

Set `Status` to `agreed` at Phase 3, and fill `Ticket ID` as each ticket is created in Phase 6.

## Ticket draft format

Written to `.agent-cortex/tickets/<spec-slug>/<NN>-<ticket-slug>.md` at Phase 4 step 10 —
one file per ticket, numbered in dependency order. Drafts are the review artefact for
Phase 5 and the source of the created ticket body.

```markdown
# <Ticket title>

- **Map ref:** T1
- **Depends on:** T2, T3
- **Ticket ID:** — (filled at creation)

---

<body from write-a-ticket>
```

Fill `Ticket ID` at Phase 6. Upload the body verbatim; record `Depends on` in the tracker's
own link or dependency field when it has one.

## Tracker adapters

The tracker and mechanism are chosen in Phase 1 step 2. These are illustrative examples,
not a fixed contract — confirm the real command or tool with the human before creating.

| Tracker | Example creation mechanism |
|---|---|
| GitHub | `gh issue create --title "<title>" --body-file <draft-body.md> --label <label>` |
| GitLab | `glab issue create --title "<title>" --description "<body>"` |
| Jira | the configured Jira CLI or MCP tool for issue creation |
| beads | `bd create "<title>" --description "<body>" --validate` |

Keep the approved draft verbatim — do not reformat it for the tracker. After creation,
copy the returned ID into the map's `Ticket ID` column, the draft's `Ticket ID` field, and
downstream `Depends on` cells.

## Worked run

Input: an approved RFC with eight numbered requirements and a target GitLab project.
Output: `.agent-cortex/tickets/checkout-v2-map.md` agreed in chat, eight drafts under
`.agent-cortex/tickets/checkout-v2/` reviewed as a set, then eight GitLab issues created in
dependency order with real IDs backfilled into the map and the drafts.
