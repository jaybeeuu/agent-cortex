---
"@jaybeeuu/agent-cortex": minor
---

Add `agent-cortex scope add` and `agent-cortex scope list`, so registering a bd workspace no longer
means hand-editing `~/.agent-cortex/scopes.json`.

`scope add --path <dir> [--name <n>] [--kind code|personal|ops]` writes or updates one entry in the
user-level list (`<AGENT_CORTEX_HOME>/scopes.json`, default `~/.agent-cortex/scopes.json`). It
refuses a directory that does not exist, is not a directory, or carries no `.beads` of its own, and
names the check that failed; the marker is tested at that exact directory, never by walking up, so a
nested directory cannot register itself against the enclosing workspace's beads. The write is a
read-modify-write of one entry: every other entry and every unknown key survives, and the merged
document is validated by the queue's own parser before anything is written, so a malformed file is
refused rather than truncated.

A configured list replaces the implicit "workspace you are standing in" scope, so `add` keeps the
current workspace in the written list as the default `code` entry and says so. Adding a personal
scope can no longer drop a repository out of the queue.

`scope list` prints every scope a run in the current directory resolves — its name, kind, read-only
flag, availability and resolved path — using the same resolution the HITL queue uses, so `~` and
relative paths print as the queue reads them.

Both commands reuse the `hitl-queue` skill's `scopes.mjs`; there is no second parser or path
resolver.
