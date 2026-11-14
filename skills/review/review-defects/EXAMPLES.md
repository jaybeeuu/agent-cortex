# Review defects — worked examples

One case per class. Each shows what was observed, the label, and the rejection text to write. The
first four were observed in real review rounds; the last four are described as situations so you
can match them without guessing at history.

## `test-unproven` — the name claims a settle-time cleanup

**Observed.** A test named "… removes it when the watch settles" called `stop()` and asserted the
entry was gone. It never settled the watch, so the settle path had no assertion. The cleanup on
settle could have been deleted and the test would still pass.

**Label.** `defect:test-unproven`

**Rejection text.** "Test `…removes it when the watch settles` claims removal at the settle step,
but the body stops the watch and asserts removal once. Add the settle trigger and assert the entry
is gone after it. Either the name or the assertion must change."

**Why this class.** Not `test-cannot-fail`: the assertion is genuine and would fail for the bug it
covers. The defect is narrower — the name promises a path the body never takes.

## `test-cannot-fail` — the concurrent case is never exercised

**Observed.** A note appended "a double fire appends nothing twice". The test fired twice in
sequence and asserted one entry. Two concurrent fires were never run, so the claim could not fail.

**Label.** `defect:test-cannot-fail`

**Rejection text.** "The claim is about concurrent double fires, but the test fires sequentially.
Await both fires against the same target and assert one entry, or rename the claim. As written no
implementation can fail it."

**Why this class.** Not `test-unproven`: the name and the assertion agree on "two fires produce one
entry". The gap is that the case the claim is about is never constructed.

## `missing-proof` — a report of a demonstration that was stubbed

**Observed.** A stage report stated "end-to-end run verified: the check writes the record and the
follow-up reads it". The command in the evidence block substituted a stub for the check, so no
end-to-end path ran.

**Label.** `defect:missing-proof`

**Rejection text.** "`SUMMARY` claims an end-to-end demonstration; the evidence command replaces the
check with a stub, so the record is written by the test, not by the code under review. Paste the
real invocation and its output."

**Why this class.** Nothing is missing from the code. The gap is between the claim and the evidence
for it, which is exactly what this class names.

## `docs-drift` — shipped text that shipped past its change

**Observed.** Two shipped text defects in one round: a token map named an exact harness version, so
the mapping broke on the next release; and a peer-channel section still said one harness only, after
the fork had made it both.

**Label.** `defect:docs-drift`

**Rejection text.** "The token map names an exact harness version — it must read the running one or
a documented default. The peer-channel section says one harness only, but the mapping now covers
both; update the prose to what ships."

**Why this class.** The shipped artefact and the text describing it disagree. A reviewer reading the
text would predict behaviour the install does not have.

## `criteria-unmet` — a criterion is partly delivered

**Situation.** A bead's criteria ask for a command that reports both a count and the failing paths.
The command reports the count and stops.

**Label.** `defect:criteria-unmet`

**Rejection text.** "Criterion 2 asks for the failing paths as well as the count; the output stops
at the count. Ship both, or say in the bead why the criterion changed."

**Why this class.** The work is real and the scope is honest — part of what was asked is absent.

## `scope-creep` — unrelated tidying rides along

**Situation.** A change that adds one label also renames three unrelated helpers and reformats a
neighbouring module.

**Label.** `defect:scope-creep`

**Rejection text.** "The rename and the reformat are outside the criteria. Split them into their own
change so this one can be reviewed and reverted on its own."

**Why this class.** Every line is defensible in isolation. The defect is that the change is wider
than its reason, which hides the real diff.

## `style-violation` — a stated rule is broken

**Situation.** A new CLI command calls a synchronous file read, while the project's rules forbid
blocking calls in tooling.

**Label.** `defect:style-violation`

**Rejection text.** "`readFileSync` breaks the no-blocking-calls rule. Use the async form and await
it."

**Why this class.** Cite the rule, not a preference. A reviewer who cannot quote a written rule has
a preference, and preferences are not rejections.

## `regression` — an existing behaviour breaks

**Situation.** The change adds an early return for empty input. A caller that relied on the
notification for empty input now silently does nothing, and its existing test fails.

**Label.** `defect:regression`

**Rejection text.** "`notify` on empty input used to fire; the new early return drops it, and
`notify-hook` fails. Preserve the old behaviour, or change the caller in the same change with a
test."

**Why this class.** The change may satisfy its own criteria fully. It also breaks behaviour nobody
asked to change, which is a separate fact from `criteria-unmet`.
