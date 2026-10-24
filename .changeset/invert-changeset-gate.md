---
"@jaybeeuu/agent-cortex": patch
---

Stop the Release job re-publishing an already-published version. Every PR now
has to add a changeset unless it is labelled `no-publish` (the changesets bot's
Version Packages PR is exempt), and the Release job resolves the merged PR's
labels for the pushed commit before choosing between `publish-package` and the
new `publish-noop` script.
