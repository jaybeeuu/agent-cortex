---
"@jaybeeuu/agent-cortex": patch
---

Harden `agent-cortex migrate` v1: allowlist its label values and drop the phantom `ctx` alias.

The v1 label rename now maps `implementation-type:afk|hitl` only. Any other value — a stray
`implementation-type:wip` — is a blocking error that names each offending bead id and label and
stops before any write, on the dry run and on `--apply` alike, instead of inventing an
`execution:wip` label nothing queries. The migration skill and its reference no longer document
`ctx migrate`: the package exposes one executable name, `agent-cortex`, with
`node bin/agent-cortex.mjs migrate` for a checkout that is not installed.
