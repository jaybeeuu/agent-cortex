---
"@jaybeeuu/agent-cortex": patch
---

`agent-cortex install pi` now reports the two ways a machine ends up in a mixed state, instead of
leaving them to surface later as missing tools or conflict errors.

A configured package source whose path no longer exists is named with the command that drops it.
Detection is an existence check, so it no longer depends on reading the source `package.json` —
which is exactly what failed on a pruned worktree path, letting the entry survive a whole install
and every `pi remove` afterwards. The report gives `pi remove <resolved path>`: pi matches a local
source by resolved path, and a relative argument resolves against the current directory rather
than the settings file, so the obvious `pi remove <as configured>` misses. The installer does not
remove the entry itself — a missing path may be temporarily absent.

A pi package the staged package bundles and the user also registers standalone is reported with
both copies, the copy that takes precedence (load order decides, so the first-listed source wins),
and the `pi remove` command that resolves it. The staged package always ships its own copy, so the
standalone entry is the one to drop; the installer does not remove packages the user configured.

`LEGACY_ORPHAN_SKILLS` no longer lists `productivity/migration`: it ships again, so the package root
attributes its copy, and the entry now follows its own instruction to be dropped once that holds.
