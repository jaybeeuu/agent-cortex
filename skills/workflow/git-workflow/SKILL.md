---
name: git-workflow
description: Enforces git discipline: feature branches over direct pushes, git worktrees for isolation, and GitHub PRs for all changes. Use when making any change to a codebase — this is the default workflow.
---

# Git Workflow

Always follow this workflow when making changes to any repository.

## Rules

### 1. Feature branches — always

Never commit directly to `main` or `master`. Every change gets a feature branch.

```
❌ git commit -m "fix"          # on main — never
✅ git checkout -b feat/my-thing
```

Branch naming:
- `feat/<description>` — new features
- `fix/<description>` — bug fixes
- `refactor/<description>` — refactoring
- `chore/<description>` — tooling, config, CI, docs

### 2. Git worktrees — prefer by default

Use `git worktree add` to create an isolated working directory instead of stashing or switching branches in-place. Worktrees let you work on multiple branches simultaneously without interference.

```bash
git worktree add ../my-repo-feat-branch feat/my-branch
```

Worktrees are cheaper than clones (shared object store) and safer than stashing.

### 3. Pull requests for review

Every feature branch ends in a GitHub PR. Open the PR early (draft if unfinished) so the diff is visible.

```bash
gh pr create --title "..." --body "..."
gh pr create --draft  # early
```

### 4. Sync before branching

Before creating a feature branch, sync with upstream:

```bash
git checkout main
git pull
```

This avoids avoidable merge conflicts.

### 5. Worktree lifecycle

After the PR is merged or closed, clean up the worktree:

```bash
cd /path/to/main/repo
git worktree remove ../my-repo-feat-branch
git branch -d feat/my-branch
```

## When NOT to use

- Single-character typo fixes that are already on a branch
- Emergency hotfixes to production that bypass normal process (rare, explicit)
