---
"@jaybeeuu/agent-cortex": patch
---

Typecheck the whole tooling surface, not just the skill scripts. The root `tsconfig.json` covered
`skills/**/scripts/**/*.mjs` only, so the repo's actual product code — the CLI, both harness
installers, the Claude hook, and the shared libs — was never type checked (only the `check-no-sync`
lint reached it). `include` now covers `bin/`, `lib/`, `hooks/` and `scripts/` alongside the skill
scripts, and every error that surfaced is fixed with JSDoc annotations rather than by excluding
files: no `@ts-nocheck`, no `exclude`, no file converted to TypeScript.

The surface went from 13 unchecked modules to 0. Measured on the widened `include`, the sweep
started at 273 errors in 10 files and is now clean:

- `bin/installers/pi.mjs` 107 → 0, `bin/installers/claude.mjs` 79 → 0, `bin/agent-cortex.mjs` 8 → 0,
  `scripts/lib/compose-agent.mjs` 28 → 0, `scripts/lib/verify-worker-tree.mjs` 13 → 0,
  `scripts/lib/release-gates.mjs` 10 → 0, `hooks/claude/scripts/notify.mjs` 10 → 0, `lib/cli.mjs` 6 → 0,
  and 1 each in `scripts/check-changeset.mjs` and `scripts/resolve-publish-command.mjs`. Most were
  implicit-any parameters; the object shapes the installers pass around (install results, the token
  map, the generated pi manifest, the sweep's options) now have `@typedef`s, exported from
  `scripts/lib/compose-agent.mjs` where both installers share them.
- `parseArgs` declares its result as a `ParsedArgs` typedef, so `bin/agent-cortex.mjs` can read
  `dryRun`/`output`/`pluginRoot`/`requireRegister` after narrowing on `command`.
- `validateHarness` treats an `undefined` harness as missing rather than unknown. `parseArgs` returns
  `null` (never `undefined`), so no CLI path changes; `sweepLegacyPiUserDirs` loses its `= {}`
  default, which its required `piUserDir` already made unusable (both its callers pass an object).
- Two guards replaced state that only looked like narrowing: the marketplace manifest path is built
  from a non-null `marketplaceRoot`, and `hooks.json` is written when the read content is non-null
  (`summary.hooks` was the same condition spelled indirectly).
- `test/` is deliberately NOT in the surface yet: it adds 154 further errors, almost all untyped
  fakes and partial fixtures in the test helpers, which is a different annotation job from this one.
  That is tracked as `agnt-ctx-s5xd.13`; `test/typecheck-surface.test.mjs` asserts the gap stays an
  explicit decision.

`test/typecheck-surface.test.mjs` is the regression guard: it fails if a tooling directory leaves
`include`, if any `.mjs` in those directories stops being matched by an include pattern, if the
`typecheck` script stops running the root project, if `exclude` carves a tooling path out, or if
`test/` is pulled into the surface without updating the guard.
