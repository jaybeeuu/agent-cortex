---
name: feedback
description: Files one finding — a defect noticed while working, a design objection, a missing capability — as a local item through the feedback command, and never as a published issue, push, pull request or release. Use when something you ran or read is wrong in a way that outlives the task at hand, or when you say "file this feedback", "note this for the skill authors", or "report this upstream".
---

# Feedback

A finding is one thing you noticed that belongs to the tooling, not to the task. The command owns
the shape of the file. This skill owns the decision to file, the content of the finding, and the
rule that the finished item stays on the machine.

## When to use

- A shipped skill gave a rule you cannot follow, or two rules that contradict each other.
- A command failed in a way the caller cannot recover from, or did nothing and said nothing.
- A capability the work needed was absent, and you can name the time it cost.
- A design objection: the approach the tooling takes is wrong, with a reason you can state.

## When NOT to use

- A bug in the task at hand. It belongs on the bead that tracks the work, so the fix travels with
  the work and the reviewer reads it. `bd-tool` covers the bead's own trail.
- Counting which defect classes recur across a project. That is `review-report`.
- Applying a class to a rejection you are making. That is `review-defects`.

## Workflow

1. Decide it is a finding, not a task symptom. A finding is still true after the branch merges and
   on a machine that never held this checkout. If it is not, it is a bead note.
2. Write the three body sections before you file. Each carries a fact. The table below is the test
   every section must pass.
3. Build the fields the command needs: `--area`, `--severity`, `--source`, `--title`, `--dir`.
   Omit `--title` and the command takes the first sentence of your message as the title.
4. Call the command. Long text goes on stdin, so a heredoc keeps it readable:

   ```bash
   ctx feedback --area <component> --severity <low|medium|high> "$(cat <<'ITEM'
   ## What happened
   ...
   ## Evidence
   ...
   ## Proposed change
   ...
   ITEM
   )"
   ```

5. Read the path the command printed, and state it in your reply. A filing whose path you cannot
   name did not happen.

### The three body headings

| Heading | Holds | Does not hold |
|---|---|---|
| `What happened` | The behaviour you observed, in the order you met it, and what you expected instead. | A diagnosis, or a fix. |
| `Evidence` | A file path, a bead id, or the command output that shows it. Quote the line that is wrong. | A feeling, a summary with no artefact behind it, or "it seemed off". |
| `Proposed change` | The smallest change that would have prevented the finding, and who it affects. | A full implementation, or a rewrite of the owning component. |

A finding with nothing under `Evidence` is not ready to file. Go back and collect the artefact first.
The full item — every field and one worked example — is in `REFERENCE.md`.

## Where a finding lands

The destination resolves in this order, first match wins:

1. `AGENT_CORTEX_FEEDBACK_DEST` in the environment, holding `dir:<path>`.
2. `~/.agent-cortex/feedback.json`, when it exists, holding `{ "dest": "dir:<path>" }`.
3. The default directory, `~/.agent-cortex/feedback/`.

A value is `dir:` followed by a path, never a bare path, so the item always lands as a file you can
read, move or delete. `issues:<owner>/<name>` is refused, because an issue is a published record. Any
other scheme names the setting it came from and exits non-zero, so a typo cannot quietly choose the
default.

`--dir <path>` overrides all three for that one run.

The command prints the path it wrote on every run. Report that path, and report which of the three
sources chose it — a reader needs to know whether a finding sits in a personal directory or a shared
one before quoting it.

### When the destination cannot be used

A configured path that is absent is created, and the item lands there. Report the path. A created
directory is not a finding.

A configured path that exists as a file, or cannot be written, stops the command. It names the path,
gives the reason and exits non-zero, and it never falls back on its own, so the failure cannot pass
for a success.

Do not swallow that error. Say which path failed and why, then file the same item into the default
directory with `--dir ~/.agent-cortex/feedback`, and report both paths: the one that failed and the
one the item landed in. A finding that goes nowhere quietly is worse than a finding never filed.

When a value carries a scheme other than `dir:`, fix the setting and file again. Do not work around
it with `--dir`, because the bad setting stays for the next run.

When no destination is configured at all, the command files into the default. Report the path and say
the default was used.

If this install carries no `feedback` command at all, say so in your reply and keep the finding with
the work. Never hand-write the item yourself — a second renderer is the drift the command exists to
prevent.

## Nothing is published

A finding is a local file. Filing one opens no issue, pushes no commit, opens no pull request,
comments on nothing and publishes no package. No step of this skill reaches the network.

The command has no network path either, so the only way a finding leaves the machine is an agent
copying its text into something that gets shared. That is why the next rule is short.

## A personal destination stays personal

A personal destination is the normal case, and its content is the author's, not the project's. An
item's text never enters a shared artefact: a handoff, a pull request body, a message to another
agent, or a report.

Name the file path instead, so the reader knows a finding exists and can ask for the text. Publishing
a finding is a separate decision its author makes, by copying the text out deliberately, never as a
side effect of filing it.

## Verification checklist

- [ ] The finding is still true on a machine that holds no copy of this project.
- [ ] `What happened`, `Evidence` and `Proposed change` each carry a fact, and `Evidence` names a file
      path, a bead id or command output.
- [ ] The item was created by `ctx feedback`, and no item markdown was hand-written.
- [ ] The reply states the path the command printed, and which of the three sources chose it.
- [ ] Nothing was pushed, opened or published, and no item text entered a handoff, a pull request
      body, a peer message or a report.

## See Also

- [review-report](../review-report/SKILL.md) — counts defect classes across beads; this skill files one finding.
- [bd-tool](../../productivity/bd-tool/SKILL.md) — records a symptom of the task at hand in the bead's own trail.
