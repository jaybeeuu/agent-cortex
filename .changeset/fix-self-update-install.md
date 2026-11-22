---
"@jaybeeuu/agent-cortex": patch
---

Fix `self-update` reporting an available update while installing nothing. The install now states the exact published version instead of the `latest` tag, because a package manager resolves a tag inside the range it already recorded and so cannot cross a major release. The version after the install is read back from the manager's prefix, and an install that exits 0 without moving the version fails with the command, its exit code and its output instead of reporting success.
