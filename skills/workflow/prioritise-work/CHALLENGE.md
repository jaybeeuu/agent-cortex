# A challenged priority

Detail behind `SKILL.md`. When the owner says "this should be higher", "that is not the priority",
or "why is this above that?", the queue is being challenged. Read this before you touch a score.

## A challenge is a strategy signal

A challenge does not mean one score is wrong. It means the rubric that produced the score is
wrong, stale, or has shifted: the owner is optimising something else this month, or the value
rule reads differently against this bead than the scorer read it.

So the reply is a **strategy review**, never an edit. The rule is one sentence, and every refusal
below enforces it:

> No score and no position moves without the strategy version moving first.

An ad-hoc override does not exist. The only way an item legitimately ranks higher is for a
sentence in the rubric to say why it should, so the next scorer reaches the same answer.

## The sequence

1. **Note the version you are challenging.** `node <skill-scripts>/strategy.mjs validate` prints
   `version N`. Keep `N`: it becomes `--from-version`, and it is what proves the rubric moved.
2. **Write down the order before.** The candidate bead ids, highest first, comma-separated. This
   is the baseline the diff is taken against.
3. **Read the challenge back as a claim about one section.** Which section disagrees — the theme,
   the value rule, the confidence rule, the effort anchor? Ask; do not guess.
4. **Offer the interview.** Say plainly that the order is produced by the rubric, so a reorder
   means a rubric change, and ask the questions in `SKILL.md` § Workflow, "Later runs".
5. **Decide.** The rubric changes, or it stands. Both are legitimate outcomes; see below.
6. **Re-rank** against the rubric as it now reads.
7. **Record** the challenge on the bead, and show the owner what moved.

## Outcome: the rubric changed

Edit the sections the interview changed, then bump with the reason. A bump without a reason is
refused, because a version that moved with no recorded reason is a change nobody can review.

```bash
node <skill-scripts>/strategy.mjs bump --reason "review turnaround is the theme now"
```

That writes the version, the date, and one change-log line. Then re-rank and record:

```bash
node <skill-scripts>/challenge.mjs record --bead agnt-ctx-abc.1 \
  --challenge "the review queue should be above the installer fix" \
  --resolution changed \
  --reason "review turnaround is the theme now" \
  --from-version 3 \
  --before agnt-ctx-abc.1,agnt-ctx-abc.2,agnt-ctx-def.1 \
  --after agnt-ctx-def.1,agnt-ctx-abc.1,agnt-ctx-abc.2 \
  --out /tmp/challenge-entry.txt
bd note agnt-ctx-abc.1 --file /tmp/challenge-entry.txt
```

`--out` writes the entry to a file, so the tracker appends it as data. Never paste the entry into
a shell string: it repeats the words the human used, and a quote in those words would end the
quoting early. `bd note agnt-ctx-abc.1 "$(cat /tmp/challenge-entry.txt)"` is equally safe, because
a command substitution is data and nothing in the entry runs or expands twice. `record` also prints
the movement, which is what you show the owner:

```
[2026-12-01T09:30:00.000Z] [challenge] trail:2f9c4b1e7a3d5c60
Outcome: done
Evidence: challenged "the review queue should be above the installer fix"; strategy v3 → v4
(updated 2026-12-01); rubric reason: review turnaround is the theme now; order 3 items, 2 moved:
agnt-ctx-def.1 #3→#1, agnt-ctx-abc.1 #1→#2
What is left: nothing — scores are re-ranked against strategy v4
```

## Outcome: no change to the rubric

Valid, and common: the rubric already answers the challenge, or the owner decides the challenge
does not outweigh the theme. The order does not move either — nothing changed that could move it.

Record it anyway. An outcome that leaves no trace is a defect: the next session would rediscover
the same challenge, and the owner would see the same question asked again.

```bash
node <skill-scripts>/challenge.mjs record --bead agnt-ctx-abc.1 \
  --challenge "the review queue should be above the installer fix" \
  --resolution no-change \
  --reason "the value rule already requires a human gate, and the installer fix unblocks one" \
  --from-version 3 \
  --out /tmp/challenge-entry.txt
bd note agnt-ctx-abc.1 --file /tmp/challenge-entry.txt
```

The entry carries the words that raised the challenge and the reasoning that answered it, under
`Evidence`, so `bd show <bead>` recovers both. The strategy file is not touched.

## The refusals

`record` exits 1, writes nothing, and names the problem in four cases. Each is a shortcut worth
refusing:

| You tried | What it says |
|---|---|
| Reordered, rubric untouched | the order moved, but the strategy stayed at vN — a reorder without a rubric change |
| "changed" with no bump | resolution "changed", but the version did not rise (v3 → v3) |
| "no-change" after a bump | the version moved (v3 → v4), so the resolution is "changed" |
| Challenged against a broken rubric | the strategy is not valid, so no score can be judged against it |

`validate` adds a fifth, after the fact, and it needs one surviving entry: the newest change-log
line must name the version the file carries, so a hand-raised version, or a bump whose log line was
deleted, fails the next validation. The section is optional, so a log emptied of every entry passes
— and `record` is what catches a silent reorder then, because it refuses an order that moved while
the version stayed put.

## How the order is computed

The order is a plain list of candidate bead ids, highest first — from a scorer when one produced
the queue, otherwise from re-reading the rubric yourself. `record` does not rank; it compares
positions, which is what makes the movement deterministic and repeatable:

- An id in both lists at a different position **moved**. Positions are 1-based, and the delta is
  old minus new, so a positive delta is upward movement.
- An id only in the new list is **new at** its position.
- An id only in the old list **dropped from** its position.

Moved items are reported in new-position order, then the arrivals, then the departures in
old-position order. The same two lists therefore print the same clause every time.

`--before` and `--after` are required for `changed`, because a recording that does not name what
moved does not show the owner the consequence. They are optional for `no-change`, where they can
only agree with each other — and are refused when they do not.

## Where each record goes

| Record | Lives in | Why |
|---|---|---|
| Why the rubric changed | the strategy file's change log, written by `bump` | a reviewer diffs it, and it is versioned next to the rubric |
| The challenge, its reasoning and the movement | the bead trail, written by `bd note` from `record` | it is the progress record for that one bead, and a cold session reads it from `bd show` |

Neither script writes to the other's store: `strategy.mjs` never calls the tracker, and
`challenge.mjs` never edits the strategy file. A challenge recorded on a bead is not a rubric
change, and a rubric change with no bead is not a challenge.
