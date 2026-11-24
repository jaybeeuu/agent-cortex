---
"@jaybeeuu/agent-cortex": minor
---

`review-defects` now maps each review lens to the `defect:<class>` labels that lens may raise. The
class table gains a `Lens` column, so a rejection names the question that failed as well as the
class, and a new table states the question each lens owns. A lens with nothing to review closes with
its verdict and one line of evidence instead of skipping silently or inventing a finding, and the
coordinator merges duplicate findings, cites the lens behind each, and may not overrule a lens to let
a bead through. The vocabulary stays closed: a finding no class covers, or no lens's question
answers, is `defect:unclassified` plus a bead filed against this skill.

`review-report` prints a rejections-by-lens section, so a lens that keeps rejecting is visible as the
thing to change — the brief that lens applies, or the skill its classes name — rather than the beads
it rejected. The grouping is read from the skill's own lens table and class column, so the words a
reviewer applies and the counts the report prints cannot drift apart; a class mapped to a lens the
skill does not document fails the run rather than leaving every per-lens count silently. A baseline
written before these counts existed is reported as not comparable, not read as a row of zeros.
