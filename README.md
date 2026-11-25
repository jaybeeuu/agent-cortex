# agent-cortex

A personal collection of custom agents and skills, shipped to two harnesses from one
source: pi and [Claude Code](https://code.claude.com/docs) (as a plugin).

## Structure

```
agent-cortex/
├── agents/                   # Canonical agents — composable <name>/ dirs (see agents/README.md)
│   ├── ralph/                #   composable form (shared agent.md + per-harness pi/, claude/)
│   ├── plan/                 #   "
│   ├── ralph-plan/           #   "
│   ├── guppi/                #   "
│   └── strategy/             #   "
├── skills/                   # Skills (grouped by domain) — shared by all harnesses
│   ├── engineering/          #  tdd, improve-codebase-architecture, …
│   ├── planning/             #  write-a-prd, prd-to-tasks, design-an-interface, …
│   ├── productivity/         #  bd-tool, write-a-skill, grill-me, …
│   ├── review/               #  review-security, refactor-skill, maintain-agent-docs
│   ├── style/                #  style-code, style-tests, style-comms, style-documentation
│   └── workflow/             #  ralph, run-pipeline-stage, create-task, …
├── extensions/               # pi extensions (pi only)
│   ├── agent-guardrails/     #   behavioural circuit-breakers in the system prompt
│   ├── agent-modes/          #   switchable agent modes (reads composable agents/)
│   ├── output-style/         #   reply shape: STE, action-first, restated context
│   ├── skill-stats/
│   └── notify/
├── pi/                       # Committed pi config templates (see below)
│   ├── settings.json
│   └── keybindings.json
├── token-map.json            # canonical capability/path/agent names per harness (install-time token substitution)
├── token-map.README.md       # design decisions behind token-map.json
├── bin/
│   ├── agent-cortex.mjs      # CLI entrypoint
│   └── installers/
│       ├── claude.mjs        # materialises ~/.agent-cortex/claude + ~/.claude/settings.json, registers with Claude Code (--output <dir> = generate-only)
│       └── pi.mjs            # stages ~/.agent-cortex/pi + registers it with pi (--output <dir> = stage-only)
├── claude/                   # Committed Claude user-settings template (settings.json) — merged into ~/.claude/settings.json
└── claude-extras/            # Hand-authored Claude plugin extras
    ├── .mcp.json             #  MCP servers (context7, github) — copied into installs
    └── scripts/              #  statusline-command.sh — copied into installs (executable)
```

The same `agents/` and `skills/` power two harnesses (pi and Claude Code). The composable
`agents/<name>/` directories are the single source of truth, and no flat agent file is
committed: `agent-cortex install claude` and `agent-cortex install pi` each render their own
from the canonical directories, so install-time output can never drift from the sources.
The `{{CAPABILITY:...}}` / `{{PATH:...}}` tokens written in agent and skill files are resolved
per harness at install time from `token-map.json`, the single source of truth for
canonical capability/path/agent names (see `token-map.README.md` and the `contract` section).
Each capability row carries a kind per harness — `tool` or `command` — because the same
capability can be one on one harness and the other on the next.
The Claude plugin is **materialised** at install time by `bin/installers/claude.mjs`. A
plain `agent-cortex install claude` copies the plugin into the home install root
(`~/.agent-cortex/claude`), writes a marketplace manifest at
`~/.agent-cortex/.claude-plugin/marketplace.json` exposing it, and registers it with
Claude Code by driving the `claude plugin` CLI — state-checked and idempotent (a fresh
install adds the marketplace + installs the plugin; a re-run updates what state says is
out of date; a repeat install at the same version is a no-op; a missing or pre-v2 CLI
warns and prints the manual registration commands instead of failing). The generated
`claude/` plugin subtree is never committed (only the `claude/settings.json` template and
the hand-authored `claude-extras/` are), so CI validates the materialiser itself — a
temp-dir install plus structural checks:

- **Skills** stay single-source — the installer copies each `skills/<group>/<name>/` dir
  flat into `skills/<name>/` (Claude discovers skills only one level deep) with
  `{{CAPABILITY:...}}` / `{{PATH:...}}` tokens substituted against token-map.json's claude
  column — no symlinks, so literal tokens never reach Claude.
- **Agents** can't be shared files (the frontmatter formats differ), so the materialised
  plugin's `agents/*.md` are composed from the canonical `agents/<name>/` directories' `claude/`
  harness dirs
  (frontmatter.json + section files). Claude only loads agents from a plugin's default `agents/`
  dir, so the plugin ships them at its own root (default `~/.agent-cortex/claude/agents/`).
- **Every agent composes, `ralph` included.** There is no Claude-only agent source: the shared
  body is harness-neutral and each harness supplies only its own wake mechanism
  (`agents/ralph/<harness>/wake.md`), so one body serves both harnesses.
- **Manifests** are generated too: the plugin's `.claude-plugin/plugin.json` (its `version`
  tracks `package.json`, so it never goes stale) and `hooks.json` (copied from the canonical
  `hooks/claude/hooks.json` source), plus any support files under `hooks/claude/` bundled into
  the plugin's `hooks/` so hook commands can reach them via `$CLAUDE_PLUGIN_ROOT`. Its
  `repository` is always a string: `package.json`'s object form is reduced to its `url`, then
  its `directory`, and dropped when neither exists. Claude rejects any other shape and drops
  the whole plugin — every skill and agent in it — with that one field. Hand-authored
  extras — `.mcp.json` and `scripts/` — are copied into every install from the `claude-extras/`
  dir, which is their canonical store. See `docs/claude-hooks.md` for the
  extension→hook mapping and the rejections (auto-name, agent-guardrails, skill-stats, subagent, agent-modes,
  session-clear, session-transition, post-merge-watch, idle-watch).

