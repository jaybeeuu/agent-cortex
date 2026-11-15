---
name: prioritise
description: Runs the score-then-rank sequence over a backlog — validate the strategy, score each bead, then print the queue — and refuses to rank on a missing or invalid strategy. Use when asked "what should I work on next", "rank this work", "prioritise the backlog", or before dispatching work that needs an order.
---

# Prioritise

Owns the **sequence** and the **guard** that turn a committed strategy into an order. It owns no rule of its own: the rubric is [strategise](../strategise/SKILL.md)'s, the RICE record is [score-bead](../score-bead/SKILL.md)'s, and the queue formula is [hitl-queue](../hitl-queue/SKILL.md)'s. Load this skill to know the order to run them in, and what to do when the first step fails.

Keep it that way. A second copy of the RICE formula or the deadline factors would drift from the skill that owns it, and two answers to "what is next" is worse than none.

## When to use

- "What should I work on next?", "prioritise the backlog", "give me the order".
- Before dispatching work: an order produced by an unvalidated rubric is not an order.
- A score or a queue run refused, and you need the step that unblocks it.

## When NOT to use

- Writing, editing or bumping the rubric — use [strategise](../strategise/SKILL.md). This skill reads it and never writes it.
- Scoring one bead in isolation — use [score-bead](../score-bead/SKILL.md).
- One ranked list across several scopes, or the daily note — use [hitl-queue](../hitl-queue/SKILL.md).

## The sequence

Three steps, in this order. Step one gates the other two.

### Step 1 — Validate the strategy (the guard)

```bash
node <strategise-scripts>/strategy.mjs validate
```

`validate` prints the rubric to stdout and exits `0` only when the file is valid. A non-zero exit stops the run here:

| Exit | The file | What to do |
|---|---|---|
| 0 | valid | Go to step 2. |
| 1 | absent or invalid | Stop. Report what `stderr` named — the missing file, the empty section, the field it could not read — and name `strategise` as the fix. |

**Refuse to rank in that state.** Do not score a bead, do not print an order, and do not substitute a remembered or guessed rubric. Every committed strategy on the machine depends on one validator, so a run that ranks past a failed `validate` produces an order nobody can review.

### Step 2 — Score each candidate

Load [score-bead](../score-bead/SKILL.md) and follow it, once per candidate bead. It reads the same rubric, writes one `rice` record per bead, and stores the `strategyVersion` it scored against. Do not restate its formula here.

Skip a bead whose stored `strategyVersion` already matches the file's current version: the record is current, and re-scoring it wastes a run.

### Step 3 — Rank

Load [hitl-queue](../hitl-queue/SKILL.md) and follow it. It prints one ordered list across every configured scope, applies the deadline factors, and quotes the daily line. Do not restate its formula here either.

Report the list as printed. A wish for a different order is a challenge to the rubric, which is [strategise](../strategise/SKILL.md)'s — see [CHALLENGE.md](../strategise/CHALLENGE.md) — never an edit to a score or a position.

## Red Flags

- Red flag: ranking on a strategy whose `validate` never ran, because the file "looked fine".
- Red flag: copying the RICE formula or the deadline factors into this skill instead of loading the skill that owns them.
- Red flag: moving one score to change the order. The order follows the rubric, so the rubric is what changes.
- Red flag: writing to the strategy file from here. Only `strategise` bumps the version.

## Verification checklist

- [ ] `node <strategise-scripts>/strategy.mjs validate` exited `0` before anything was scored or ranked.
- [ ] Each scored bead carries a `rice` record whose `strategyVersion` is the version `validate` printed.
- [ ] The order was reported from the `hitl-queue` run, not recomputed by hand.
- [ ] No strategy file was written by this run.

## See Also

- [strategise](../strategise/SKILL.md) — owns the strategy file, the interview, `validate`, `bump` and the challenge sequence.
- [score-bead](../score-bead/SKILL.md) — the RICE record and the band proposal for one bead.
- [hitl-queue](../hitl-queue/SKILL.md) — the queue formula, the deadline tiers, the scopes and the daily note.
