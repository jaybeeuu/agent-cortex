---
name: score-bead
description: Scores one bead RICE-style against the committed strategy and stores the components, total, confidence, rationale and strategy version in its metadata, then proposes a priority band for review. Use when a bead is unscored, when asked to "score this bead", "rank this work", or "what priority should this be".
---

# Score Bead

Owns two things about one bead: the **RICE record** in its metadata, and a **band proposal** for its priority. The rubric the numbers are judged against is not this skill's — `prioritise-work` owns the strategy file, validates it and versions it.

Score and band are two steps on purpose. `score` writes an auditable record; `band` only reads it and prints a proposal. A score is a judgement, so the priority it implies is reviewed before it lands. A script that re-prioritised the backlog silently would remove the review, not save it.

## When to use

- A bead appears in a queue with no `rice` metadata, or with a `strategyVersion` older than the strategy file.
- "Score this bead", "rank this work", "is this a P1?", "what priority should this be".
- Before dispatching work: an unscored bead cannot be compared with a scored one.

## When NOT to use

- Setting or updating the strategy — use `prioritise-work`. This skill reads the rubric and never writes it.
- Recording an idea for later — use `record-idea`.
- Changing where a bead's state lives — use `bd-tool`.
- Ordering the whole backlog into one list — that is the queue's job; this skill scores one bead.

## The record

`score` writes one metadata key, so a reader greps one key instead of parsing the bead:

```json
{"rice":{"reach":4,"impact":3,"confidence":0.7,"effort":2,"score":4.2,
         "strategyVersion":2,"assessedAt":"2026-11-14T09:00:00.000Z",
         "rationale":"unblocks the messaging epic — Current themes"}}
```

Components and total are both stored, so a reader can redo the arithmetic. The full shape, the band table and the rationale trail are in [FORMAT.md](FORMAT.md).

## Workflow

1. **Check the strategy is valid.** Load `prioritise-work` and run its validator:

```bash
node <skill-scripts>/../../prioritise-work/scripts/strategy.mjs validate
```

A missing or malformed strategy stops here. `score` refuses in that state and writes nothing, so fixing the rubric is the only useful next action. The path above is the default (`.agent-cortex/working-docs/strategy.md` relative to the repository root); pass `--file <path>` to `score` when the repository keeps it elsewhere, and the same `--file` to the validator.

2. **Judge the four components against the strategy.** Each number must trace to a section of the rubric, and the rationale names that section.

| Component | What it measures | Watch for |
|---|---|---|
| `reach` | How much work this changes — how many workflows, beads or users | Counting the author once, not the repeated cost |
| `impact` | How much each unit of reach gains, on the rubric's own scale | A number the rubric does not define |
| `confidence` | How sure the estimate is, as a probability `0..1` | A guess presented as a figure |
| `effort` | Cost, on the effort calibration the rubric anchors | An effort that is a wish |

3. **Record a confidence figure you can defend.** Use `0..1`, and let the rationale say what the evidence is and what is missing. `0.5` with "no comparable work yet" is honest; `0.9` with no evidence is a guess wearing a number. When you cannot estimate at all, lower the figure and name the gap rather than inflating it.

4. **Score the bead.** One command, one record:

```bash
node <skill-scripts>/rice.mjs score <bead-id> --reach 4 --impact 3 --confidence 0.7 \
  --effort 2 --rationale "unblocks the messaging epic — Current themes"
```

It computes `reach × impact × confidence ÷ effort` to one decimal, records the strategy version it validated, and writes the record with `bd update <id> --metadata`. It writes nothing when the strategy is missing or invalid, and nothing when a component falls outside its range.

5. **Read back what landed.** `bd show <bead-id>` renders the `METADATA` block: the components, the total, the version and the rationale. Confirm the arithmetic before you trust the score.

6. **Propose a band.** Separate command, read-only:

```bash
node <skill-scripts>/rice.mjs band <bead-id>
```

It prints `score 4.2 → P2 (currently P3)` and the exact command that would apply it.

7. **Apply the band only after review.** Show the proposal — score, current priority, proposed priority, and the rationale — and run the printed `bd update <bead-id> -p <n>` only when the owner accepts it. Skip the step when the proposal equals the current priority.

## Re-scoring keeps the history

When the strategy version moves, re-score the bead. The new record carries the new `strategyVersion`, and the rationale keeps a `[prior]` line for every score it replaced — old score, components, version and date. The mechanism is the rationale text itself, not a second field: one record then holds both the current argument and its trail, and `bd show` renders all of it.

So a re-score never needs a note to explain the change. Write the new rationale, score, and read the trail back to confirm the old total survived (see [FORMAT.md](FORMAT.md) for the rendered shape).

## Priority is an output of review, not of arithmetic

- **A band is a proposal.** The script never runs the update it prints; step 7 does, and only on acceptance.
- **P0 is an incident.** A score never produces P0, and `band` refuses a bead that is already at P0 without proposing anything. An incident is declared by a person and cleared by a person; a rubric that could compute one would let a high-impact feature hide a production failure.
- **A previous priority stays readable.** The rationale carries the scores a band decision was made from, so a reader sees why the priority moved.

## Red Flags

- Red flag: writing a confidence number with no evidence behind it, because the field needs a value.
- Red flag: applying a band yourself, in the same breath as proposing it, so no review happens.
- Red flag: scoring against a strategy whose `validate` was never run — the record then cites a version nobody checked.
- Red flag: re-scoring and dropping the `[prior]` trail, so the priority change has no recorded reason.
- Red flag: raising a P0 bead to make a queue look tidy.

## Verification checklist

- [ ] `strategy.mjs validate` exited 0 before the score ran.
- [ ] `bd show <id>` shows a `rice` key whose components reproduce the total: `reach × impact × confidence ÷ effort`, one decimal.
- [ ] The recorded `strategyVersion` equals the file's version after validation.
- [ ] The rationale names the strategy section each component rests on, and the confidence is a figure the evidence supports.
- [ ] A re-score carries a `[prior]` line for the score it replaced.
- [ ] The band proposal was accepted by a reviewer before the priority changed, and no P0 bead was touched.

## See Also

- [prioritise-work](../../workflow/prioritise-work/SKILL.md) — owns the strategy file; run its `validate` before any score.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — where the record lives, and why a bead holds operational state rather than the rubric.
