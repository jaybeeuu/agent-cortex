---
name: style-documentation
description: Defines what to document, what to skip, and how to structure documentation for TypeScript projects. Use BEFORE writing or updating any documentation (READMEs, doc comments, guides), when reviewing existing docs for drift, or when setting up "documentation conventions".
---

# Documentation Style

## When to use

- Deciding whether to write or update documentation.
- Reviewing existing documentation for drift or completeness.
- Asked for a "docs review", "what should I document", or "documentation conventions".

## When NOT to use

- General writing tone, structure, and concision — use `style-comms` instead. This skill layers on top of it.
- Writing API reference docs that describe how a function works — that belongs in code comments, not a doc.

## Philosophy / rationale

- **The code is the documentation.** Written docs exist to capture what the code cannot communicate on its own. A reader who can read the code should not need the docs to understand *how* something works — only a brief orientation, *why* it works that way, what decisions shaped it, and how the pieces fit together at a high level.
- **Sparse docs maintained well beat comprehensive docs that drift.** Every word that falls out of sync with reality actively misleads. Fewer words, kept accurate, is a winning strategy.
- **Docs need grooming like code.** Each doc is a commitment to maintain. Prune outdated content, update what changed, delete what no longer serves. A doc that does not earn its keep should be removed.
- **Gift future engineers a starting point.** Write docs that point to the code and explain the journey that led to it, not that restate it.

## Workflow

1. **Find what already exists.** Search the project and wider knowledge base for relevant documentation — ADRs, READMEs, inline docs, `docs/` directories, and any team Confluence pages. A surprising number of documentation changes are updates to documents you forgot existed.

2. **Decide what action is needed.** Evaluate the subject against these criteria:
   - **Nothing changed, nothing missing** — leave it. Doing nothing is often the correct outcome.
   - **Something changed** — update the existing document. Add a sentence noting what changed and why.
   - **Existing doc is stale or misleading** — prune the outdated parts or delete it outright. Stale docs actively mislead; a deleted doc leaves a clean gap that someone will fill correctly.
   - **No documentation exists and a criterion below is met** — create something new.

   Only create new documentation when at least one of these is true:
   - A decision was made — why this approach over a reasonable alternative.
   - Macro behaviour changed — what the system now does that it didn't before, at a level above the code.
   - A constraint exists that isn't visible in the code — a trade-off, an upstream dependency, a known limitation.
   - No orientation exists for this area — add a brief overview covering intent, purpose, and how it fits into the wider system.

3. **Choose the smallest viable change.** The order of preference is:
   - Update an existing document.
   - Add a single well-placed sentence.
   - Add a paragraph.
   - Add a new section.
   - Create a new file (last resort — only when no suitable home exists).

4. **Write for the reader who knows the code.** Provide a brief orientation, explain the decisions, show how the pieces fit. Do not restate implementation detail — the code already does that.

5. **Keep it concise.** Use plain prose. Reserve bullet points for genuinely enumerable items. Do not use headings for documents shorter than three sections.

6. **Check tone and structure.** Invoke `style-comms` for guidance on tone, concision, and document structure. This skill governs *what* and *whether* to document; style-comms governs the *how*.

7. **Scan for secrets.** Run `review-security` before committing to catch any credentials, tokens, or real values that leaked into examples or sample configs.

## Red Flags

- **Documenting implementation detail.** If a reader can learn it in under a minute by reading the code, it doesn't belong in a doc.
- **Writing speculatively.** Decisions that haven't been made yet are aspirations, not documentation. They capture a wish, not reality.
- **Creating a new file unnecessarily.** A sentence in an existing document is cheaper to find, read, and maintain than a new file that fragments knowledge.
- **Documenting for the sake of it.** Docs, like code, carry a maintenance cost. Every doc must earn its place — and once written, it must be groomed, pruned, and kept accurate. A doc that drifts from reality is worse than no doc at all.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll add docs later" | If the context is fresh now, it's fresh. Later you will have forgotten the nuance. Write it now or don't. |
| "More docs is always better" | Every word that drifts from reality actively misleads. Sparse accurate docs beat comprehensive drift. |
| "This is obvious from the code" | Then do not write it. The code is the documentation — let it do the work. |
| "This doc is harmless even if it drifts" | Drift is not harmless — it erodes trust. Every stale sentence makes the reader wonder what else is wrong. Prune or update instead. |

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| Tone, structure, and concision for writing | `style-comms` |
| Code-level conventions and inline comments | `style-code` |
| Secrets and credential scanning before committing | `review-security` |

## Examples

### Decision documented vs aspirational

| Instead of… | Write… |
|---|---|
| "We may want to migrate to Kafka in the future." | "We chose RabbitMQ over Kafka because our throughput fits the simpler model and operational overhead was critical. See ADR-004 for the full tradeoff." |

### Brief orientation vs implementation restatement

| Instead of… | Write… |
|---|---|
| Three paragraphs on how `calculateFees` iterates over transactions and applies each rate tier | "Fees are computed per-transaction using tiered rates defined in `src/fees/rates.ts`. See the module docs for the exact logic." |

### Maintenance first

| Instead of… | Write… |
|---|---|
| Writing a new `docs/deployment-kubernetes.md` repeating steps already in `README.md` | Searching first, then adding a sentence to the existing "Deployment" section linking to the K8s manifests |
| Leaving a stale ADR that references a replaced approach | Pruning the outdated decision record or marking it superseded with a link to the replacement |
| Adding a new doc for a concept already partially covered in three places | Consolidating into one well-maintained location, deleting the others |

## Verification checklist

- [ ] Searched for existing documentation on the subject before writing
- [ ] Stale or misleading content was pruned or updated, not left to rot
- [ ] Documentation passes the "code can't communicate this on its own" test
- [ ] No implementation detail restated from the code
- [ ] No speculative or aspirational content about undecided features
- [ ] Uses the smallest viable change (existing doc → sentence → paragraph → section → new file)
- [ ] Tone and structure checked against `style-comms`
- [ ] Staged changes scanned with `review-security` for leaked secrets
