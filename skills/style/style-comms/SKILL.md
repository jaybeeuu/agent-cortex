---
name: style-comms
description: Sets tone, structure, and concision rules for external-facing written communication. Use when you need a "style review", want to "make this clearer", or are writing tickets, RFCs, PRDs, proposals, or reports.
---

# Communication Style

## When to use

- Writing a ticket, RFC, PRD, proposal, report, or any document someone else will read.
- Reviewing a draft for tone, structure, or concision.
- Asked for a "style review", "make this clearer", or "is this well written?".

## When NOT to use

- Deciding *whether and what* to document — use `style-documentation` instead.
- Writing code or test code — use `style-code` or `style-tests` instead.

## Philosophy / rationale

- **Reader time is more valuable than writer time.** Every sentence you write costs the reader time to process. Make each one count.
- **Lead with the payoff because the reader's first question is always "why am I reading this?".** Put the key takeaway — whether it's a decision, a conclusion, a recommendation, or a summary — up front so they orient before diving into detail.
- **Triangular structure (broad → narrow) lets readers self-select depth.** A reader who only needs context stops early; one who needs specifics reads on. Both get what they need without friction.
- **Explicit language ages better than hedged language.** Hedging ("might", "potentially", "it could be") lets each reader fill in their own interpretation — which will differ from yours.

## Workflow

1. **Identify the audience and the ask.** Who is reading this, and what do they need to decide or know by the end? Write the ask down first.

2. **Lead with the payoff.** Open with the key takeaway — the decision needed, the conclusion reached, the recommendation, or a summary of findings.
   - Informal documents: one or two sentence TL;DR.
   - Formal documents: a summary of no more than two paragraphs covering purpose, key points, and conclusions.

3. **Structure with the triangular approach.** Start broad, then narrow progressively — from context to problem to proposed approach to specific detail. Put the most granular information last.

4. **Write with concision.** Every sentence must earn its place.
   - Prefer plain language over formal or corporate phrasing.
   - State things directly. Avoid hedging ("might", "potentially", "it could be said"), filler ("It is worth noting that…", "As mentioned above…"), and throat-clearing.
   - Do not restate what was just said in different words.
   - Do not open with a preamble that restates the document title or obvious context.

5. **Use lists, links, and examples intentionally.**
   - **Lists:** Use for genuinely enumerable, parallel items. Do not break a single flowing thought into bullets.
   - **Links:** Link to the specific location (code line, document section), not a top-level root. Do not link things the reader can trivially find. Add a **References** section at the end only when multiple links need collating — inline a single link instead.
   - **Examples:** Use to illustrate complex ideas — code blocks under 15 lines, calculations with workings, concrete scenarios. Remove if the surrounding prose is already clear. Show only what makes the point.

6. **Review against the checklist below.** Read the draft once as its intended audience before sending or committing.

## Examples

### Lead with the payoff

| Instead of… | Write… |
|---|---|
| "I've been looking at the current auth system and thinking about ways we could improve it. There are a few options to consider…" | "We need to decide between OAuth2 and SAML for the new API gateway. Here's the tradeoff." |

### Conciseness

| Instead of… | Write… |
|---|---|
| "It is worth noting that the database migration is something we should take into consideration at this point in time." | "The database migration is our next bottleneck." |

### Intentional lists

| Instead of… | Write… |
|---|---|
| "The system needs to be scalable. It also needs to be secure. And it also needs to be maintainable." | "Requirements: scalable, secure, maintainable." |

### Direct over hedged

| Instead of… | Write… |
|---|---|
| "This might potentially cause some issues that we could look at." | "This approach causes two problems: increased latency and a single point of failure." |

## Cross-skill references

| When you need… | Use this skill |
|---|---|
| A document template with section structure | `write-a-ticket`, `write-a-prd`, `write-a-skill` |
| Guidance on what and whether to document | `style-documentation` |
| Coding style and conventions | `style-code` |
| Test writing style | `style-tests` |

## Verification checklist

- [ ] Document opens with the key takeaway (decision, conclusion, recommendation, or summary)
- [ ] Triangular structure: broad context → narrow detail
- [ ] No hedging, filler, preamble, or restated document title
- [ ] Every sentence earns its place — nothing can be cut without loss
- [ ] Lists are parallel and genuinely enumerable
- [ ] Links point to specific locations, not top-level roots
- [ ] Examples are under 15 lines and show only what's needed
- [ ] References section used only for multiple links; single links are inlined
