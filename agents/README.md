# Agent Directory Format

This document defines the canonical format for composable agent directories in agent-cortex.

## Motivation

The original format used a single `*.agent.md` file per agent, combining harness-agnostic logic with harness-specific configuration. This created duplication when the same agent needed to run on multiple harnesses (PI, Claude) with different tool names and wake mechanisms.

The composable directory format separates concerns:

- **Shared body**: Harness-agnostic instructions (workflow, branching model, constraints)
- **Authored tool set**: The capabilities the agent may use, plus the skills it loads — one file
  for both harnesses
- **Harness-specific frontmatter**: Model and metadata per harness
- **Section files**: Harness-specific instructions (e.g., the harness wake mechanism) included via tokens

## Directory Structure

```
agents/
├── <agent-name>/
│   ├── agent.md                    # Shared body (harness-agnostic)
│   ├── tools.json                  # The agent's tool set and the skills it loads
│   ├── pi/
│   │   ├── frontmatter.json        # PI-specific metadata
│   │   └── <section>.md            # Optional: PI-specific sections
│   └── claude/
│       ├── frontmatter.json        # Claude-specific metadata
│       └── <section>.md            # Optional: Claude-specific sections
```

### Example: ralph agent

```
agents/ralph/
├── agent.md                        # Shared body (branching model, dispatch logic, constraints)
├── tools.json                      # One authored set: bash, view, rg, glob, skill, task,
│                                   #   the peer rows, the worker rows; skills it loads
├── pi/
│   ├── frontmatter.json            # PI metadata (no tools — see tools.json)
│   └── wake.md                     # PI wake: blocking wait_for_agents (no poll timer)
└── claude/
    ├── frontmatter.json            # Claude metadata (no tools — see tools.json)
    └── wake.md                     # Claude wake: event-driven re-invocation on worker completion
```

### Wake mechanisms by harness

`{{SECTION:wake}}` is the one seam where harness differences belong: the shared `agent.md`
names no harness and no harness-specific tool, and every one of those facts lives in a
`wake.md` that states its mechanism in one sentence, then covers **spawn** (tool and argument
shape), **completion arrival**, **id tracking**, **trail reading**, and **stop** behaviour.
`token-map.json`'s `wake.mechanism` table records the same fact machine-readably.

| Harness | `wake.mechanism` | Completion arrives via | Id tracking | Stop means |
|---------|------------------|------------------------|-------------|------------|
| `pi` | `blocking-wait` | `wait_for_agents` returns as soon as a worker finishes, result inline | `agentId` only | stop calling `wait_for_agents` — nothing to kill |
| `claude` | `event-driven` | harness re-invokes ralph with the result inline | task ID only | simply stop — nothing to kill |

### Example: plan agent (no per-harness sections)

```
agents/plan/
├── agent.md                        # Shared body (planning workflow)
├── tools.json                      # One authored set and the skills it loads
├── pi/
│   └── frontmatter.json            # PI metadata
└── claude/
    └── frontmatter.json            # Claude metadata
```

## File Specifications

### agent.md

The shared body contains everything harness-agnostic:

- Workflow instructions
- Branching model
- Stage pipeline rules
- Bead lifecycle management
- Constraints and guardrails
- Any shared logic

**No YAML frontmatter.** The file is pure markdown.

### tools.json

The agent's **tool set** — the capabilities it may use, and the skill directories whose files it
loads — authored once for the agent and rendered into every harness:

```json
{
  "tools": ["bash", "view", "task", "peer_send", "peer_list"],
  "skills": ["workflow/ralph", "workflow/run-pipeline-stage"]
}
```

#### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `tools` | `string[]` | The capabilities the agent may use, as canonical capability keys (non-empty), or the single sentinel `["*"]` for every tool the session has |
| `skills` | `string[]` | The skill directories the agent's instructions tell it to load, repo-relative and one group deep (e.g. `workflow/ralph`). May be empty |

#### Constraints

- No unknown fields allowed (strict schema)
- `tools` may be the single sentinel `["*"]`, which means every tool the session has. It is the
  only value that means "all", and it cannot be combined with tool names: the validator
  (`scripts/validate-agent-dir.mjs`) and both installers reject a mixed list with an error, so a
  build fails instead of resolving one. A rendered literal would not be equivalent either: pi's
  `--tools` compiles a lone `*` to `^.*$`, which matches every tool name, so pi would grant full
  access rather than less. Claude Code's `tools:` field takes exact names, so the same literal
  would name none of its tools.
