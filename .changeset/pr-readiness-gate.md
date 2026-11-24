---
"@jaybeeuu/agent-cortex": minor
---

A pull request is ready only once its branch contains its base. The document playbook gains a
_PR readiness_ section: the branch contains `origin/<base>`, every check is green on that head, and
`gh pr view <n> --json mergeStateStatus` reads `CLEAN` — all three, or the branch is not ready.

A behind branch is rebased onto its base, force-pushed with `--force-with-lease`, and its suite is
re-run before the report. The ready report quotes the post-rebase `mergeStateStatus` and the head
SHA. Rebasing `main`, an `epic/<id>` branch or another worker's branch stays forbidden, and a
conflicted rebase is a stop rather than a conflict resolved by merging the base in.