Edit the sources (`agents/<name>/` composable dirs, `skills/**`,
`hooks/claude/`, `claude-extras/`, `package.json`), never anything under the materialised
`~/.agent-cortex/claude`.

## CI

The CI pipeline runs lint, test, and claude-plugin-check as three parallel jobs
(`lint`, `test`, `claude-plugin-check`), each gated on `needs: setup`. Each job
does its own checkout and `pnpm install` rather than sharing build artifacts from
the `setup` job — pnpm workspace symlinks don't survive artifact upload/download,
so artifact sharing would break the workspace resolution that the build depends on.

The root `pnpm-workspace.yaml` carries a strict `allowBuilds` map: on pnpm 12 (what CI
pins) any dependency with install or build scripts that is not named there aborts
`pnpm install` with `ERR_PNPM_IGNORED_BUILDS`. pnpm 10 only warns, so a newly pulled-in
native dependency surfaces as a red `Setup` job before it surfaces locally. Adding one
therefore means deciding its build policy in that map — `false` unless it genuinely
needs to compile, with a comment saying why.

The repo commits no generated `claude/` plugin output, so the `claude-plugin-check` job
validates the Claude plugin **materialiser** instead of diffing a committed mirror:
it runs `node bin/agent-cortex.mjs install claude --output <tmp dir>` and checks the
result structurally — `plugin.json` version tracks `package.json`, every generated and
hand-authored piece is present, no literal `{{CAPABILITY:...}}`/`{{PATH:...}}` tokens survive,
and no symlinks leak into the copied tree. There is no committed agent file to drift-check:
the `agents/` tree holds the composable sources only, and both installers render from them.

A separate `changeset-check` job runs on every pull request and fails it unless the
PR adds a `.changeset/*.md` file. **Publishing is the default and `no-publish` is the
only opt-out**, so shipping nothing has to be a deliberate, reviewable act rather
than an accident. Two exemptions: the changesets bot's Version Packages PR (it
consumes changesets and adds none) and PRs labelled `no-publish`. The `no-publish`
label must exist in the repository's label settings — a one-off repo-settings step
that no PR can ship. The `style-versioning` skill documents the format of a
changeset.

The job then reads the frontmatter of every changeset the PR adds or **modifies** and
resolves each package name against the workspace. A name the workspace does not declare
fails the PR, naming both the changeset file and the offending package. Use the exact
name, scope included: `changeset version` reads the whole `.changeset` directory, so a
modified changeset that names an unknown package breaks the Release job on `main`,
where nothing can fix it forward. That is what happened twice — two changesets named
`@cryptolibertus/agent-cortex` when the package is `@jaybeeuu/agent-cortex` — and a
typo now fails at the pull request instead. Run the gate locally before pushing. It
needs no install and no `pnpm` on `PATH`, because it reads `pnpm-workspace.yaml` and the
workspace `package.json` names directly:

```sh
git diff --name-status "origin/main...HEAD" | node scripts/check-changeset.mjs
```

A changeset whose frontmatter cannot be parsed still passes the package check. No
frontmatter block, an unclosed block, a line with no colon and an empty value all exit
0, so a malformed changeset still reaches `changeset version` and fails Release on
`main`. That case sits outside this gate and is tracked separately (`agnt-ctx-yjw9`).
Check that your changeset closes its frontmatter block and names the exact package.

On pushes to `main`, a `release` job (gated on `lint`, `test`, and
`claude-plugin-check`) runs changesets to open a `chore: version packages` PR when
changesets are pending, then publishes to npm once it lands. The version step runs
`pnpm version-packages` — `changeset version`, which bumps `package.json` and rewrites
`CHANGELOG.md` and touches nothing else (both plugins are materialised at install time
with the package version, so there is no committed output to regenerate); the publish
step runs `pnpm publish-package` (pack + provenance publish), or
`pnpm publish-noop` when the merged PR carried `no-publish`. Labels are invisible on
a push event, so the job resolves the PR merged for the pushed commit through the
GitHub API and reads its labels — no extra secret or scope, since the job already
holds `GITHUB_TOKEN` and `pull-requests: write`. A direct push with no merged PR
resolves to no labels and therefore publishes, so attempting to publish an
already-published version still fails loudly; there is deliberately no idempotency
guard. Publishing authenticates via npm Trusted Publishing (OIDC) — no npm token or
GitHub secret is needed, only the one-time npm-side setup on npmjs.com (package →
Access → Trusted Publishing for the `jaybeeuu/agent-cortex` repo). Releases
are sourced entirely from `main`.

Merge the version PR whenever its plan and diff look right, but approve its CI
first: `changesets/action` pushes that branch with `GITHUB_TOKEN`, so GitHub parks
the CI run the push creates behind **“Approve workflows to run”** — a run with no
jobs, which reports nothing, so the merge box shows `BLOCKED` with an empty check
list even though no gate has run or failed. Approving it from the merge box (or
`gh api -X POST repos/{owner}/{repo}/actions/runs/<run-id>/approve`) starts the five
required checks. Do it after the last merge to `main`, not once at the start of a
release: every subsequent merge force-updates the version branch, and a new head
brings a new parked run. This stays manual by design — letting the bot's push
trigger CI on its own means a personal access token or GitHub App token, a
long-lived credential in repository secrets to save one click per release.

## Installation

The CLI installs under three names — `agent-cortex`, `cortex` and `ctx` — that run the
same command, and the help and error text names the one you invoked. That naming is POSIX
only: the npm and pnpm shims on Windows call `bin/agent-cortex.mjs` directly, so the text
falls back to `agent-cortex` there.

Both installers also copy the shipped `pipeline` formula into the `.beads/formulas/` directory of
the project they are run from, where `bd mol pour` finds it. The copy is an **untracked file in
your repository** — `.beads/formulas/` is not gitignored — so commit it or ignore it deliberately.
A project with no `.beads/` is reported and the install continues, and stage expansion falls back
to one `bd create` per stage until the formula is there. An `--output <dir>` run writes nothing
outside its own tree.

