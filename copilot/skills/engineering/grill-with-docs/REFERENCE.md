# Grill-with-docs reference

Rarely-needed detail the workflow points to when you must create or update project documents.

## Finding the domain model

### Single-context repos

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

### Multi-context repos

A `CONTEXT-MAP.md` at the root points to where each context lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/                      ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/             ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily — only when you have something to write. If no `CONTEXT.md` exists, create one when the first term resolves. If no `docs/adr/` exists, create it when the first ADR is needed.

## CONTEXT.md entry format

One `# term` heading per entry with a plain-prose definition and cross-links to related terms:

```md
# cancellation
An order may be cancelled only before fulfilment begins. See refund for the
post-fulfilment reversal path.
```

Rules:

- Glossary only — no implementation details, no specs, no scratch notes.
- Prefer one concise definition over long paragraphs.
- Cross-link related terms so the vocabulary is navigable.

## ADR format

One file per decision in `docs/adr/`, zero-padded sequence number plus kebab-case title:

```
0003-cancel-before-fulfilment-only.md
```

Structure:

```md
# Title

## Context
What problem forced the decision and why the question arose.

## Decision
The choice, stated precisely.

## Consequences
What becomes easier or harder as a result; what a future reader must know.
```

Offer an ADR only when all three hold — hard to reverse, surprising without context, real trade-off. If any is missing, skip it.