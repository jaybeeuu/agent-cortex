# Review defects — worked examples

One case per class. Each shows what was observed, the label, and the rejection text to write. Eleven
were observed in real review rounds; `scope-creep` is described as a situation, because no recorded
case exists, so you can match its shape without guessing at history.

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

## `criteria-unmet` — the change breaks the criterion it must satisfy

**Observed.** A criterion said an install leaves one directory free of the tool's own files. The
change wrote its state record into that very directory, so the reviewer could not affirm the
criterion at all.

**Label.** `defect:criteria-unmet`

**Rejection text.** "The criterion says that directory holds no file of ours; the new record is
written into it, so the criterion fails. Move the record under the tool's own state directory,
keyed by the directory it describes, or amend the criterion in the bead and say why."

**Why this class.** The work is real and the scope is honest — part of what was asked is absent.

## `scope-creep` — unrelated tidying rides along

**Situation.** A change that adds one label also renames three unrelated helpers and reformats a
neighbouring module.

**Label.** `defect:scope-creep`

**Rejection text.** "The rename and the reformat are outside the criteria. Split them into their own
change so this one can be reviewed and reverted on its own."

**Why this class.** Every line is defensible in isolation. The defect is that the change is wider
than its reason, which hides the real diff.

## `style-violation` — a written rule is broken

**Observed.** A change added a new skill and declared a `patch` bump in its changeset. The
versioning rule says a new skill is a `minor` bump and lists "wrong bump type" as a red flag. The
reviewer rejected the change citing that rule.

**Label.** `defect:style-violation`

**Rejection text.** "The changeset declares `patch`, but this change adds a skill. The versioning
rule makes an addition `minor` and calls a wrong bump type a red flag. Bump it to `minor`."

**Why this class.** Cite the rule, not a preference. A reviewer who cannot quote a written rule has
a preference, and preferences are not rejections.

## `regression` — an existing behaviour breaks

**Observed.** A code stage added a manifest write that assumed its target directory existed. An
install from a source holding no agents and no skills had worked before; after the change it threw
`ENOENT` on that write. The stage found it in its own check of the change, reproduced it, added a
test that failed, then fixed it.

**Label.** `defect:regression`

**Rejection text.** "The manifest write assumes its directory exists, so an install from a source
with no agents and no skills now throws `ENOENT` where it used to succeed. Create the directory
before writing, and cover the empty-source case with a test."

**Why this class.** The change may satisfy its own criteria fully. It also breaks behaviour nobody
asked to change, which is a separate fact from `criteria-unmet`.

## `unsafe-instruction` — a documented command that ran the reader's text

**Observed.** A shipped skill documented `bd note <bead> "<entry>"` and told the reader to embed a
free-text entry, including text the user had typed. Following it with an entry containing `$(…)`
ran the substitution when the line was pasted, and an entry containing a `"` ended the quoted
argument early and corrupted the note. The sentence had shipped for many releases and still
described the command correctly: the command does record a note.

**Label.** `defect:unsafe-instruction`

**Rejection text.** "The note command takes free text through a double-quoted shell argument, so a
`$(…)` in the entry executes and a `"` truncates the note. Write the entry with `--out` and pass it
with `bd note --file`, and say why. A reader on an arbitrary machine pastes this line as written."

**Why this class.** Not `docs-drift`: the text matches the command's behaviour. Not
`style-violation`: no convention was broken. The defect is the consequence of following the text —
data loss and code execution on a machine the author never sees.

## `ambiguous-rule` — two plausible readings of one rule

**Observed.** Two in one round. A bead described a runtime that supplies "mail, rigs and pane
conventions" and said the persona behaves the same in every scope, so a reader could take "rigs" as
true of personal work too; the real rule is that rigs are code-project containers and personal work
is a town-level scope with no rig. Separately, a shipped doc printed a live substitution token of
the `CAPABILITY` kind — a full token, colon and key included — to illustrate the token grammar, and the
token guard necessarily rejects a literal token in a shipped doc: the line read both as an example
and as a token that must resolve.

**Label.** `defect:ambiguous-rule`

**Rejection text.** "Two readings are possible and the text picks neither. 'Mail, rigs and pane
conventions' reads as true of personal work; state that rigs are code-project containers and that
personal work is a town-level scope with no rig. The doc prints a literal substitution token of the
`CAPABILITY` kind, which the guard reads as unresolved; show the grammar without a literal token, or mark
the line as an example the guard must skip."

**Why this class.** Not `docs-drift`: nothing was stale — each statement was true of the code
projects it described. The text can be read two ways, and the reader who takes the wrong one cannot
tell from the words.

## `silent-degradation` — a guard that reported success on the tree it never read

**Observed.** A materialiser check walked one harness's generated tree for leftover substitution
tokens and reported success, while the other harness's tree shipped a literal token to readers. The
guard was real and its assertion genuine; it never looked at half the surface, so it reported "no
offenders" for a tree it had not read. A second instance in the same area: a token row whose
second-harness column was empty dropped the token silently, leaving a sentence with a hole in it
and no warning.

**Label.** `defect:silent-degradation`

**Rejection text.** "The guard reads one harness's tree only; the other tree ships an unsubstituted
token and the check passes. Walk every generated tree, and fail on an empty token row rather than
dropping the token. A skipped check must not report success."

**Why this class.** Not `test-cannot-fail`: the assertion would fail for a token in the tree it
reads. The defect is the unread surface, plus a mapping that degrades to prose with no warning — a
path that fails quietly, which is wider than one test.

## `unclassified` — the escape hatch, before the class existed

**Observed.** The unsafe instruction above was rejected before `unsafe-instruction` existed. No
class fit, so the reviewer forced the nearest one and the finding went out as `defect:docs-drift`.
Nothing in the text was stale, the fix had nothing to do with documentation, and the aggregate
counted a documentation defect where the risk was a destructive command. That mislabel is the case
this section exists to correct.

**Label.** `defect:unclassified`

**Rejection text.** "No class fits: this is an instruction that can destroy data or run a command,
not stale text. Applied `defect:unclassified` alone and proposed an `unsafe-instruction` class in a
bead. Do not read this as a documentation defect."

**Why this class.** It is the escape hatch, and the obligation is the point: it was applied with a
gap bead proposing the missing class. Without that bead it is a miscount with a nicer name, and the
class is not a pass on the review.