- Surrounding whitespace is ignored, so `["* "]` is the same sentinel as `["*"]`, in both
  installers and in the `agent-modes` runtime that reads the composed agents
- Both installers resolve `["*"]` by omitting the rendered `tools:` line, so the harness
  inherits its own full tool set. An authored set never renders a literal `*`
- Every `skills` entry must name a directory holding a `SKILL.md` under the package's `skills/`
  tree. A stale entry fails the validator, because the coverage check would otherwise walk no
  text and report a mapping that covers nothing as complete

#### Why the set is not in `frontmatter.json`

The set is behaviour, not harness metadata: it is what the harness enforces. A set authored twice —
once per harness — drifts, and the drift is silent. It already had: ralph's pi list named none of
the peer tools its own runbook instructed it to call, so the agent reported them as unavailable, and
that reads like a transport fault rather than a missing list entry. One authored set is therefore
checked against the text that names tools (see _Coverage check_).

#### Example with the all-tools sentinel

```json
{
  "tools": ["*"],
  "skills": ["workflow/prioritise", "workflow/hitl-queue"]
}
```

`"*"` is an authored form only. The harness reads the resulting agent as having no tool
restriction at all, which is how an agent reaches tools that cannot be named at authoring time —
MCP connector tools carry a per-machine name (`mcp__<server>__<tool>`), so no fixed list can
include them. An absent `tools` key is never the authored form: the schema requires the key, so a
forgotten set is a validation error rather than a silent grant of every tool.

#### A capability that is a command on either harness

One set renders for both harnesses, and the harness where a row is a `command` refuses it in a tool
list — a command is user-invoked and not model-callable. A **mixed-kind row** (a tool on one
harness, a command on the other) therefore cannot be granted through a tool set at all: it stays
prose-only, and the prose states what the session does without the mechanism. `post_merge_watch` is
the worked example — it is a tool on Claude Code and a command on pi, and
`skills/workflow/run-pipeline-stage/playbooks/post-merge.md` pairs it with the no-watcher fallback.
The coverage check does not demand a mixed-kind row, and a set that names one still fails the
render, naming the canonical key.

#### Coverage check

`test/agent-tool-coverage.test.mjs` stages both installs (`--output <dir>`) and, for each agent and
harness, collects every `{{CAPABILITY:x}}` token from `agent.md`, that harness's section files, and
every markdown file of every skill in the agent's `skills` list. It then requires the staged
frontmatter to grant each capability that is a `tool` there. A capability with a `null` mapping for
that harness is not required, a `command` is not required, a mixed-kind row is not required, and the
all-tools sentinel grants everything. A `{{CAPABILITY:x}}` with no row at all is a failure, because
the map must stay complete.

```bash
node --test test/agent-tool-coverage.test.mjs
```

The check reads the staged artefact, never this checkout: a check that passes only because the
repository is present is not a check.

### frontmatter.json

JSON schema for harness-specific metadata:

```json
{
  "name": "agent-cortex:ralph",
  "description": "Parallel task orchestration agent",
  "model": "claude-sonnet-4-5",          // optional
  "argumentHint": "Run all pending beads"  // optional
}
```

#### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Agent identifier (e.g., `agent-cortex:ralph`) |
| `description` | `string` | What the agent does (used in agent selection) |

#### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string` | Preferred model for this harness |
| `argumentHint` | `string` | Usage hint shown to users |

#### Constraints

- No unknown fields allowed (strict schema)
- `name` and `description` must be non-empty strings
- `tools` is not a frontmatter field. The tool set is authored once, in `tools.json`; a
  `frontmatter.json` that carries `tools` is rejected by the validator and by the composer, naming
  the file that now holds it

### Section Files

Optional markdown files in harness subdirectories that contain harness-specific instructions. Included via `{{SECTION:name}}` tokens in agent.md.

Examples:
- `wake.md` — How a background worker's completion reaches the agent (polling, blocking wait, event-driven)
- `authentication.md` — Harness-specific auth setup
- `output-format.md` — Harness-specific output formatting

## Token Format

Tokens in agent.md reference capabilities, paths, and sections:

| Token | Syntax | Description |
|-------|--------|-------------|
| Capability reference | `{{CAPABILITY:name}}` | Canonical capability name; resolved per harness from `token-map.json` |
| Path reference | `{{PATH:path}}` | Canonical path name; resolved per harness from `token-map.json` |
| Section include | `{{SECTION:name}}` | Include content from a section file in the harness directory (substituted by the composer) |

