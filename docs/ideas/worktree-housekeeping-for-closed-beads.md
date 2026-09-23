# Idea: Worktree housekeeping for closed beads

## Status
Backlog idea (not implementation-ready)

## Created
2026-09-13

## Problem
Ralph runs each bead in a dedicated worktree under `.agent-cortex/worktrees/<parent-id>` and only cleans up when a human manually removes it — the `git-workflow` skill's "Worktree lifecycle" step is discretionary, not enforced. Closed, merged beads leave their worktrees behind, and crashed or abandoned runs leave orphaned ones. The worktree set drifts from the actual bead/PR state with no mechanism to converge it.

## Who benefits
- The author, who currently accumulates stale worktrees and must identify and remove them by hand.
- Future ralph/agent sessions, which skip reading a worktree set polluted by dead state and avoid accidentally reusing an abandoned worktree for a new bead.
- Confident teardown: knowing a merged feature's worktree is gone makes "is this still live?" checks unnecessary.

## Proposed outcome
Two tiers of cleanup:
- **Minor (deterministic)**: when a ralph run's PRs merge and its beads close, the associated worktrees are removed as part of the close-off — no LLM judgement needed.
- **Major (broader)**: a reusable housekeeping pass that finds and reports orphaned or abandoned worktrees (no corresponding live bead, no open PR / stale branch), usable on demand.

Cleanup is safe-first: it must not remove a worktree whose branch or bead is still active, and unmerged/abandoned worktrees should be surfaced rather than silently deleted.

## Validity check
- Evidence we already have: `git-workflow` SKILL.md already documents "after the PR is merged or closed, clean up the worktree" as a manual step — the intent exists, only the enforcement is missing. Ralph already knows the full mapping of bead → worktree → PR, so it has all the data a deterministic cleanup needs.
- Riskiest assumption: worktree state can be derived reliably from bead state + git state (that a "closed bead" always means its worktree is safe to remove, and that orphan detection can distinguish abandoned worktrees from merely idle ones). If the bead/PR mapping is lossy — e.g. beads close without recording whether the PR merged — the deterministic rule could remove an unmerged feature's worktree.
- What would invalidate this idea: if the cost of a false positive cleanup (losing an unmerged feature's worktree or its local branches) outweighs the cost of the current manual drift; or if ralph's lifecycle already converges worktrees in practice and the observed accumulation is negligible.

## Constraints
- Human merge gates stay non-negotiable — cleanup must never imply or require auto-merging.
- No destructive action on anything the mapping can't positively classify (unmerged features, active beads, open PRs) — default to reporting.
- Both the skill and the deterministic script live in this repo (`skills/`, `scripts/`); final split between skill, script, or both is a design-time decision.

## Next validation step
List worktrees across a few real (recently completed) ralph sessions and compare against bead/PR state to measure actual accumulation and test whether closed-bead → safe-to-remove always holds. This both quantifies the problem and de-risks the riskiest assumption.

## Notes
- Interview left two design-time decisions open: (1) whether cleanup lives as a skill, a script, or both; (2) whether it runs at session start, inside the ralph loop, or as an on-demand command — "maybe both" was the lean.
- Related backlog neighbours worth reconciling when this is planned: `deployment-beads-for-post-merge-pipelines.md` (post-merge lifecycle), `record-ideas-as-beads.md` if the major housekeeping pass becomes a scheduled bead.