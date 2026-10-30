---
"@jaybeeuu/agent-cortex": patch
---

Convert the last two skill scripts to zero-dependency `.mjs` so they run under bare `node` —
no `tsx`, no per-skill install. `create-chores` (`skills/planning/create-task/scripts/`) and
`validate-agent-dir` (`skills/productivity/validate-agent-dir/scripts/`) now carry `// @ts-check`
and JSDoc types instead of TypeScript syntax, matching `classify-bead.mjs`; behaviour and output
are unchanged. `validate-agent-dir.test.ts` moves to `test/validate-agent-dir.test.mjs` and runs
in the repo's `node --test` glob, so its 21 tests no longer need a per-skill toolchain. Every
live invocation string (`create-task` SKILL/REFERENCE, the `ralph` agent body + skill docs,
`agents/README.md`) now calls `node <scripts>/create-chores.mjs`, and the regenerated Copilot
agent files follow. The two script packages keep their manifests for now, but with no scripts or
devDependencies — their deletion lands with the workspace consolidation.
