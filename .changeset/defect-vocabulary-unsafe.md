---
"@jaybeeuu/agent-cortex": minor
---

Extend the closed `defect:<class>` vocabulary in `review-defects` with four classes, so a reviewer
never has to force-fit a finding into a class that does not describe it.

`defect:unsafe-instruction` covers shipped text that, followed on an arbitrary machine, could
destroy data or run something dangerous: destructive commands, force-pushes, credential handling,
overwriting user config. `defect:ambiguous-rule` covers wording a reasonable agent reads two ways,
especially a phrase true of one context that reads as true of another. `defect:silent-degradation`
covers a path that fails quietly or passes vacuously: a skipped check reported as success, a null
mapping silently dropping a token, a guard that cannot fail. `defect:unclassified` is the escape
hatch for a finding that matches no class.

The table gains a **Distinct from** column, because the near neighbours are where a misclassification
happens: drift is *stale*, while ambiguity is *readable two ways*; `test-cannot-fail` is one
assertion that cannot bite, while silent degradation is any path that cannot report.

`defect:unclassified` carries an obligation rather than being a pass: the reviewer says no class
fits in the rejection text, files a bead proposing the class with the finding as its case, and names
that bead. Without the gap bead the label degrades the aggregate silently, which is the failure the
class exists to prevent. The vocabulary stays closed — a class is added by changing the skill with
the owner, never invented inside a review.

`review-report` gains an owning-skill mapping for the four classes (the authoring skill for unsafe
and ambiguous text, the test and stage skills for a quiet path, and `review-defects` itself for an
unclassified finding), and `review-defects` gains one real worked example per new class.
