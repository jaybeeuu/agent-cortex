---
"@jaybeeuu/agent-cortex": patch
---

Generalise the `tdd` skill's "When NOT to use" exclusion from testing markdown
documentation to asserting the static contents of any file — config, markdown, terraform,
snapshots — so it agrees with the ban stated canonically in `style-tests`. The advice to
validate a file's structure with a linter or schema check is preserved, and the exclusion
still defers the full ban to `style-tests` through the cross-skill table.
