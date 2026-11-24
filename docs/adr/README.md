# Architecture decision records

One file per decision that is hard to reverse, surprising without context, and the result of a real
trade-off. `0001-four-lens-review.md` is the worked example of the shape.

Each record has `## Context` (the problem that forced the question), `## Decision` (the choice, stated
precisely), and `## Consequences` (what becomes easier or harder, and what a future reader must know).
Alternatives that were seriously weighed go in the record, because a decision without its rejected
options reads as the only one available.

A record states the decision, not the current state. When behaviour changes, the decision record stays
and the documents that describe the work change with it. Superseding a decision means a new record
that names the one it replaces, not an edit to the old one.
