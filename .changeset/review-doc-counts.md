---
"@jaybeeuu/agent-cortex": patch
---

Correct two shipped-text contradictions in the review docs: a count word that the data beside it
disproved, and a promise the sibling file did not keep.

`review-report`'s trend example is headed "re-run after two more rejections" but prints eight class
deltas, and one label per rejection makes that eight rejections. The heading now says eight, and the
sample is the script's own output over a tracker that took eight more rejections: eight classes
moved, the other four stayed, and the first-pass rate held because the rejections re-ran four
changes that already held a review cohort.

`review-defects` promised `EXAMPLES.md` carried "one real case per class". The file holds twelve
cases and eleven real observations, with `scope-creep` described as a situation because no recorded
case exists. The promise now says what the file delivers rather than inventing a case to satisfy it.
