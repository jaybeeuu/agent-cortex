# Technical Direction: Execution-Label Migration Tooling (two-axis model)

## Problem and target outcome

- Migrate all beads workspaces from `implementation-type:afk|hitl` to `execution:afk|hitl`
  (strict rename, agent-agnostic) as part of the two-axis workflow model epic.
- Provide a repo-agnostic tool + skill any workspace can run, and a single-package.json
  script tooling story across the agent-cortex repo.

## Current-state constraints

- bd CLI is a global binary (`~/.local/bin/bd`); label ops: `bd label list-all [--json]`,
  `bd list --label-pattern/regex [--json]`, `bd label add/remove` (batch multiple ids).
- `bd list` supports `--label-pattern`/`--json`; `bd count` does NOT support `--label-pattern`.
- `bd ready --label-pattern 'stage:*'` works; `bd ready -l execution:afk` verified.
- 3 script packages exist with per-skill `package.json` + own `pnpm-workspace.yaml` +
  own `pnpm-lock.yaml` (create-task, validate-agent-dir, run-pipeline-stage). They are NOT
  members of the root workspace (root glob `skills/*/scripts` does not match the nested
  `skills/<domain>/<name>/scripts`; root lockfile has zero refs to them).
- All 3 scripts are stdlib-only (`node:child_process`, `node:fs`, `node:path`, `node:url`).
- Extensions (`extensions/skill-stats`) have real peer deps on `@earendil-works/pi-coding-agent`
  — they remain workspace members with their own package.json.
- `node_modules` gitignored; per-skill modules are installed manually today — a fragility in
  fresh clones and PI-installed contexts.

## Decisions (locked in planning session)

### D1: Script runtime — all skill scripts become zero-dep `.mjs` with `// @ts-check`

- Every script in `skills/*/*/scripts/` runs with bare `node` (built-ins + shelling out to
  `bd`). No tsx, no node_modules at runtime, no skill-scripts-dir resolution problem in any
  installed context.
- Build-in-publish (Option B) rejected: contradicts the repo's no-compilation PI package
  model; 3 tiny stdlib-only scripts do not justify dist artifacts.
- Root keeps `tsx`/`typescript`/`@types/node` for extensions and for `tsc --noEmit`
  typechecking of `.mjs` via `checkJs`.

### D2: Single package.json (root workspace consolidation)

- Fold the 3 per-skill script packages into the root workspace: delete their `package.json`,
  `pnpm-workspace.yaml`, `pnpm-lock.yaml`; convert scripts to `.mjs` (D1); root
  `package.json` owns typecheck/test wiring.
- Extensions stay as workspace members (`extensions/*` glob) — their package.jsons are
  semantically meaningful (peer deps on the pi runtime).
- Fresh-clone/installed-context verification: `pnpm install` at root then
  `pnpm -r typecheck` + `pnpm -r test` (or root `node --test` wiring) cover all scripts.

### D3: Migration tool shape

- Script: `skills/productivity/migration/scripts/rename-execution-labels.mjs` — zero-dep,
  `// @ts-check` + JSDoc.
- Behavior:
  1. Enumerate: `bd list --label-pattern 'implementation-type:*' --json`.
  2. Group bead ids by label value (afk | hitl). A bead carrying both gets both execution labels.
  3. Dry-run (default): print per-bead plan + summary counts; zero writes; exit 0.
  4. Apply (`--apply`): batched `bd label add execution:<v> <ids...>` then
     `bd label remove implementation-type:<v> <ids...>` per group.
  5. Idempotent: re-run finds zero targets → no-op.
  6. Fail loudly if `bd` unavailable or any subcommand errors.
- Scope: rename ALL beads carrying `implementation-type:*` (including closed) — the F7
  acceptance "zero implementation-type:* labels remain" requires it, and bd label history
  tolerates it.

### D4: Migration skill

- Location: `skills/productivity/migration/SKILL.md` (productivity = workflow tooling).
- Docs the full sequence for any workspace: preflight (count via `bd label list-all`),
  dry-run, apply, post-checks (grep stale refs; `bd ready -l execution:afk` smoke), plus
  pointers to idea-file migration (F2) and skill/doc updates (F3/F4/F5/F6).
- Repo-agnostic: no agent-cortex-specific paths in the runnable steps.

### D6: npm packaging hygiene (no build step — F9)

- The npm tarball currently ships the whole repo, including `.beads/` (the live task DB),
  `.github/`, `.changeset/`, `.junie/`, tests, and token-map.json. No `.npmignore`, no
  `files` field.
- Rejected: a compile build. Scripts are zero-dep `.mjs` (D1) — nothing to transpile;
  extensions are TS by pi contract (`index.ts` entrypoint, loader transpiles; the pi runtime
  import is type-only). Root build script is deliberately a no-op.
- Chosen: (1) `files` whitelist in package.json — ship only runtime assets (skills/, agents/,
  extensions/, bin/, lib/, AGENTS.md, plugin.json, README, LICENSE); (2) `prepublishOnly`
  gate running `pnpm typecheck && pnpm test`; (3) wire `test/cli.test.mjs` into root `test`.
- Revisit trigger: if an extension ever gains real runtime deps, bundle that extension with
  esbuild at prepack — not a repo-wide build.

### D5: Knocked-on invocation changes (F4/F5)

- ralph init step 9: `pnpm --prefix skills/workflow/run-pipeline-stage/scripts exec tsx
  generate-progress.ts` → `node <abs>/generate-progress.mjs`.
- create-task chore creation: `<skill-scripts>/node_modules/.bin/tsx create-chores.ts` →
  `node <abs>/create-chores.mjs`.

## Options considered

### Option A: all scripts zero-dep `.mjs` (chosen)
- Pros: node-only everywhere; no install step; kills resolution problem; `node --test` native.
- Cons: JSDoc typing instead of TS syntax; small convention shift (`.ts` → `.mjs`).

### Option B: keep `.ts`, build in publish pipeline
- Pros: full TS syntax.
- Cons: compile step + dist artifacts contradict no-build PI package; installed contexts must
  ship/install built output; over-engineered for 3 stdlib-only scripts.

### Option C: per-skill tsx packages (status quo, rejected)
- Pros: existing pattern.
- Cons: 3 orphaned mini-workspaces, manual install fragility, resolution doc dance
  (`<skill-scripts>/node_modules/.bin/tsx`), contradicts single-package.json preference.

## Tradeoffs accepted

- Scripts use JSDoc annotations where types matter; `tsc --noEmit` with `checkJs` keeps a
  typecheck gate at root.
- Closed beads get their history labels renamed — accepted for a clean label space.

## Validation plan

- F1-T3: scratch beads workspace (temp dir): create test beads with both labels + a dep pair,
  dry-run (assert zero writes), apply, verify rename, re-run idempotence, `bd ready -l
  execution:afk` smoke, then run the migration skill end-to-end once.
- F8-T3: fresh clone (or temp copy) + `pnpm install` at root; `pnpm -r typecheck` and
  `pnpm -r test` green; scripts execute via bare `node`.

## Revisit triggers

- A future script needs third-party deps at runtime → revisit D1 (either root dep or
  per-package re-introduction).
- New extension with conflicting devDeps → revisit D2 membership rules.

## References

- Code evidence: `skills/*/scripts/package.json` (3 orphaned), root `package.json` +
  `pnpm-workspace.yaml`, bd CLI help (`bd list`, `bd label`), epic `agnt-ctx-s5xd` notes.