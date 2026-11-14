---
"@jaybeeuu/agent-cortex": minor
---

Add `implement-task`, the skill that owns the task around the loop: criteria, scope, and proof.

`tdd` owns the red-green loop and the `style-*` skills own the standards, but nothing owned the task
— reading the acceptance criteria, proving each one, staying in scope, and taking only pragmatic
boy-scout fixes. `implement-task` fills that gap with four load-bearing sections: the criteria →
evidence table, written before code and filled with observable evidence at Finish; the scope rule,
where an out-of-scope finding becomes a bead instead of an edit; the boy-scout rule, which allows a
fix only inside a file the task already touches and only where it serves the task; and the mutation
check, inherited from `style-tests` and applied to every test that claims a behaviour. A criterion
with no named check is a blocker, not a guess.

The `code` stage playbook now invokes `implement-task` as its first step and routes through it to
`tdd` and the style skills, `tdd` links to it for criteria and scope rather than carrying those
rules itself, and `using-agent-skills` routes a task-implementation request to it while leaving a
bare "write a test for X" on `tdd`.
