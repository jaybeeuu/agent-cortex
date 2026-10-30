---
name: git-workflow
description: "Enforces git discipline: feature branches over direct pushes, git worktrees for isolation, and GitHub PRs for all changes. Use when making any change to a codebase — this is the default workflow."
---

# Git Workflow

Follow this workflow when asked to make changes unattended (AFK-mode). When
collaborating with a human on the same branch, work in their workspace —
do not create a separate worktree that splits attention.

If unsure whether you're working solo or collaboratively, ask.

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

### 2. Git worktrees — for unattended solo work

Use `git worktree add` to create an isolated working directory instead of
stashing or switching branches in-place. Worktrees let you work on multiple
branches simultaneously without interference.

```bash
git worktree add ../my-repo-feat-branch feat/my-branch
```

Worktrees are cheaper than clones (shared object store) and safer than
stashing — **but only when you're working solo**. If the human is also
working on the same thing, use a shared branch and workspace instead.

**When collaborating**: ask the human what workspace/branch they're on. Do
not spin up a separate worktree — work in the same checkout so you both see
the same state.

### 3. Never stack branches — put the dependency in the tracker

Every branch is based on the **integration branch**: `main`, or `epic/<id>` for
multi-feature work. Never base one feature branch on another.

```
❌ git worktree add ../b -b feature/b feature/a    # b silently carries a
✅ git worktree add ../b -b feature/b origin/main
```

If `b` needs `a`, that is a **dependency**, not a branch. Record it in the
tracker — `bd dep add <b> <a>` ("b depends on a") — and let the tracker keep `b`
out of the ready queue until `a` merges and closes. Then branch `b` from the
integration branch, which by then contains `a`.

Why: this repo squash-merges, so `feature/a`'s commits never become ancestors of
the integration branch. The moment `a` merges, `b` carries all of `a`'s content
as if it were new work, GitHub reports `CONFLICTING` on byte-identical files, and
the repair costs a `git rebase --onto <integration> <old-base>` plus a full
re-verification. Waiting for the merge is always cheaper.

Wanting to "get ahead" while a dependency is in review is the signal the
dependency is real — stop and check the tracker instead.

### 4. Pull requests for review

Every feature branch ends in a GitHub PR. Open the PR early (draft if unfinished) so the diff is visible.

```bash
gh pr create --title "..." --body "..."
gh pr create --draft  # early
```

### 5. Sync before branching

Before creating a feature branch, sync with upstream:

```bash
git checkout main
git pull
```

This avoids avoidable merge conflicts.

### 6. Bring a behind branch up to date — rebase, don't merge

When the base branch moves and the PR reports `BEHIND` or `CONFLICTING`, rebase
your branch onto it before anything else — never merge the base in:

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

A merge from the base drags every intervening commit into the review diff and,
under a squash-merge landing method, contributes nothing that reaches the base
branch. Landing is still a squash merge; rebasing only reshapes *your* branch
before it lands, so these are separate decisions, not rivals. Keeping the branch
linear is what makes the rebase safe: `git rebase` drops merge commits and the
patches they resolved, so never rebase a branch that already merged the base.

Rewritten commits are re-signed automatically when `commit.gpgsign` is set. Pass
no `--gpg-sign`, and do not set `rebase.gpgSign` — both are redundant.

Scope: rebase only your **own unmerged feature branch**. Never rebase `main`, and
never rebase a branch another person or agent is working on — it discards their
context and invalidates review. Force-push with `--force-with-lease`, never
`--force`, which overwrites work you have not seen.

After any update, re-run the checks: a conflict resolved by hand is not verified
by the base branch's green CI.

### 7. Worktree lifecycle

After the PR is merged or closed, clean up the worktree:

```bash
cd /path/to/main/repo
git worktree remove ../my-repo-feat-branch
git branch -d feat/my-branch
```

## When NOT to use

- **Collaborating with a human** on the same code — use their workspace,
  not a separate worktree.
- Single-character typo fixes that are already on a branch.
- Emergency hotfixes to production that bypass normal process (rare, explicit).
- **If unsure** whether you're working solo or alongside a human: ask.
