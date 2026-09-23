# Idea: deployment beads for post-merge pipelines

## Status
Backlog idea (not implementation-ready)

## Created
2026-08-31

## Problem
A task isn't done when the PR is merged — it's done when CI passes, it's merged, and in some cases *it's deployed*. Ralph's pipeline currently stops at `review` → open PR → human merge: there is no post-merge stage, so a merge that breaks CI or fails to deploy is discovered manually (or not at all). The definition of done is incomplete for projects with deployment/post-merge workflows.

## Who benefits
The author, running ralph-managed projects with release/deploy pipelines (e.g. agent-cortex's changesets release flow). No more manual pipeline watching after a merge; post-merge breakage is tracked and surfaced through the same bead system as everything else, so nothing silently rots in a CI dashboard.

## Proposed outcome
Deployment tracking becomes part of chore creation: when `create-task` (or `prd-to-tasks`) creates a task in a project that has a deployment/post-merge workflow, it also creates a **deployment bead** that gates "done" on the post-merge pipeline. A small/cheap model watches and reports on pipeline status. Failures are reported via a bead and **escalated to the author — never resolved by the agent**.

## Validity check
- Evidence we already have: ralph already opens review-gated PRs and pauses for human merges (the HITL gate pattern); `unified-ci-pipeline` documents real release-pipeline friction (release fires even on failed checks). Post-merge watching is the natural continuation of that arc.
- Riskiest assumption: a small model can reliably watch and report pipeline status cheaply enough that the watch cost doesn't exceed the failure-detection benefit. Also: that "has a deploy workflow" is detectable at chore-creation time rather than needing per-project config.
- What would invalidate this idea: post-merge failures are rare enough that manual checking is fine; the watcher can't distinguish real failures from flaky CI without burning tokens; or existing CI-native notifications (GitHub Actions alerts) already cover the gap.

## Constraints
- Must be cheap: small model, watch-and-report only. No internal LLM-driven resolution loops.
- Failures escalate to the author (matches the HITL pattern) — the watcher reports, a human decides.
- Must compose with the ralph pipeline as another stage/chore type, not fork it.
- Deployment bead is created at chore-creation time where a post-merge workflow exists — part of `create-task`'s pipeline configuration (`skills/planning/create-task/pipeline.json`), generalised across ralph-managed projects.

## Next validation step
Survey which ralph-managed projects actually have post-merge/deploy workflows, and map where a deployment bead would slot into `create-task`'s chore breakdown. Check whether the changesets release flow (agent-cortex) is the natural first consumer.

## Notes
- Priority: **P2** — backlog, not blocking. Generalise: the deployment bead is part of chore creation, not a per-project add-on.
- Distinct from `unified-ci-pipeline` (that idea is about CI speed + release gating, this is about post-merge/done definition).
- Consistent with `state-in-beads-not-md`: the bead is the source of truth; pipeline status lands on a bead, not a scratch file.
- "Escalated, not resolved" is the key design line — keeps the watcher cheap and keeps human judgment in the loop.
