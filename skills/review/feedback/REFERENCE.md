# Feedback — the item, the destination, the failure cases

`SKILL.md` decides whether to file and what to put in the body. This file holds the item's shape, so
the command that renders it and the agent that reads it agree on one definition. The shape is stated
once, here. A second copy in any skill is drift waiting to happen.

## The item

```md
---
title: <phrase>
date: <ISO 8601 date and time>
source: <who or what filed it>
area: <one component>
severity: <low|medium|high>
---

## What happened

<...>

## Evidence

<...>

## Proposed change

<...>
```

Five keys, three sections, in this order. What each section must contain is the table in `SKILL.md`;
what each key must say is below.

The file name is the item's title, slugged, behind its date and area, so a directory sorts by time
and groups by component: `<date>-<area>-<title>.md`.

## Front matter

| Key | Meaning | Rule |
|---|---|---|
| `title` | The finding in one phrase. | The command defaults it to the first sentence of the message. Keep it specific enough that a second identical finding matches this one. |
| `date` | When the finding was filed. | ISO 8601, including the time. A date without a time cannot order two findings from the same day. |
| `source` | Who or what filed it. | Name the skill, the agent, or the person. "Someone" is not a source, because a reader cannot go back and ask. |
| `area` | The skill or component the finding is about. | One component. A finding that spans two is two findings, because each is fixed by a different owner. |
| `severity` | How much harm the behaviour does. | `low`: a cost you can work around. `medium`: a wrong result, or a rule you cannot follow. `high`: data loss, a destructive instruction, or a check that passes while broken. |

Only these five keys. A key that names a project, a host or a tracker is a fact about one machine and
cannot ship, so it does not belong in an item.

## A second filing on the same finding

Filing the same `area` and `title` again does not create a second file. The command appends one dated
line under `## Evidence` of the item already there, so a recurrence accumulates in one place with its
dates, and a count of occurrences stays readable. When the evidence is different enough to be a
different finding, change the title: a new title is a new item.

## Worked example

```md
---
title: "A skill names a document the install does not ship"
date: 2026-05-01T10:00:00Z
source: ralph worker, code stage
area: feedback
severity: medium
---

## What happened

The skill told the agent to read a design document and gave a path relative to a repository tree.
The install contains no such tree, so the read failed and the rule that followed it was skipped.
The agent reported the step as done.

## Evidence

`skills/<group>/<name>/SKILL.md`, the "Design" section, names `docs/design.md`. The staged install
holds no `docs/` directory beside `skills/`. Run: `ls <install root>` shows the staged directories.

## Proposed change

Name the document with an install-time token, so the installer substitutes a path that exists in the
staged tree. Affects every skill that reads a bundled document.
```

## Destination

Resolution stops at the first match:

| Order | Source | Value |
|---|---|---|
| 1 | `AGENT_CORTEX_FEEDBACK_DEST` | `dir:<path>` |
| 2 | `~/.agent-cortex/feedback.json` | `{ "dest": "dir:<path>" }` |
| 3 | Default | `~/.agent-cortex/feedback/` |

A value names a directory, and the directory is created when it is absent. `issues:<owner>/<name>` is
refused: an issue is a published record, and filing a finding never publishes. Any other scheme names
the setting it came from and exits non-zero, so a typo cannot quietly choose the default.

`--dir <path>` overrides all three for that one run and is the supported way to file into the default
after a configured destination failed.

## Failure cases

| Case | What the command does | What you do |
|---|---|---|
| No destination configured | Files into the default and prints the path. | Report the path and say the default was used. |
| Configured path is absent | Creates the directory, then files. | Report the path. A created directory is not a finding. |
| Configured path is a file, or cannot be written | Names the path and the reason, exits non-zero, never falls back. | Report the failure, then file with `--dir <default>` and report both paths. |
| Scheme is not `dir:` | Names the setting and the reason, exits non-zero. | Fix the setting, then file. Do not work around it with `--dir`; the bad setting stays for the next run. |
| No `feedback` command in the install | Nothing runs. | Say the command is absent and keep the finding with the work. Never hand-write the item. |

The last row matters because the command is a separate piece of work from this skill. The skill is
readable and correct before the command exists, and the first row of the table is what it costs until
the command lands: a finding stays with the work instead of becoming a file.
