# User Preferences

This file records personal development preferences for the author (**jaybeeuu**).
Both pi and Claude Code agents should read this file for user-level context when
making tooling and workflow decisions.

## Package manager

| Preference | Value |
|---|---|
| **Preferred tool** | **PNPM** (`pnpm`) over npm (`npm`) |
| Rationale | Faster installs, disk-efficient with content-addressable store, stricter dependency resolution, and built-in workspace support. |
| Impact | Use `pnpm` for installs, script execution, and package management. Use `pnpm dlx` instead of `npx`. Do not suggest `npm install` or `npx` unless the project explicitly uses npm. |

## Worktrees

| Preference | Value |
|---|---|
| **Primary checkout** | Stays on `main`, always. No one branches in it, and no one switches it. |
| **Where branches live** | A git worktree, one per branch, under `.agent-cortex/worktrees/<slug>`. |
| **Cleanup** | Remove the worktree once its pull request merges. |
| Rationale | The primary checkout is shared ground. A `git switch` there moves the branch pointer out from under whoever is working in it, and a task that only half-finished leaves the tree on a branch nobody intended. A worktree makes each branch a separate directory with its own index and its own working tree. |
| Impact | Start branch work with `git worktree add .agent-cortex/worktrees/<slug> -b <branch> origin/main` and remove it with `git worktree remove` after the merge. Read, fetch, merge and prune from the primary checkout; never build or commit in it. |

## Future preferences

Add new preferences below as they are established.
