---
"@jaybeeuu/agent-cortex": patch
---

Fix `self-update` reporting an available update while installing nothing. The install now states the exact published version instead of the `latest` tag, because a package manager resolves a tag inside the range it already recorded and so cannot cross a major release. The version after the install is read back from the manager's prefix, and an install that exits 0 without moving the version fails with the command, its exit code and its output instead of reporting success. An install whose version neither the prefix listing nor the new binary reports is unverified: the harness refresh still runs, and the command exits non-zero. The advisory messages for an owner that cannot be inferred or confirmed no longer print `@latest`; they name the version this copy holds and ask for the published version in place of `<version>`.
