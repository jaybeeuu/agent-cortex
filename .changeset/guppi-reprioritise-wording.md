---
"@jaybeeuu/agent-cortex": patch
---

Say that guppi recomputes the order **in a reprioritisation**, instead of "never recomputes it" as a
flat ban.

`prioritise` is the score-then-rank sequence, so guppi does in fact rescore and re-rank — on request,
through the skill, with the change recorded by `strategise`. The old wording read as a prohibition on
the one operation the reprioritisation path exists to perform, and someone following the boundary
literally would refuse a request the skills support.

The boundary now says guppi reports the stored order, and that a different order is a reprioritisation
rather than a silent reorder. README's guppi section carries the same correction.
