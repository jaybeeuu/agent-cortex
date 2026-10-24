---
"@jaybeeuu/agent-cortex": patch
---

Stop documenting a fixed local-bin `bd` path as the authoritative bd binary. The migration technical-direction doc now describes `bd` as resolved from `PATH` with `BD_PATH` as the override, warns against pinning an orphaned binary (schema-version mismatch risk), and its script-package constraint reflects the post-D2 root workspace membership.
