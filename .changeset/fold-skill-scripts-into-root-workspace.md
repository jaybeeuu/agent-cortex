---
"@jaybeeuu/agent-cortex": patch
---

Fold the skill scripts into the root workspace. The two remaining per-skill script packages
(`skills/planning/create-task/scripts`, `skills/productivity/validate-agent-dir/scripts`) lose
their `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and stray `tsconfig.json`, and the
dead `skills/**/scripts` glob is dropped from `pnpm-workspace.yaml`, so the root `pnpm-lock.yaml`
no longer lists script-dir importers. A new root `tsconfig.json` typechecks
`skills/**/scripts/**/*.mjs` with `checkJs` + `strict`, and the root `typecheck` script now runs
`tsc --noEmit -p tsconfig.json` before recursing into the extensions — so `pnpm lint` covers every
script, each of which still runs on bare `node`. `typescript` and `@types/node` join the root
devDependencies; `tsx` stays for the extensions' `node --test --import tsx/esm` runs. The
"3 script packages / NOT members of the root workspace" constraint in the migration memo is
corrected: the glob did make them members, and they are now deleted rather than listed.
