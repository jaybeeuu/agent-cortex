# Idea: Unified CI Pipeline with Parallel Checks

## Status
Backlog idea (not implementation-ready)

## Why it might be useful
The current CI setup has two problems:
1. **Slow feedback** — checks run serially, making the pipeline slower than it needs to be.
2. **Broken releases** — the release job (version branch creation) is a separate pipeline, so it can fire even when checks fail. A broken commit can reach the version branch.

Combining them gives faster feedback (parallel checks) and a safety gate (release step only runs if all checks pass).

## How we might do it
- Merge the check pipeline and release pipeline into a single pipeline.
- Fan out all checks to run in parallel.
- Make the version branch creation a downstream job/step that depends on all checks passing.

## When to think about it
When CI pipeline speed or release safety becomes a recurring friction — e.g. after the changesets/release workflow is fully set up and seeing real traffic.

## Priority
P2 — infrastructure quality-of-life. Not blocking current work, but a clear improvement once the release flow stabilises.

## Notes
- Setup job with artifact infrastructure added (2026-08): install + build now happen once in a `setup` job, artifacts are shared with downstream jobs via upload/download-artifact. This is the first step toward the unified pipeline vision.
- Depends on the changesets release workflow being in place (P1 beads `agnt-ctx-d1ht`, `agnt-ctx-5bcu`).
- Should be straightforward once the pipeline shape is settled.
- **Release pipeline fires on every push to main** — this wastes CI minutes. It should only run when there are changesets to process (e.g. when the version packages PR is merged, or when new changesets land on main). Add a path filter or a pre-check that skips the job when no `.changeset/*.md` files changed.
