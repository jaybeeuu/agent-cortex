---
"@jaybeeuu/agent-cortex": patch
---

Document the one manual step in the release loop: the Version Packages PR arrives
`BLOCKED` with an empty check list because `changesets/action` pushes that branch
with `GITHUB_TOKEN`, so GitHub parks the CI run the push creates behind "Approve
workflows to run" and a parked run reports nothing. Approve it — merge box click,
or the documented `gh api … /approve` one-liner — and the five required checks
start. The approval is per head commit, so it is needed again after any further
merge to `main`, which force-updates the version branch. Adding a PAT or GitHub App
token would let the bot trigger its own CI, but one click per release is a better
trade than a long-lived credential in repository secrets.
