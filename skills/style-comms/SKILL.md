---
name: style-comms
description: "Communication style for jaybeeuu. Use this before writing any external document — tickets, RFCs, PRDs, proposals, reports, or any written communication intended for others."
---

# Communication Style

## Structure

For specific content structure and templates, look for a `write-a-*` skill matching the document type (e.g. `write-a-ticket`, `write-a-prd`). Use it alongside this skill — it provides the template; this skill governs the style.

By default, or where there is not a "write-a-\*" template, use the following structure:

Lead with the ask — the question to answer or decision to make.

- **Informal documents**: one or two sentence TL;DR.
- **Formal documents**: a summary of no more than two paragraphs covering the purpose, key points, and conclusions. Background and detail follow.

Then use a triangular approach: start broad, move inward.

- Open with the widest context — why this matters, what problem space it sits in.
- Narrow progressively — from context to problem to proposed approach to specific detail.
- Put the most granular information last. Readers who only need the big picture can stop early.

## Tone And Length

- Be concise. Every sentence should earn its place.
- Prefer plain language over formal or corporate phrasing.
- State things directly. Avoid hedging, filler, and throat-clearing.
- Do not restate what was just said in different words.

## Lists

Use bullet points when items are genuinely enumerable and parallel. Do not use them as a default prose substitute.

- Good use: a list of constraints, a set of options, a series of discrete steps.
- Bad use: breaking a single flowing thought into three bullets, or bulleting every paragraph.

## Links And References

Include links to supporting documents, code, or prior decisions where they add genuine value — a related RFC, the relevant source file, a prior decision record. Add a **References** section at the end when there are supporting links which don't fit in the text, or to collate multiple links.

- Link to the specific location (e.g. code line or document section), not a top-level repo or doc root.
- Do not link things the reader can trivially find themselves.
- Do not pad a references section — if there is only one link, inline it instead.

## Examples

Use examples to illustrate complex ideas — code blocks, calculations with workings shown, concrete scenarios. Keep them short and immediately relevant.

- Code blocks must be under 15 lines.
- Every example must earn its place; remove it if the surrounding prose is already clear.
- Show only what is needed to make the point — no scaffolding, no preamble, no trailing explanation of what the example just showed.

## What To Avoid

- Preamble that restates the document title or the obvious context.
- Padding phrases: "It is worth noting that…", "As mentioned above…", "In order to…"
- Over-structured documents where every sentence becomes a heading or bullet.
- Vague problem statements — be specific about what is broken, missing, or needed.