A capability is a **tool** or a **command**, and the kind is per harness, because the same
capability can be one on one harness and the other on the next. A `tool` is offered to the
model and may appear in a tool set. A `command` is invoked directly by the user or agent —
a slash command, or an extension's command — and may appear in rendered prose only. Naming a
`command` in a tool set is a hard error naming the canonical key, never a silent omission.
The map states the kind beside each name, so no consumer has to infer it.

A `tools` entry in `tools.json` is a canonical capability key. An installer translates each key
through its own column of the map, so the same authored set serves both harnesses: a row the
harness maps to `null` is omitted from that harness's rendered list. A harness-native name is
still accepted where nothing else can express it (the map cannot grow a row for a tool only one
harness offers under a name no other harness would use), but a capability key is the form to
prefer — it is the form the coverage check can prove.

Installers substitute those three token types only. A token with any other type stays in the
text, so it reaches the harness as literal prose. `{{TOOL:...}}` was the earlier name of the
capability token: a file that still writes it composes with the token intact, and the harness
reads it as text rather than as a tool. Rename it to `{{CAPABILITY:...}}`.

### Examples

```markdown
Use {{CAPABILITY:task}} to spawn subagents.

Read {{PATH:skills/workflow/plan/SKILL.md}} for the full workflow.

{{SECTION:wake}}
```

When composing the final agent file for a specific harness:

1. Start with agent.md content
2. Replace `{{SECTION:name}}` with content from `<harness>/<name>.md`
3. `{{CAPABILITY:name}}` and `{{PATH:name}}` are resolved against `token-map.json` — the
   canonical capability/path/agent names per harness. `scripts/lib/compose-agent.mjs` (used by
   `bin/installers/claude.mjs` / `bin/installers/pi.mjs`) resolves them when generating the flat
   files / installing for claude and pi; pi's `agent-modes` extension does the same at runtime. See the `contract` section of `token-map.json` and
   `token-map.README.md` for the rules.

A `{{PATH:skills/…}}` row is authored against this repository's tree, which nests every skill
one group deep, and resolves to the tree the harness stages. Claude Code stages skills flat, so
the row loses its group segment there; the pi install keeps it. `token-map.json`'s `layouts`
table records the shape per harness, so a row never names a file the install does not contain.

The pi harness's `agent-modes` extension is a runtime consumer of this format: it
composes agent prompts on the fly from `agent.md` + `pi/frontmatter.json`, substituting
tokens against `token-map.json`'s pi column with no install step. See
`extensions/agent-modes/README.md`.

### Rendered tool lists are comma-separated

pi's `parseFrontmatter` returns the `tools` scalar as one string, and its consumers split
that string on commas — the subagent extension forwards it straight to `pi --tools`, whose
parser is comma-separated too. Generated pi agents therefore render
`tools: "bash, read, task"`; a space-separated list collapses to a single bogus name and
leaves the agent with an allowlist matching no tool. Both parsers
(`extensions/subagent/agents.ts`, `extensions/agent-modes/discover.ts`) accept whitespace
as well, so either form round-trips safely.

A resolved list of exactly `["*"]` renders no `tools:` line at all, on either harness, so
neither consumer reads a value it has to interpret: pi enables every tool, exactly as it does
when `--tools` is absent, and Claude Code's `tools:` field, which takes exact names, never sees
a `*` that names none of its tools. Rendering the literal instead would not be equivalent: pi
compiles `*` to `^.*$`, while Claude Code would read a name no tool has. An agent whose
rendered frontmatter has no `tools:` key therefore runs with every tool (see
`extensions/agent-modes/discover.ts`).

## Composition Rules

### For Harnesses with Sections

When a harness directory contains section files:

```
agent.md + tools.json + pi/frontmatter.json + pi/wake.md → composed agent
```

The composer:
1. Reads agent.md as the base
2. For each `{{SECTION:name}}` token, reads `<harness>/<name>.md` and replaces the token
3. Prepends YAML frontmatter composed from `<harness>/frontmatter.json` and `tools.json`
4. Outputs the composed agent file

### For Harnesses Without Sections

When a harness directory only has frontmatter.json:

```
agent.md + tools.json + pi/frontmatter.json → composed agent
```

The composer:
1. Reads agent.md as the base
2. No section replacements needed
3. Prepends YAML frontmatter composed from `<harness>/frontmatter.json` and `tools.json`
4. Outputs the composed agent file

### Agents with No Per-Harness Differences

Agents like `plan`, `ralph-plan`, `guppi`, and `strategy` that have identical behavior across
harnesses still need per-harness directories for their frontmatter.json (the metadata and the
model can differ), while the tool set is authored once for both.

