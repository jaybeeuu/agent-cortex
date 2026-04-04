---
name: style-documentation
description: "Documentation philosophy and style for jaybeeuu. Use this before writing, updating, or reviewing any documentation — including docs, ADRs, READMEs, and inline comments."
---

# Documentation Style

Documentation is written communication. Also invoke the `style-comms` skill — its guidance on tone, structure, and concision applies here too.

## Philosophy

**The code is the documentation.** Written docs exist to capture what the code cannot communicate on its own. A reader who can read the code should not need the docs to understand _how_ something works — only a brief orientation, _why_ it works that way, what decisions shaped it, and how the pieces fit together at a high level. We are gifting future engineers a starting point that points to the code and explains the journey that led to it, not restating it.

Sparse documentation maintained well is worth more than comprehensive documentation that drifts from reality.

## What To Document

Only write or update documentation when at least one of the following is true:

- **A decision was made** — why this approach over a reasonable alternative
- **Macro behaviour changed** — what the system now does that it didn't before, at a level above the code
- **A constraint exists that isn't visible in the code** — a trade-off, an upstream dependency, a known limitation a future engineer needs to know
- **No documentation exists for this area** — add a brief orientation covering intent, purpose, and how it fits into the wider system

Everything else — implementation detail, function signatures, data shapes, algorithmic steps — belongs in the code, not in a doc.

## What Not To Document

- How a function or module works internally
- Anything a reader can learn in under a minute by reading the code
- Decisions that haven't been made yet
- Aspirational or speculative behaviour

## Format And Length

- Prefer updating an existing document over creating a new one
- Prefer a single well-placed sentence over a paragraph
- Prefer a paragraph over a new section
- Prefer a new section over a new file
- Only create a new file if no suitable home exists

Use plain prose. Reserve bullet points for genuinely enumerable items. Do not use headings for documents shorter than three sections.

## When To Do Nothing

Leaving documentation unchanged is often the correct outcome. If no decision was made, no macro behaviour changed, and no invisible constraint was introduced, do not write anything. An unchanged doc is not a failure.
