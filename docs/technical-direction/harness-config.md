# Technical Direction: Harness config and third-party extensions

## Problem and target outcome

- **What we are solving.** agent-cortex ships agents and skills to three harnesses (pi, Claude
  Code, Copilot CLI) and needs a declared, reproducible set of *third-party* extensions those
  agents depend on (pi packages / Claude plugins). Two bespoke mechanisms currently exist and
  disagree: `main` declares packages in `package.json` → `pi.packages` and provisions them from
  `lib/pi-packages.mjs`; the unmerged pi-harness epic (`agnt-ctx-dfq3`) declares them in
  `pi.extensions.json` / `claude.extensions.json` and provisions them via `agent-cortex ext
  install`. **Neither file is read by any harness** — both are agent-cortex inventions.
- **Target outcome.** One idiomatic mechanism per harness: extensions the agents *require* are
  resolved by the harness's native dependency field; extensions that are *optional* are declared
  in the harness's committed settings template. No bespoke manifest format survives.
- **Why now.** The epic is unmerged and diverging from `main` (7 commits behind), and PR #142
  (`ext prune`) was closed as redundant with the harnesses' own package management. Keeping both
  models means keeping the drift the original idea set out to remove.

## Current-state constraints

- **Public package.** `publishConfig.access: public`, npm `@jaybeeuu/agent-cortex@1.40.0` — every
  bundled dependency or committed template affects anyone who installs the package, not just the
  author.
- **pi is idiomatic two ways.** Machine state is `~/.pi/agent/settings.json` → `packages[]`, owned
  by `pi install/remove/list`. A package's own resource declarations live in `package.json` → `pi`
  (`extensions`, `skills`, `prompts`, `themes`); third-party pi packages are depended on via
  `dependencies` + `bundledDependencies` and referenced through `node_modules/…`. **There is no
  `pi.packages` field** — pi ignores it.
- **Claude is idiomatic two ways.** Machine state is `~/.claude/settings.json` → `enabledPlugins`
  + `extraKnownMarketplaces`. A plugin declares other plugins in `.claude-plugin/plugin.json` →
  `dependencies`, which Claude Code resolves and auto-installs.
- **Copilot has no dependency mechanism.** `copilot plugin install/list/uninstall` exists, but its
  state is auto-managed `~/.copilot/config.json` (not committable) and `plugin.json` declares no
  dependencies.
- **The epic already built two-thirds of the target.** Unmerged commit `afab2c6` (F3) materialises
  `pi/settings.json` + `pi/keybindings.json` from committed templates with merge-keep-personal and
  the CLI owning `packages`; `1ff212d` (F4) makes bundled pi extensions load via package
  registration. Only `1e0e970` (F5, the bespoke manifests) is off-direction.
- **Unknowns resolved during this memo:** pi bundling is feasible (see Validation plan); Claude
  dependency auto-install is real but cross-marketplace needs an allowlist; Claude currently
  declares **zero** third-party plugins.

## Options considered

### Option A: one bespoke config per harness