```
agents/plan/
├── agent.md              # Shared body (same for all harnesses)
├── tools.json            # One authored tool set
├── pi/frontmatter.json   # PI metadata
└── claude/frontmatter.json    # Claude metadata
```

## Migration Path

1. Define the format (this document)
2. Migrate ralph agent first (proves the pattern) — DONE
3. Migrate plan, ralph-plan, strategy agents — DONE
4. Update the installer/composer to handle the new format
5. Remove old `*.agent.md` files — DONE (the composable directories are the only committed
   form; every harness composes or renders its own agent files at install time)

All five agents (`ralph`, `plan`, `ralph-plan`, `guppi`, `strategy`) use the composable layout, and no
flat agent file is committed:

- `bin/installers/claude.mjs` (plain `agent-cortex install claude` materialises the plugin
  into `~/.agent-cortex/claude` and registers it with Claude Code; `--output <dir>` is its
  generate-only form, used by tests/CI) composes the plugin's
  `agents/*.md` from each agent's `claude/` harness dir — `ralph` included.
- The pi harness delivers two ways: the `agent-modes` extension composes `agent.md` +
  `pi/frontmatter.json` at runtime against `token-map.json`, and `agent-cortex install pi`
  renders flat pi agents + token-substituted skills into a self-contained package at
  `~/.agent-cortex/pi`, which pi loads once registered (see README "Pi package staging
  (`agent-cortex install pi`)"). `agent-modes` and the `subagent` extension both read agents
  beside themselves,
  so the staged package needs no `~/.pi/agent` writes.

Never edit the generated flat materialised files by hand — edit the composable directory.
Generation is install-time: `claude` ships
via `bin/installers/claude.mjs`, the generator behind plain `agent-cortex install claude`
(which materialises into `~/.agent-cortex/claude`, merges the committed
`claude/settings.json` into `~/.claude/settings.json`, and registers the plugin with Claude
Code); the only committed `claude/` file is that settings template (hand-authored extras live
in `claude-extras/`), and CI validates the materialiser with structural checks on a temp-dir
install; `pi` ships via
`bin/installers/pi.mjs`, which stages a self-contained pi package (manifest, rendered
agents, token-substituted skills, extensions) at `~/.agent-cortex/pi`.

## Validation

The composable layout is validated by the repo tooling at `scripts/validate-agent-dir.mjs` — a
module, not a shipped skill, with no CLI. Import `validateAgentDir` to check a directory, or run
its test suite:

```bash
node --test test/validate-agent-dir.test.mjs
```

The validator checks:
- agent.md exists
- tools.json exists, conforms to its schema, and every `skills` entry names a real skill directory
- At least one harness subdirectory with valid frontmatter.json
- Frontmatter conforms to the schema (required fields, no unknown fields, and no `tools` key)

The coverage check (`test/agent-tool-coverage.test.mjs`) goes further than shape: it proves each
agent's tool set grants the capabilities its own text names, on both harnesses.

## Design Decisions

### Why JSON for frontmatter instead of YAML?

- JSON has strict syntax (no comments, no ambiguity)
- Easier to validate with JSON Schema
- Consistent with existing tooling (package.json)
- No need for YAML parser dependency

### Why separate section files instead of inline sections?

- Keeps agent.md focused on shared logic
- Allows harness-specific sections to evolve independently
- Makes it clear what's shared vs what's harness-specific
- Enables conditional inclusion (only include sections relevant to the harness)

### Why require at least one harness directory?

- Ensures every agent has explicit harness configuration
- Prevents "default harness" ambiguity
- Makes the agent's harness metadata explicit per harness

### Why is the tool set one file for both harnesses?

The list decides what the agent can do, and the harness enforces it, so it is behaviour rather than
metadata. Behaviour authored twice drifts, and the drift is silent — an agent whose list omits a
tool its own text names reports that tool as unavailable, which reads like a transport fault.
Authoring it once also makes it checkable: the coverage test compares one set against the text that
names tools, and it cannot do that when each harness holds its own half.

### Why does `skills` live beside `tools`?

Nothing else maps an agent to the skill files that name its tools: `agent.md` says "the
create-task hierarchy flow" as prose. Without that mapping no check can prove a set is complete,
which is how the omission that started this format change survived. Recording the skills in the
same authored file makes the mapping machine-readable, so the coverage check can walk the text an
agent actually reads.

### Why strict schema (no unknown fields)?

- Catches typos and configuration errors early
- Makes the format self-documenting
- Prevents accidental field additions that break tooling
