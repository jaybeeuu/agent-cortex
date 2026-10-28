---
"@jaybeeuu/agent-cortex": patch
---

Start CI on the Version Packages PR instead of letting every release stall on an
approval prompt. `changesets/action` opens that PR with `secrets.GITHUB_TOKEN`,
and GitHub does not skip the resulting `pull_request` run — it creates the run
parked in an `action_required` state with zero jobs, waiting for a user with
write access to approve it. Nothing reports while it waits, so the PR is
`BLOCKED` with an empty `statusCheckRollup` and every release needed a manual
click (or a close/reopen) to get the five required checks.

The release job now approves the parked run itself, and falls back to a
`workflow_dispatch` on the version branch — the documented exception to
`GITHUB_TOKEN` event suppression — when the token is not allowed to approve its
own run. Both paths use `GITHUB_TOKEN`, so no new secret is introduced. The
decision logic is pure and tested (`scripts/lib/version-pr-ci.mjs`), and the
adapter is `scripts/start-version-pr-ci.mjs`.