- **Approach.** A `config/<harness>.json` (or the epic's `*.extensions.json`) holds settings and
  the extension list; the CLI provisions from it.
- **Pros.** Uniform across harnesses; full control; explicit single place to look.
- **Cons.** A third format that neither harness reads; duplicates the native `packages` /
  `enabledPlugins` fields; re-creates the manifest-vs-machine drift the idea exists to remove.
- **Risks.** The redundancy that made `ext prune` (F6) not worth building.

### Option B: native dependency fields + committed settings templates *(recommended)*

- **Approach.** Required extensions → `dependencies` + `bundledDependencies` (pi) and
  `.claude-plugin/plugin.json` `dependencies` (Claude). Optional extensions → the harness's own
  committed settings template (`pi/settings.json` `packages`; `claude/settings.json`
  `enabledPlugins` + `extraKnownMarketplaces`), materialised with merge-keep-personal. Drop the
  bespoke manifests, the `ext install`/`ext prune` family, and the separate diff command —
  `agent-cortex install <harness>` reconciles.
- **Pros.** Idiomatic; no bespoke format; each harness resolves its own required deps; the
  optional list lives in the file the harness already reads, so `pi list` / `claude plugin list
  --json` are the exact machine-state comparison; drift self-heals on install.
- **Cons.** pi bundling shifts update cadence to agent-cortex releases and grows the tarball;
  Claude cross-marketplace deps need an allowlist; the committed template also carries personal
  settings; Copilot gets nothing.
- **Risks.** Loading TS extensions from bundled `node_modules/`; maintaining the Claude
  cross-marketplace allowlist.

### Option C: fully delegate to the harnesses

- **Approach.** pi bundles its deps, Claude auto-installs plugin deps, `install` only registers;
  there is no optional layer at all.
- **Pros.** Least code; no declaration surface to maintain.
- **Cons.** No way to declare the optional/opt-in personal toolset; the original problem —
  "the toolset isn't reproducible or documented" — goes unsolved for everything not strictly
  required.
- **Risks.** Silently drops the reproducibility goal.

## Recommendation

**Option B.** It is the only option that satisfies both halves of the problem: *required*
extensions resolve through the harness's own mechanism (so an agent's tools can't be missing),
and *optional* ones stay declared and reproducible without inventing a format the harnesses
ignore. It also deletes the most code — the two competing bespoke models, `lib/pi-packages.mjs`,
and the `ext` command family — rather than adding a third.

Alternatives were not chosen because: **A** keeps a third format and the drift it causes; **C**
abandons the declared-toolset goal that started the work.

**Concrete disposition:** salvage the epic's F3 (`afab2c6`) and F4 (`1ff212d`) — they *are* the
settings-template and bundled-dependency mechanisms — drop F5/F6 (`1e0e970` and PR #142), close
the epic, and delete `pi.packages` + `lib/pi-packages.mjs` from `main`.

## Tradeoffs accepted

- **pi bundling changes update cadence.** Bundled pi packages are pinned by agent-cortex's
  `package.json` ranges and update when agent-cortex releases, not via `pi update`. Accepted: it
  makes the required toolset a property of agent-cortex rather than of the machine.
- **Tarball size.** `pi-web-access` pulls 5 runtime deps (readability, linkedom, p-limit, turndown,
  unpdf). Accepted for the required set; the optional set stays provisioned, not bundled.
- **Claude cross-marketplace allowlist.** If a required Claude plugin lives in another
  marketplace, agent-cortex's `marketplace.json` must list it in
  `allowCrossMarketplaceDependenciesOn`. Accepted; currently moot (zero declared plugins).
- **Committed personal settings.** `pi/settings.json` already carries models/theme; the template
  model makes the repo own the whole pi settings surface. Accepted; F3's merge preserves personal
  keys and only `packages` is CLI-owned.
- **Copilot gets no mechanism.** Documented exception — the README says `copilot plugin install`.
  Accepted because Copilot has no dependency field and no committable config.
- **No dedicated diff command.** A read-only `status` is deferred until drift is shown to hurt.

## Validation plan

Run before implementation (three already run during this memo):

1. **Can `pi-questions` / `pi-web-access` be bundled and load from `node_modules/`?** ✅ *Ran.*
   `pi-questions@0.3.4` is a single extension file with no deps or install-time state;
   `pi-web-access@0.10.7` is an extension + skills with 5 runtime deps. Both are conventional pi
   packages — bundling is feasible. Success signal: a scratch package depending on both loads
   `ask_questions` / `fetch_content` in a fresh pi session.
2. **Does Claude's `plugin.json` `dependencies` auto-install from agent-cortex's marketplace?**
   ✅ *Ran.* Yes, but cross-marketplace deps require `allowCrossMarketplaceDependenciesOn` in the
   root `marketplace.json`, and version constraints need `{plugin-name}--v{version}` git tags.
3. **Does F3 reconcile `packages` when the template drops one?** ✅ *Ran.* Yes — the CLI owns
   `packages` outright, so removing an entry from the template removes it on next install. The
   documented limitation is the reverse (ad-hoc `pi install` entries don't persist), which is
   intended.

Still to run before shipping: a scratch end-to-end install on a clean `HOME` proving a required
pi extension loads from `node_modules/` and an optional one is materialised from the template.

## Revisit triggers

- pi or Claude ship a first-class *optional* dependency field, making the settings template
  unnecessary.
- Claude still declares zero third-party plugins after the migration — then Claude parity is
  speculative and should be dropped rather than maintained.
- Bundling `pi-web-access`'s native-ish dependency tree (unpdf, linkedom) proves brittle or
  unacceptable on a fresh machine.
- Copilot gains a committable config or a plugin dependency field — revisit the documented
  exception.
- Drift between the committed template and the machine becomes a recurring annoyance — add the
  deferred read-only `status`.

## References

- pi docs, *Settings* and *Packages* (installed at
  `…/@earendil-works/pi-coding-agent@0.85.1/docs/settings.md`, `…/docs/packages.md`): `packages`
  array is the machine store; the `pi` manifest keys are `extensions`/`skills`/`prompts`/`themes`;
  other pi packages are bundled and referenced through `node_modules/`.
- Claude Code, *Constrain plugin dependency versions* — https://code.claude.com/docs/en/plugin-dependencies
  (auto-install, cross-marketplace allowlist, tag naming).
- Claude Code, *Settings* — https://code.claude.com/docs/en/settings (`enabledPlugins`,
  `extraKnownMarketplaces`).
- GitHub Copilot CLI, *Plugin reference* — https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
  and *Configuration directory* — https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- Code evidence: `package.json` (`pi.packages`), `lib/pi-packages.mjs` (main's provisioner);
  `pi.extensions.json`, `claude.extensions.json`, `lib/extension-manifest.mjs` (epic F5, `1e0e970`);
  `bin/installers/pi.mjs` settings materialisation (epic F3, `afab2c6`);
  `docs/ideas/extension-manifests.md` (the originating idea).
