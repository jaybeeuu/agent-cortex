---
name: init-beads
description: Install and initialise the beads (bd) task-tracker in the current project using stealth mode. Use when the user wants to "set up beads", "install bd", "initialise beads", or mentions "bd init".
---

# Init Beads

Install and initialise the `bd` CLI task tracker in the current project, running in stealth mode: minimise commits to the main repo, git hooks, and questions to the user.

## When to use

- The user asks to "set up beads", "install bd", "initialise beads", or "run bd init" in a project — or mentions beads tracking with no setup present.
- A project has no `.beads/` directory yet and the user wants task tracking enabled.

## When NOT to use

- The project already has `.beads/`, or the user wants to work with existing beads rather than set them up — use `bd-tool` instead.
- The user explicitly asks for git hooks or an interactive wizard — `bd init --stealth` deliberately skips both.

## Workflow

### 1. Check if `bd` is installed

Run `which bd || bd version`. If missing, install silently — prefer Homebrew → npm → script, detect the best method from the environment, and decide without asking:

| Platform | Command |
|---|---|
| macOS / Linux (Homebrew) | `brew install beads` |
| npm available | `npm install -g @beads/bd` |
| Go available | `go install github.com/steveyegge/beads/cmd/bd@latest` |
| Any (script) | `curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh \| bash` |

### 2. Check if beads is already initialised

Run `bd version 2>/dev/null && ls .beads/ 2>/dev/null`. If `.beads/` exists, skip `bd init` and tell the user beads is already set up.

### 3. Initialise beads in stealth mode

```bash
bd init --quiet --stealth
```

Always pass `--quiet --stealth`: local-only init, no git hooks or commits to the main repo, no interactive wizard.

### 4. Update AGENTS.md

Append the quick-reference block below to `AGENTS.md` if missing, or create `AGENTS.md` with this exact block:

```markdown
## Task tracking

This project uses **bd (beads)** for task tracking.

Run `bd prime` at the start of each session for context.

Quick reference:
- `bd ready` — list unblocked work
- `bd create "Title" -p <0-3>` — create a task (P0 = critical)
- `bd update <id> --claim` — claim a task
- `bd close <id>` — complete a task
- `bd dep add <A> <B>` — **"A depends on B"** (B blocks A). First arg waits, second arg
  is waited-for. To express "X blocks Y", write `bd dep add Y X`.
- `bd dolt push` — sync to remote at session end
```

### 5. Report

Print a brief summary: whether `bd` was installed or already present, whether beads was initialised or already set up, and whether AGENTS.md was created or updated. Complete all steps first — do not pause to ask the user.

## Red Flags

- Red flag: running `bd init` without `--stealth` or `--quiet` — this installs git hooks or opens the interactive wizard.
- Red flag: asking the user which install method to use or whether to proceed — the skill is designed to run unattended.
- Red flag: committing `.beads/` or any init commit to the repo — stealth mode keeps them local-only.

## Common Rationalizations

| Rationalization | Rebuttal |
|---|---|
| "I'll skip `--stealth` so the user can see what happens" | Stealth mode is the contract of this skill — non-stealth init adds hooks and commits the user never asked for. |
| "I should ask before installing software on the user's machine" | Installing `bd` is the requested outcome; asking adds friction and the skill is meant to run headless. |

## Cross-skill references

- Use `bd-tool` for day-to-day beads usage once initialised — `bd prime`, `bd ready`, `bd create`, `bd close`.
- Use `create-task` to create tasks with pipeline-stage expansion and a HITL review gate.

## Examples

Input: "Set up beads in this repo" → output report example:

- `bd: installed via Homebrew`
- `beads: initialised in .beads/ (stealth, local-only)`
- `AGENTS.md: appended task-tracking quick reference`

## Verification checklist

- [ ] `bd` is installed (or was already present) and `bd version` succeeds
- [ ] `.beads/` exists in the project — stealthed init, no git hooks installed, no repo commits made
- [ ] `bd prime` runs without error in the project
- [ ] AGENTS.md contains the task-tracking quick-reference block exactly once (created or appended) and the summary report covers install, init, and AGENTS.md status