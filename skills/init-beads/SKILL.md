---
name: init-beads
description: Install and initialise the beads (bd) task-tracker in the current project using stealth mode. Use when the user wants to set up beads, install bd, initialise beads, or mentions "bd init".
---

# Init Beads

Install and initialise the `bd` CLI task tracker in the current project. Prefer stealth mode — minimise commits to the main repo and questions to the user.

## Quick start

```bash
# Install bd if missing
brew install beads          # macOS/Linux (preferred)
npm install -g @beads/bd    # fallback

# Initialise in the project (stealth)
bd init --quiet --stealth
```

## Workflow

### 1. Check if `bd` is installed

```bash
which bd || bd version
```

If missing, install silently:

| Platform | Command |
|----------|---------|
| macOS / Linux (Homebrew) | `brew install beads` |
| npm available | `npm install -g @beads/bd` |
| Go available | `go install github.com/steveyegge/beads/cmd/bd@latest` |
| Any (script) | `curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh \| bash` |

Prefer Homebrew → npm → script. Do NOT ask the user which method to use — detect and decide.

### 2. Check if beads is already initialised

```bash
bd version 2>/dev/null && ls .beads/ 2>/dev/null
```

If `.beads/` already exists, skip `bd init` and tell the user.

### 3. Initialise beads

Always use `--quiet --stealth`:

```bash
bd init --quiet --stealth
```

`--stealth` keeps everything local — no git hooks, no commits to the main repo.  
`--quiet` suppresses the interactive wizard.

### 4. Update AGENTS.md

If `AGENTS.md` exists, append the beads quick-reference block if it isn't already there.  
If it doesn't exist, create it.

```markdown
## Task tracking

This project uses **bd (beads)** for task tracking.

Run `bd prime` at the start of each session for context.

Quick reference:
- `bd ready` — list unblocked work
- `bd create "Title" -p <0-3>` — create a task (P0 = critical)
- `bd update <id> --claim` — claim a task
- `bd close <id>` — complete a task
- `bd dolt push` — sync to remote at session end
```

### 5. Report

Print a brief summary:
- Whether `bd` was installed or already present
- Whether beads was initialised or already set up
- Whether AGENTS.md was created or updated

Do NOT ask the user to confirm before any of these steps. Just do it.

## Stealth mode rules

- Always pass `--stealth` and `--quiet` to `bd init`
- Never install git hooks unless the user explicitly asks
- Never commit `.beads/` to the repo (it's local-only in stealth mode)
- Prefer non-interactive install methods at every step
