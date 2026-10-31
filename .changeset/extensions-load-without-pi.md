---
"@jaybeeuu/agent-cortex": minor
---

The extensions now load outside this checkout. `auto-name`, `notify`, `subagent` and `agent-modes`
value-imported `@earendil-works/pi-*`, which resolved only inside the repository, where pnpm had
installed each extension's own copy of pi's packages. The staged pi package carried no such
`node_modules`, so after `agent-cortex install pi` those four extensions failed to load for every
project outside this checkout — `subagent` included, which is the dispatcher ralph uses.

The runtime coupling is gone: frontmatter parsing, pi's user agent directory, the key helper and the
transcript components are now local, and the extensions declare no peer dependency on pi's packages. Two
callers lose their model-backed behaviour, since an extension has no completion API of its own:
`auto-name` names a session from its first prompt truncated (the fallback it already had) and
`notify` summarises with that same truncation. Subagent output renders as plain text instead of
markdown. `test/pi-extensions-load.test.mjs` stages the package and loads every extension from a
temp directory with pi absent, so a re-introduced `@earendil-works/*` import fails the suite.
