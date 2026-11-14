---
name: implement-task
description: Owns the task itself — read the acceptance criteria, prove each one with evidence, stay in scope, and take only pragmatic boy-scout fixes. Use when implementing a tracked task, bead, or ticket that lists acceptance criteria, or when you must show each criterion is met before reporting done.
---

# Implement Task

`tdd` owns the red-green loop and the `style-*` skills own the standards. This skill owns the task
around them: what the criteria are, what you touch, and what you can prove when you finish.

## When to use

- Implementing a tracked task, bead, or ticket that carries acceptance criteria.
- Picking up a pipeline stage chore that must report against a criteria list.
- Asked to "implement this task", "work this bead", or "prove the criteria are met".

## When NOT to use

- The loop inside one criterion — use `tdd`, which this skill invokes per criterion.
- Writing or reviewing a test itself — use `style-tests`.
- Naming, module boundaries, or refactoring shape — use `style-code`.
- Deciding what the work should be — use `plan` or `create-task` first.

## Workflow

1. **Read the criteria.** Extract the task's `## Acceptance Criteria` verbatim and complete. A task
   with no criteria is not implementable: stop, and either ask for them or file the gap as a bead.
2. **Build the table.** Write the criteria → evidence table before touching code (see
   _Criteria to evidence_). A criterion you cannot name a check for is a blocker, not a guess.
3. **Take one criterion at a time.** Drive it through `tdd`, with `style-tests` for the test and
   `style-code` for the code. Fill its row when it lands, not at the end.
4. **Hold the scope.** Change only what a criterion needs (see _Scope rule_). Record every
   out-of-scope finding as a bead and change nothing for it.
5. **Fix inside touched files only.** Apply the _Boy-scout rule_ to anything you notice outside the
   criteria.
6. **Finish.** Re-read the criteria, re-run every check the table names, apply the _Mutation check_
   to each test that claims a behaviour, and report the filled table.

## Criteria to evidence

The table is the contract between the request and the diff. Write it first, fill it last.

| # | Criterion (quoted from the task) | Check that proves it | Status |
|---|---|---|---|
| 1 | <criterion> | <command, test name, or commit> | todo / done / blocked |
| 2 | <criterion> | <command, test name, or commit> | todo / done / blocked |

- **A criterion with no check is a blocker, not a guess.** An unproven criterion is unfinished.
  Name the criterion and the reason before writing code, rather than inventing a plausible proof
  afterwards.
- **Evidence is observable.** A test named for the behaviour, the command and its result, or a
  commit for a documentation change. Never "verified manually" or "looks right".
- **One row per criterion.** Fold a criterion you cannot separate from another into that row
  instead of splitting it into vague halves.
- **The filled table is the report.** Hand back one row per criterion with its evidence. A claim
  with no check in its row does not ship.

## Scope rule

- **Change only what a criterion needs.** Each line in the diff answers a row in the table, or is
  the smallest thing that lets a row pass.
- **An out-of-scope finding becomes a bead, not an edit.** Name what you found, where it is, and
  why the task does not own it. File it, then continue.
- **A conflict is a stop, not a judgement call.** When a criterion needs a change that contradicts
  another criterion or an existing rule, report both and stop. Do not pick one silently.
- **No drive-by refactor.** Rename, restructure, or reformat nothing the task did not require,
  however tempting the neighbouring code looks.

## Boy-scout rule

A boy-scout fix is allowed only inside a file the task already touches, and only when it serves the
task:

- **Serves the task** — it makes this criterion's own change correct or readable: a name the change
  made wrong, a helper the criterion needs, a comment the change invalidated.
- **Serves nobody** — it improves code the criterion never reaches: an unrelated dead branch, a
  different module's naming, a missing test elsewhere. File it and leave it.
- **Cost gate.** A fix must cost less to read in the diff than to follow in a bead. When in doubt,
  file the bead.

## Mutation check

`style-tests` owns the rule, as its Workflow step 6. This skill applies it at Finish:

- Apply it to every test the task added or changed that claims a behaviour.
- Record the outcome in the evidence row of the criterion that test proves — which behaviour you
  removed, which test failed, and that the suite is green again after restore.
- A claimed behaviour whose named test still passes under mutation leaves its criterion `blocked`,
  whatever the suite says.

## Red Flags

- Red flag: writing code before the criteria → evidence table exists.
- Red flag: a row whose evidence is a restated criterion instead of a check.
- Red flag: a diff line that no row in the table needs.
- Red flag: reporting `done` over a table with `todo` rows.
- Red flag: a "quick tidy" in a file the task never opens.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "The criteria are obvious, the table is overhead" | The table is the only place the request and the diff meet. Without it, the checklist is memory and the report is opinion. |
| "This nearby bug is a two-line fix" | Then it is a two-line bead. Fixing it here hides an unrequested change inside a requested one. |
| "The test passes, so the criterion is proven" | A test that passes under mutation proves nothing. Run the mutation check or say the row is unproven. |
| "I refactored a little, it is still the same change" | It is a second change wearing the first one's name. Split it. |

## See Also

- [tdd](../tdd/SKILL.md) — the red-green loop you run once per criterion.
- [style-tests](../../style/style-tests/SKILL.md) — assertion strategy, plus the mutation-check rule this skill applies.
- [style-code](../../style/style-code/SKILL.md) — the conventions the code under each criterion must meet.
- [run-pipeline-stage](../../workflow/run-pipeline-stage/SKILL.md) — the stage runner whose `code` playbook invokes this skill first.

## Verification checklist

- [ ] Criteria → evidence table written before the first code change, one row per criterion
- [ ] No criterion left without a named check; any such gap reported as a blocker instead of guessed
- [ ] Each criterion taken through `tdd`; test and code conventions delegated to `style-tests` and `style-code`
- [ ] Every diff line traces to a table row; out-of-scope findings filed as beads, not edited
- [ ] Boy-scout fixes confined to files the task touches and to what the task needs
- [ ] Every check in the table re-run at Finish, with its result recorded
- [ ] Mutation check applied to each test claiming a behaviour, outcome recorded per row
- [ ] Table reported in full, with evidence per row
