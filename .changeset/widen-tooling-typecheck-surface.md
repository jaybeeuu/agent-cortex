---
"@jaybeeuu/agent-cortex": patch
---

Typecheck the whole tooling surface — the test suite included — not just the skill scripts. The
root `tsconfig.json` covered `skills/**/scripts/**/*.mjs` only, so the repo's actual product code
(the CLI, both harness installers, the Claude hook, and the shared libs) and every test was never
type checked (only the `check-no-sync` lint reached them). `include` now covers `bin/`, `lib/`,
`hooks/`, `scripts/` and `test/` alongside the skill scripts, and every error that surfaced is fixed
with JSDoc annotations rather than by excluding files: no `@ts-nocheck`, no `exclude`, no file
converted to TypeScript.

The surface went from 13 unchecked modules to 0. Measured on the widened `include`, the tooling
sweep started at 273 errors in 10 files and is clean:

- `bin/installers/pi.mjs` 104 → 0, `bin/installers/claude.mjs` 76 → 0, `bin/agent-cortex.mjs` 24 → 0,
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

The test suite swept the same way: 192 errors in 16 files → 0. The shape was different — untyped
fakes and partial fixtures rather than real code — so the fix is typedefs on the shared fakes and on
the per-file fixtures, not casts at the call sites:

- `test/helpers/` already modelled its fakes in JSDoc; the callers did not. `test/pi-register.test.mjs`
  and `test/pi-sweep.test.mjs` grew `InstallTree`/`SweepTree` typedefs for their throwaway trees,
  `test/pi-installer.test.mjs` a `PackageFixture`, and `test/create-chores.test.mjs` a `FakeBead`
  mirroring what `test/helpers/fake-bd.mjs` records — partial option objects (`{ template }`,
  `{ memory }`, `{ packages }`) now accept the fields the cases actually pass instead of inferring
  `{}` from the default.
- `test/installer.test.mjs`'s generated `hooks.json` is read through a `HooksJson` typedef, so the
  matcher and hook-command reads are checked rather than `any`; nullable results (`result.settings`,
  `result.instructions`, `beads.find(...)`) are narrowed where they are asserted, never asserted
  away with `!`.
- `execFile` callbacks narrow `error.code` to a number instead of passing a `string | number`
  straight into `exitCode`.
- One real defect fell out of the sweep: `test/cli.test.mjs` had a `pathExists` helper calling an
  unimported `stat`, dead code from a copy — deleted.

`test/typecheck-surface.test.mjs` is the regression guard: it fails if a tooling directory leaves
`include`, if any `.mjs` in those directories stops being matched by an include pattern, if the
`typecheck` script stops running the root project, or if `exclude` carves a tooling path out.
`test/` is in its `REQUIRED_SURFACE`, so dropping the suite back out of the surface is a build
failure rather than a silent gap.