### Pi package staging (`agent-cortex install pi`)

`agent-cortex install pi` materialises agent-cortex as a self-contained pi
package in `~/.agent-cortex/pi` — the pi analogue of `~/.agent-cortex/claude` —
and registers that directory with pi through pi's own `pi install`. Nothing is
generated into pi's own directories (`~/.pi/agent/…`): pi owns its settings
file, so the installer only reads it to decide the plan and lets the `pi` CLI
write it. Once the staged package is registered, the artifacts an older
installer rendered there are swept (see below).

```sh
agent-cortex install pi          # stage ~/.agent-cortex/pi + register it with pi
```

`agent-cortex uninstall pi` is the inverse: it drops the registration with `pi remove` and then
deletes the staged directory — see
[Removing a harness install](#removing-a-harness-install-agent-cortex-uninstall).

Registration is idempotent by state: the staged path is registered once (a
re-run is a true no-op — a local package source is read from disk on every pi
start, so nothing needs refreshing), and a source pointing at a raw agent-cortex
checkout is removed first, so exactly one agent-cortex source stays configured.
The installer decides that plan by reading pi's settings at
`~/.pi/agent/settings.json`, so a pi agent dir relocated with
`PI_CODING_AGENT_DIR` is not inspected — a superseded raw-repo source configured
there has to be removed by hand with `pi remove <path>`.

Under the old model the same installer rendered agents and skills into
`~/.pi/agent/{agents,skills}`. Those copies are a second source of the same
resource — the skill-collision diagnostics the staged model exists to remove —
so once registration succeeds the installer removes the ones it can attribute to
agent-cortex: `agents/<name>.agent.md` and `skills/<group>/<name>` for agents and
skills this package ships or once shipped, and a `.agent-cortex-install.json`
path record left there listing those copies. It is a one-time migration:
attribution is by name, which cannot tell a rendered copy from a file you wrote
under the same name, so once it has finished it records that in
`~/.agent-cortex/legacy-sweep.json` — keyed by the pi user directory, never
inside it — and never removes anything there again. A completed migration
leaves `~/.pi/agent` with no agent-cortex file in it. Only a migration that
removed every copy it attributed, from directories it could read, is recorded:
a copy that could not be deleted (permissions, `EBUSY`) or a directory that
could not be listed is warned about and retried on the next install, and a
record that cannot be written is a warning, not a failed install. Anything
whose name this package does not ship is left alone, and
`~/.pi/agent/extensions` is never touched at all — no
installer has written there, so its contents are yours. `--output <dir>` and
`--dry-run` sweep nothing.
The sweep follows the settings file the installer reads (`~/.pi/agent`): a pi
agent dir relocated with `PI_CODING_AGENT_DIR` keeps its copies.

The staged package contains:

| Path | Contents |
| --- | --- |
| `package.json` | pi manifest — `keywords: ["pi-package"]`, `pi.extensions` + `pi.skills`, and `repository` (this package's origin, so a shipped skill can resolve it without a checkout); the version tracks the package |
| `agents/` | composed flat agents (ralph, plan, ralph-plan, strategy, guppi) with `{{CAPABILITY:...}}` / `{{PATH:...}}` substituted — the shipped `agent-modes` extension resolves them from the package root |
| `skills/` | token-substituted skill copies (real files, never symlinks) |
| `docs/` | the repository documents those skills read (currently `docs/skills/skill-anatomy.md`), copied verbatim once per install so the reference resolves on a machine without the checkout |
| `extensions/` | copy of the repo `extensions/` tree — imports nothing from pi's runtime except the host-aliased `typebox`, so pi loads it from any directory |
| `token-map.json` | the token map `agent-modes` reads from the package root |
| `node_modules/` | the required third-party pi packages and their transitive closure |

The third-party packages supply the tools the agents need — `pi-questions`
(`ask_questions`) and `pi-web-access` (`fetch_content`). They are ordinary
runtime dependencies of this package and travel inside the staged tree, so pi
loads them from a local directory without any npm resolution of its own. An
unresolvable dependency fails the install rather than staging a package that
cannot provide those tools. Re-staging clears the children the installer owns, so
a re-run never accumulates stale copies.

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Show what would be staged and registered without writing or spawning anything |
| `--output <dir>` | Stage into `<dir>` only — no registration (tests/CI) |
| `--plugin-root <dir>` | Override the plugin root used for `{{PATH:...}}` tokens (default: token-map.json's pi value — use it for checkout or symlinked installs) |
| `--require-register` | Fail the install when the `pi` CLI cannot drive registration; by default a missing CLI warns and prints the commands to run |

If the `pi` CLI is not on `PATH`, the staged package is correct but unregistered:
the installer warns and prints the exact commands (`pi install
~/.agent-cortex/pi`, plus a `pi remove` for any superseded raw-repo source).

A superseded raw-repo source that `pi remove` cannot drop fails the install
(non-zero, naming the source still configured): pi would load both sources, so
reporting success would leave the two-source state registration exists to
prevent. Nothing is installed on that path — remove the source by hand and re-run.

A source whose path no longer exists, and a package the staged bundle ships that
you also registered standalone, are reported and left configured: the installer
never removes an entry you added. Each report gives the `pi remove` command that
resolves it, with the resolved path, because `pi remove` resolves a relative
argument against the current directory.

Re-run `agent-cortex install pi` (or `agent-cortex update pi`) after every `git pull` to refresh
the staged package; registration is already in place, so that re-run changes nothing in pi's
settings. Verify with `pi list` and `pi config` (restart pi to apply).

Refreshing the installed runtime after a release, and trying uncommitted work without
overwriting it, are recorded in [`docs/dev-loop.md`](docs/dev-loop.md).

### Desktop notifications

Desktop notifications are handled by the local `extensions/notify/` extension
(replaces the former `pi-notify` dependency). It sends an OSC desktop
notification on multi-turn tasks, labelled with the tmux session:window.pane
if available, or the project directory name otherwise.

### Pi config files

`pi/settings.json` and `pi/keybindings.json` are committed **reference
templates** for your own pi configuration. They are not installer output: pi's
`settings.json` and `keybindings.json` are pi's own user config, so
`agent-cortex install pi` leaves them alone.

### Removing a stale Copilot install

Copilot CLI is no longer a deploy target: `agent-cortex install copilot` and the
`plugin.json` manifest are gone, and nothing in this package reads or writes `~/.copilot`
any more. No installer sweeps an existing install, so a machine that used the old target
keeps a stale plugin, a cached marketplace, and an instruction block until you remove them
by hand (`agent-cortex uninstall` covers the pi and Claude installs only):

```sh
rm -rf ~/.copilot/installed-plugins/_direct/agent-cortex
rm -rf ~/.cache/copilot/marketplaces/https---github-com-jaybeeuu-agent-cortex
sed -i.bak '/<!-- agent-cortex:start -->/,/<!-- agent-cortex:end -->/d' \
  ~/.copilot/copilot-instructions.md
```

The first two paths are the old install and its marketplace cache. The `sed` deletes only
the agent-cortex block the removed `postinstall` hook appended to Copilot's own
instructions file, leaving the rest of that file — and a `.bak` copy — intact.

### Claude Code plugin (separate)

A plain `agent-cortex install claude` **materialises** the plugin into the home install
root `~/.agent-cortex/claude` — **5 agents** (`strategy`, `plan`, `ralph-plan`, `ralph`, `guppi`),
**41 skills** (copied flat per skill, `{{CAPABILITY:...}}` / `{{PATH:...}}` token-substituted — no
symlinks), `SessionStart` + `Notification` hooks, and 2 MCP servers — writes a marketplace
manifest at `~/.agent-cortex/.claude-plugin/marketplace.json` exposing `./claude`, and
registers it with Claude Code, and merges the committed `claude/settings.json` template into
`~/.claude/settings.json`: the template supplies defaults, personal values win, and the
installer owns exactly the `enabledPlugins` + `extraKnownMarketplaces` entries the template
declares — entries it does not declare are left alone — while every other key
(`permissions`, `hooks`, `env`, `statusLine`, unknown keys) is preserved. It also writes the
managed section of `~/.claude/CLAUDE.md` — the reply-shape block the pi `output-style`
extension appends, taken from the same source file — and leaves every other line of that
file alone. The only committed
Claude config is that template plus the hand-authored extras in `claude-extras/`
(`.mcp.json`, `scripts/`); the plugin subtree is generated at install time — there is nothing
to drift.

The generate-only `--output <dir>` form is for previewing and CI validation; the
documented path is the plain install to `~/.agent-cortex/claude`:

```sh
node bin/agent-cortex.mjs install claude           # materialises ~/.agent-cortex/claude + marketplace manifest AND registers it with Claude Code (user scope, idempotent)
node bin/agent-cortex.mjs install claude --dry-run       # plan generation + registration, no writes/spawns
node bin/agent-cortex.mjs install claude --require-register  # fail (non-zero exit) when the claude CLI can't drive registration
node bin/agent-cortex.mjs install claude --output /tmp/x # generate only (preview/CI) — no marketplace manifest, no registration
```

#### Try it for one session

Generate a throwaway plugin and point Claude Code at it — no install or registration
needed:

```sh
node bin/agent-cortex.mjs install claude --output /tmp/agent-cortex-claude
claude --plugin-dir /tmp/agent-cortex-claude
# verify what loaded:
claude --plugin-dir /tmp/agent-cortex-claude plugin details agent-cortex
```

Edits to the generated copy of a `SKILL.md` are picked up live; re-run the generator after
editing the checkout. Agent, hook, and MCP changes need `/reload-plugins`.

Trying uncommitted work without overwriting the installed runtime is recorded in
[`docs/dev-loop.md`](docs/dev-loop.md).

#### Install persistently (recommended)

The plain install does both halves in one step: it materialises the plugin into
`~/.agent-cortex/claude`, writes `~/.agent-cortex/.claude-plugin/marketplace.json` (the
home install root doubles as the marketplace root — the manifest exposes `./claude`), and
registers it with Claude Code by driving the `claude plugin` CLI against that root at
**user scope** (the `claude plugin install` default, so the plugin is available in every
session — the recommended persistent flow). Registration is idempotent by state, not by
exit code: `claude plugin marketplace list --json` picks add-vs-update and
`claude plugin list --json` picks install-vs-update against the materialised version. A
fresh install adds the marketplace and installs the plugin; a re-run is the update path
(`marketplace update`, plus `plugin update` only when a newer version is materialised); a
repeat install at the same version is a true no-op. Those commands exit 0 on a manifest Claude
rejects, so the installer re-reads `claude plugin list --json` after they run. A plugin that
list reports as failed to load fails the install with Claude's validation message. A list the
installer cannot read, or one that omits the plugin, warns that the load state is unconfirmed
and prints no success line. It requires the `claude` plugin CLI
(Claude Code v2+): with a missing or pre-v2 CLI the installer warns and prints the manual
commands below, exiting 0 — `--require-register` makes registration mandatory and fails
non-zero when it can't run:

```sh
agent-cortex install claude                          # materialise + register (user scope, idempotent)
agent-cortex install claude --require-register       # register or fail the install
```

`--dry-run` prints the full plan without spawning the claude CLI or writing anything;
`--output <dir>` generates only, with no marketplace manifest and no registration.

The install also merges the committed `claude/settings.json` template into
`~/.claude/settings.json` (the settings file Claude Code reads at user scope). The template
supplies defaults and personal values win; the installer owns exactly the `enabledPlugins` +
`extraKnownMarketplaces` entries the template declares, so entries it does not declare (including
the one Claude Code writes when you enable the plugin) survive, and `permissions`, `hooks`, `env`,
`statusLine` and unknown keys are never touched. A legacy symlinked `settings.json` is replaced
with a real file rather than written through, and `--output` leaves the user's Claude config
alone. When registration finds the plugin installed but the settings do not enable it, the install
warns and names `claude plugin enable <plugin>@<marketplace>` — a disabled plugin loads nothing.
That check reads the user-scope file only, so a plugin enabled at project or local scope still
warns; `claude plugin list` reports the effective state.

It also writes the managed section of `~/.claude/CLAUDE.md` (Claude's user memory), delimited
by `<!-- BEGIN agent-cortex:output-style -->` / `<!-- END agent-cortex:output-style -->`. The
content is `extensions/output-style/output-style.md` — the same file the pi extension appends
to its system prompt — so both harnesses carry one copy of the rules. Text outside the
markers is never touched; a file with only one marker is left unchanged with a warning.

The equivalent manual registration adds a marketplace root by **absolute path** (a bare `.` is
rejected) — the home install root (`~/.agent-cortex`) is the marketplace root written by
the plain install; the repo checkout ships no manifest:

```sh
claude plugin marketplace add ~/.agent-cortex              # after a plain install
claude plugin install agent-cortex@jaybeeuu          # every session (user scope)
# or, for this project only:
claude plugin install agent-cortex@jaybeeuu --scope local
```

After installing, the agents and skills are available in every session with no `--plugin-dir`
flag, and Ralph is just `claude --agent agent-cortex:ralph`.

#### Update

The plain install re-materialises from the current sources, so after pulling changes
re-run it — it refreshes the materialised plugin and re-registers whatever the installed
state says is out of date (`marketplace update`, plus `plugin update` only when a newer
version is materialised; a repeat install at the same version is a no-op) in one step:

```sh
git pull
agent-cortex install claude                # re-materialise + refresh (restart Claude Code to apply)
```

Registration matches the marketplace by **name**, not path: a marketplace previously added
from a different root is refreshed in place rather than re-pointed at the fresh home
install. Re-point it with
`claude plugin marketplace remove jaybeeuu` and re-run the install.

The plain install IS the update — there is no separate build step, and `agent-cortex update claude`
is the same materialise-and-register run selected by name. (`--output <dir>` only generates a
preview and never refreshes an installed plugin.)

#### Uninstall

`agent-cortex uninstall claude` is the inverse of the install: it deregisters the plugin and the
marketplace through the `claude plugin` CLI, removes exactly the settings entries the install
declared, removes the managed `~/.claude/CLAUDE.md` section, and deletes
`~/.agent-cortex/claude` plus the marketplace manifest. Personal settings and entries you added
survive. See
[Removing a harness install](#removing-a-harness-install-agent-cortex-uninstall) for the selection
rules, `--all`, and the recovery path when a removal is incomplete.

The equivalent manual commands, for a machine whose `claude` CLI cannot drive the deregistration:

```sh
claude plugin uninstall agent-cortex@jaybeeuu -y
claude plugin marketplace remove jaybeeuu
rm -rf ~/.agent-cortex/claude ~/.agent-cortex/.claude-plugin/marketplace.json
```

#### Using the agents

| Agent | How to invoke | Purpose |
|---|---|---|
| `strategy` | delegate: "use the **strategy** agent…" | Vision brief / PRD / technical-direction docs |
| `ralph-plan` | delegate: "use the **ralph-plan** agent…" | Explore, grill, and file beads for a change |
| `plan` | delegate: "use the **plan** agent…" | End-to-end planning (PRD → classified beads) |
| `guppi` | **run as the main agent**: `claude --agent agent-cortex:guppi` | HITL counterpart to ralph (below) |
| `ralph` | **run as the main agent**: `claude --agent agent-cortex:ralph` | Parallel backlog orchestrator (below) |

Skills auto-trigger from their descriptions, or invoke one explicitly as
`/agent-cortex:<skill>` (e.g. `/agent-cortex:tdd`).

The lean **Ralph** runs as the interactive main agent (not delegated — it must stay alive to
receive its workers' completions):

```sh
claude --agent agent-cortex:ralph        # (omitted once installed via agent-cortex install claude; else --plugin-dir ~/.agent-cortex/claude)
```

It finds ready beads, spawns parallel background workers (implement → independent review →
fix), opens a PR per feature, and pauses at each human merge gate. After you merge, re-invoke
it and it resumes from `bd ready`.

#### guppi — the HITL counterpart to ralph

**guppi** is the human-in-the-loop counterpart to ralph, and it sits above `plan`: `plan` shapes one
feature into beads, guppi decides which feature that is. Ralph executes the work an agent can do;
guppi does the work an agent cannot do alone — design, ideation, prioritisation, human review and
manual confirmations — beside the human. It is resident: it opens with the queue's first ten rows,
one line each, and marks the top row as the recommendation with its reason, then loads `plan`,
`grill-me`, `hitl-collab`, `flesh-out-idea` or `strategise` for the chosen item. It coordinates
with ralph over the peer channel, where the bead stays the record ralph reads and a peer message
about it is a courtesy. While a task is in hand it writes anywhere in the workspace and commits,
pushes and merges for that task, recording each merge on the bead; it never executes AFK work, and
a disagreement with a priority opens a strategy review rather than a silent reorder. When that item
is done it re-ranks at the boundary: the theme's next item against the queue's top item, both
scores on screen, then one question — stay in the theme, switch to higher-priority work, or move
for a single item. When the answer is a switch or a move, never a stay, it flushes the window — and
only after writing what was decided, what is open and what comes next to the bead trail and the
memory. The tracker, not the window, holds the state that matters.

```sh
claude --agent agent-cortex:guppi
```

Its authority is prioritisation, not action. `strategise` owns the committed strategy file, and
`prioritise` is the score-then-rank sequence that refuses to run on an invalid one;
`score-bead` records the score, and `hitl-queue` prints the first ten rows of the order and marks
the top one as the recommendation, quoting the line of the strategy that justifies it. guppi
reports them as stored; a different order is a reprioritisation, where `prioritise` rescores and
re-ranks and `strategise` records the change before the list moves. Personal work is a town-level bd
scope — no rig, no polecats, no refinery, no merge queue.

#### Hooks

`SessionStart` injects a per-session policy nudging Claude to prefer the shipped skills over
ad-hoc choices: the "style policy" (invoke `style-code` / `style-tests` /
`style-documentation` / `style-comms` before the corresponding work — their descriptions also
auto-trigger proactively) and the "skill policy" (`using-agent-skills` for routing, `bd-tool`
for beads context, `git-workflow` for branch/PR discipline). A `Notification` hook matched on
`agent_completed|agent_needs_input|permission_prompt` raises a desktop notification when a
task finishes, waits on input, or needs approval. See `docs/claude-hooks.md` for the full
extension→hook audit.

#### Not ported / follow-ups

- Only `session-start` and `notify` had Claude equivalents (both ported to hooks); the other
  pi `extensions/` (auto-name, agent-guardrails, skill-stats, subagent, agent-modes,
  post-merge-watch, idle-watch) have none — `output-style`
  reaches Claude through the managed `CLAUDE.md` section instead; the audit and
  rejection rationale live in `docs/claude-hooks.md`.
- Ralph follow-ups: multi-feature epic branches, and a GitHub-trigger routine to auto-resume
  after a PR merge (instead of manual re-invocation).
- Ralph's per-task pipeline is shared, not ported: `ralph` and `run-pipeline-stage` ship to
  Claude and compose from the same harness-neutral body as pi, differing only in the wake section.

#### Contributing to the Claude plugin

Edit the **sources** — the composable `agents/<name>/` directories (shared `agent.md` +
per-harness frontmatter/sections, composed by `bin/installers/claude.mjs`), `skills/**`,
`hooks/claude/hooks.json` (hook config), `claude/settings.json` (the user-settings template
merged into `~/.claude/settings.json`), `claude-extras/` (hand-authored `.mcp.json` and
`scripts/`), and `package.json` (plugin
version — picked up at install time) — then run
`agent-cortex install claude` (re-materialises the home plugin, merges settings, and
re-registers it; `--output <dir>` generates a preview only). The only committed file under
`claude/` is the settings template; `~/.agent-cortex/claude` is generated in full
(`.claude-plugin/plugin.json`, `agents/`, `skills/`, `docs/`, `hooks.json`, `.mcp.json`, `scripts/`)
so never edit anything under it. CI validates the Claude materialiser (structural checks on
a temp-dir install) so sources and installer can never silently diverge.

## Checking installed versions (`agent-cortex version`)

`agent-cortex version` prints the running CLI version, then one line for each installed
harness: its name, the version its installer recorded, and a marker. The fingerprint is the
manifest the installer already writes — `~/.agent-cortex/pi/package.json` for pi and
`~/.agent-cortex/claude/.claude-plugin/plugin.json` for Claude Code — so the report needs no
separate state file.

```sh
agent-cortex version            # CLI version, then one line per installed harness
agent-cortex version --json     # the same data as JSON records
agent-cortex --version          # the bare CLI version, for scripts
```

The marker is `current` when the installed copy matches the running CLI, `stale` when it is
older, and `ahead` when it is newer — a downgraded CLI leaves its installs ahead of it. A
harness root that exists with a missing or broken fingerprint reports `unknown` for both the
version and the marker, because an install that cannot be read is never reported as `current`.
Only plain release versions are compared, so a prerelease on either side also reports
`unknown`. A harness with no installer gets no line.

The command is read-only: it stats and reads those manifests, and never installs, writes, or
reaches the network.

## Updating the CLI itself (`agent-cortex self-update`)

`agent-cortex self-update` updates the globally installed CLI through the manager that installed it,
then refreshes the installed harnesses with the newly installed binary.

```sh
agent-cortex self-update           # report, update, then refresh the installed harnesses
agent-cortex self-update --check   # report the versions and the command, write nothing
```

The owning manager is inferred from the running entry point's real path, then confirmed — never
assumed. A pnpm install lives under `<prefix>/global/<v>/…` (and the store link that path resolves
into), an npm install under `<prefix>/lib/node_modules/…`, and the manager binary is taken from that
`<prefix>` rather than from `PATH`. That matters because two managers can be installed and only one
of them owns this copy: running the manager on `PATH` would update the wrong store or fail. The
confirmation asks the inferred manager for its own global listing and matches this package's name
and version. An owner that cannot be inferred or confirmed prints the command to run and exits
non-zero — both managers' commands when it cannot even infer the layout, because that choice is
the user's. Neither message prints a tag: each names the version this copy holds and asks for the
published version in place of `<version>`, because a tag stays inside the range the manager already
recorded and so cannot cross a major release. The CLI never falls back to a manager found on `PATH`.

The report gives the installed version (read from the manifest beside the entry point, so even a
stale process reports what is on disk), the published version (from the confirmed manager's `view`),
the owner, and the command it would run. A registry error is its own failure: it prints the
manager's error, offers no update, and exits non-zero. A failed install reports the manager's stderr
and runs nothing after it. Once the install succeeds, the command reports the CLI version before and
after (`cli        1.2.3 → 1.4.0`). The version now on disk is read from the prefix the manager wrote
to, because the running process is still the old code; when that listing answers nothing, the newly
installed binary is asked instead, and a binary that disagrees with the listing is named as another
copy. When neither source answers, the update is unverified: the refresh still runs, because the
install exited 0 and a refresh is repeatable, but the command exits non-zero. One command brings the
CLI and the installed harnesses to the same version, and otherwise the exit code is the refresh's.

The refresh spawns `<prefix>/bin/agent-cortex` from that same inferred prefix with an argv array and
inherits the terminal, so the refresh's own output is what the user reads. It is skipped in four
cases: `--check`, a failed update, an install that exits 0 but leaves the version on disk
unchanged, and an install already at the published version (where `agent-cortex update -a` is the
refresh that is left). A refresh that cannot start — the path is
POSIX-shaped, while native Windows pnpm and npm write `.cmd` shims it does not match, and Node cannot
start a `.cmd` without a shell — prints the reason and the exact command to run by hand, and exits
non-zero. The CLI update has already succeeded by then, so `agent-cortex update -a` finishes the job.

```sh
# what it reports, for a copy installed by a pnpm that is not the one on PATH
agent-cortex self-update --check
#   installed  1.2.3
#   published  1.4.0
#   owner      pnpm (/opt/pnpm-home/bin/pnpm)
#   status     update available: 1.2.3 → 1.4.0
#   command    /opt/pnpm-home/bin/pnpm add -g @jaybeeuu/agent-cortex@1.4.0

# what a bare run adds after that report
agent-cortex self-update
#   ✓ /opt/pnpm-home/bin/pnpm add -g @jaybeeuu/agent-cortex@1.4.0
#   cli        1.2.3 → 1.4.0
#   → refreshing installed harnesses with /opt/pnpm-home/bin/agent-cortex update -a
#   …the new binary's own update report…
```

## Refreshing installed harnesses (`agent-cortex update`)

`agent-cortex update` re-runs a harness installer and reports what changed. It installs nothing
itself: every refresh goes through the same path as `agent-cortex install <harness>`, so update and
install can never disagree about what is out of date.

```sh
agent-cortex update                 # list the harnesses, then ask which to refresh
agent-cortex update pi claude       # refresh exactly these, no prompt
agent-cortex update -a              # refresh every installed harness not at the CLI version
agent-cortex update -a -f           # re-run every installed harness installer regardless of version
```

The prompt lists every installed harness with its installed version, the CLI version, and a status
marker (`current`, `stale`, `ahead`, or `unknown`) — the data `agent-cortex version` reports,
plus a row for a harness with no install. Answer with row numbers counted from the top row, `a`
for every installed harness, or blank to cancel.

Updating never installs a harness. One that was never installed is reported `not installed` — its
own state, not a stale version — and left alone by every path: the prompt, `-a`, `-a -f`, and
`agent-cortex self-update`, which runs `update -a` itself. Installing is
`agent-cortex install <harness>`'s job, so naming an absent harness on the command line is an
error, not an install.

An earlier release installed a harness through `agent-cortex update <harness>`. That no longer
works. Run `agent-cortex install <harness>` once to install it, then `update` refreshes it as
before.

An installed harness named on the command line always refreshes, whatever version it reports, and
takes precedence over `-a`. `-a` refreshes every installed harness that does not report `current`,
so a stale, ahead, or unreadable harness is refreshed. `-f` requires `-a`: alone it says
nothing about which harnesses to touch. An unknown name fails before any installer runs.

A shell that is not a terminal cannot answer the prompt, so a bare `agent-cortex update` there
prints the same table plus the flags above and exits non-zero — a script can never mistake
"nothing chosen" for "nothing to do".

`update` exits 0 when every refresh it attempted completed — including a selection that refreshed
nothing — and 1 when an installer fails, a harness name is unknown or names a harness that is not
installed, an option cannot be parsed, or a bare invocation has no terminal to prompt on.
`agent-cortex self-update` hands the refresh's exit code back, so a failed refresh fails the whole
command.

The report gives each refreshed harness its previous version, its new version, and the artifacts
the installer wrote. A previous version it cannot read is reported as `unknown` — the same state
the table uses — because the refresh touched the harness, so `not installed` stays reserved for
one update left alone. Installed harnesses already at the CLI version are listed as skipped, and
each harness that was never installed is reported as `not installed` with the command that
installs it. A harness's new
version is read back from the manifest its installer wrote, so a refresh that failed to
materialise reports `unknown` rather than claiming the CLI version.

This refreshes the installs, not the CLI. `agent-cortex self-update` does both in one step; the
[`docs/dev-loop.md`](docs/dev-loop.md) page records what a global reinstall has to fix.

## Removing a harness install (`agent-cortex uninstall`)

`agent-cortex uninstall` is the inverse of `agent-cortex install`: it removes a harness install and
the registration that goes with it. Registration is undone through the harness's own CLI — `pi
remove` for pi, `claude plugin uninstall` plus `claude plugin marketplace remove` for Claude Code —
and never by writing the harness's settings file. On the Claude side it also removes exactly the
`enabledPlugins` + `extraKnownMarketplaces` entries the install declared, the managed section of
`~/.claude/CLAUDE.md`, the plugin directory and the marketplace manifest, so personal settings and
entries you added survive.

```sh
agent-cortex uninstall              # list the installed harnesses, then ask which to remove
agent-cortex uninstall pi claude    # remove exactly these, no prompt
agent-cortex uninstall -a           # remove every installed harness, after confirming
agent-cortex uninstall --dry-run    # print what would be removed and write nothing
```

The prompt lists the harnesses that have an install, because one that was never installed has
nothing to uninstall. Answer with row numbers counted from the top row, or blank to cancel. A
cancel removes nothing and exits 0.

`--all` is destructive, so it asks for confirmation on a terminal. Only `y` or `yes` proceeds:
every other answer, a blank one and a closed input included, removes nothing. In a shell that is
not a terminal no prompt can be answered, so `--all` is the explicit opt-in there. A dry run is not
confirmed, because it writes nothing. `--all` cannot be combined with a harness name, because the
flag already covers every installed harness.

A shell that is not a terminal cannot answer the selection prompt either. A bare
`agent-cortex uninstall` there prints the same table plus the flags above and exits non-zero, so a
script can never mistake "nothing chosen" for "nothing to do".

`uninstall` exits 0 when every removal completed, including a run that found nothing to remove,
and 1 when a removal is incomplete, a harness name is unknown, an option cannot be parsed, or a
bare invocation has no terminal to prompt on. A named harness that is not installed is not an
error: the report says `already absent` and the exit code stays 0, so a second run is safe and a
script needs no prior check.

### What `--all` leaves

Two decisions bound the removal:

- **Harness installs, not the CLI.** The package manager that installed `agent-cortex` owns its
  removal, so `--all` never uninstalls the CLI. The shared `~/.agent-cortex` root stays too: it
  holds records that outlive a harness install (`legacy-sweep.json`, `scopes.json`), so removing it
  would delete state no installer owns. The report names both.
- **No worktree is deleted.** A worktree under `.agent-cortex/worktrees/` may hold uncommitted
  work, and `uninstall` did not create it, so reporting it is the least destructive answer. `--all`
  lists every one it finds and names `git worktree remove <path>`; it deletes none.

Remove the CLI with the manager that installed it — `pnpm remove -g @jaybeeuu/agent-cortex`, or
`npm uninstall -g @jaybeeuu/agent-cortex` — and `~/.agent-cortex` by hand, when you want those
records gone as well.

### When a removal is incomplete

A harness that is registered but cannot be deregistered is reported as `partially removed — the
harness registration is still outstanding`. The warning names what survived and prints the exact
commands that finish the job, and the run exits 1. That happens when the harness CLI is missing or
too old, or when it rejects the command.

The removal stays retryable, so nothing is orphaned. The staged pi directory is deleted only after
`pi remove` succeeds. The Claude plugin directory, the marketplace manifest and the declared
settings entries are left in place until the deregistration succeeds, so the next attempt starts
from the state it finds. Run the printed commands by hand, then run
`agent-cortex uninstall <harness>` again.

A Claude install whose marketplace manifest is missing or unreadable cannot name itself: nothing is
removed, the harness is reported incomplete, and the warning gives the
`claude plugin uninstall <plugin>@<marketplace>` command to use instead.

## Migrating a beads workspace

`agent-cortex migrate` brings the `.beads` workspace it runs in — any repo, not just this
one — up to the latest agent-cortex migration version. The current version is derived from
the workspace's own state (the first step with pending work), so there is no marker file to
drift and a re-run after an apply is a no-op. Step v1 renames `implementation-type:afk|hitl`
labels to `execution:afk|hitl` on every bead carrying them, closed ones included: the goal
is an empty legacy namespace, not just a clean live one (see
`docs/technical-direction/migration-execution-labels.md` for the two-axis model behind it).

A bare `agent-cortex migrate` is a **dry run** — it prints the per-bead plan and writes
nothing. `--apply` runs every pending step in order and verifies each before moving on. It
shells out to the `bd` CLI on `PATH` (`BD_PATH` overrides) and fails loudly, rather than
half-applying, when `bd` is missing or a `bd` subcommand errors. Label writes carry at most 20
ids per `bd` call, because `bd` can exit 0 having applied only part of a longer list.

Detection reads `bd export --all` and cross-checks `bd label list-all`, never a
label-filtered `bd list`: on bd 1.3.1 that query can omit closed beads, which once let a
partially migrated workspace report itself as verified. When the label index still reports a
legacy label that no exported bead carries — or a legacy label survives the apply — `migrate`
names the beads and exits non-zero.

```sh
agent-cortex migrate            # dry run — per-bead plan, zero writes
agent-cortex migrate --apply    # apply pending steps, verifying each
```

## Registering bd workspaces (`agent-cortex scope`)

`agent-cortex scope add` registers a bd workspace in the user-level scope list, so the list the
`hitl-queue` skill reads no longer has to be hand-edited. `agent-cortex scope list` prints what a
run in the current directory resolves.

```sh
agent-cortex scope add --path ../ops        # name: the directory's own name; kind: code
agent-cortex scope add --path ~/personal --name notes --kind personal
agent-cortex scope list                     # name, kind, read-only flag, availability, path
```

The list is the user-level one — `<AGENT_CORTEX_HOME>/scopes.json`, `~/.agent-cortex/scopes.json`
by default. A repository's own `.agent-cortex/scopes.json` is committed and reviewed like source,
so `add` writes only the user list. Both commands resolve paths and validate the file through the
`hitl-queue` skill's `scopes.mjs`, so `scope list` shows `~` and relative paths as the queue
resolves them.

`add` refuses a directory that does not exist, is not a directory, or carries no `.beads` of its
own, and names the check that failed. The marker is tested at that exact directory, never by
walking up: bd resolves a workspace by walking up, so a nested directory would otherwise read the
enclosing workspace's beads and tag them with the wrong scope.

A configured list replaces the implicit "workspace you are standing in" scope, so `add` keeps the
current workspace in the written list as the `code` entry and reports that it did. The write is a
read-modify-write of one entry: every other entry and every unknown key survives, and the merged
document is validated by the queue's own parser before any write, so a malformed file is refused
rather than truncated.

Exit `0` means a write or a listing succeeded, `2` a refusal the command explains, and `1` an
invocation it cannot parse.
