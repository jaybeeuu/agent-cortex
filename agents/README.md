# Agent Directory Format

This document defines the canonical format for composable agent directories in agent-cortex.

## Motivation

The original format used a single `*.agent.md` file per agent, combining harness-agnostic logic with harness-specific configuration. This created duplication when the same agent needed to run on multiple harnesses (PI, Claude) with different tool names and wake mechanisms.

The composable directory format separates concerns:

- **Shared body**: Harness-agnostic instructions (workflow, branching model, constraints)
- **Harness-specific frontmatter**: Tool names, model preferences, metadata per harness
- **Section files**: Harness-specific instructions (e.g., the harness wake mechanism) included via tokens

## Directory Structure

```
agents/
├── <agent-name>/
│   ├── agent.md                    # Shared body (harness-agnostic)
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
├── pi/
│   ├── frontmatter.json            # PI tools: ["bash", "task", "read_agent", "wait_for_agents"]
│   └── wake.md                     # PI wake: blocking wait_for_agents (no poll timer)
└── claude/
    ├── frontmatter.json            # Claude tools: ["bash", "task"]
    └── wake.md                     # Claude wake: event-driven re-invocation on worker completion
```

### Wake mechanisms by harness

`{{SECTION:wake}}` is the one seam where harness differences belong: the shared `agent.md`
names no harness and no harness-specific tool, and every one of those facts lives in a
`wake.md` that states its mechanism in one sentence, then covers **spawn** (tool and argument
shape), **completion arrival**, **id tracking**, **log flush**, and **stop** behaviour.
`token-map.json`'s `wake.mechanism` table records the same fact machine-readably.

| Harness | `wake.mechanism` | Completion arrives via | Id tracking | Stop means |
|---------|------------------|------------------------|-------------|------------|
| `pi` | `blocking-wait` | `wait_for_agents` returns as soon as a worker finishes, result inline | `agentId` only | stop calling `wait_for_agents` — nothing to kill |
| `claude` | `event-driven` | harness re-invokes ralph with the result inline | task ID only, no `logLine` | simply stop — nothing to kill |

### Example: plan agent (no per-harness sections)

```
agents/plan/
├── agent.md                        # Shared body (planning workflow)
├── pi/
│   └── frontmatter.json            # PI tools
└── claude/
    └── frontmatter.json            # Claude tools
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

### frontmatter.json

JSON schema for harness-specific metadata:

```json
{
  "name": "agent-cortex:ralph",
  "description": "Parallel task orchestration agent",
  "tools": ["bash", "task", "read_agent"],
  "model": "claude-sonnet-4-5",           // optional
  "argumentHint": "Run all pending beads"  // optional
}
```

#### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Agent identifier (e.g., `agent-cortex:ralph`) |
| `description` | `string` | What the agent does (used in agent selection) |
| `tools` | `string[]` | Tool names the agent can use (non-empty) |

#### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string` | Preferred model for this harness |
| `argumentHint` | `string` | Usage hint shown to users |

#### Constraints

- No unknown fields allowed (strict schema)
- `name` and `description` must be non-empty strings
- `tools` must be a non-empty array of strings

### Section Files

Optional markdown files in harness subdirectories that contain harness-specific instructions. Included via `{{SECTION:name}}` tokens in agent.md.

Examples:
- `wake.md` — How a background worker's completion reaches the agent (polling, blocking wait, event-driven)
- `authentication.md` — Harness-specific auth setup
- `output-format.md` — Harness-specific output formatting

## Token Format

Tokens in agent.md reference tools, paths, and sections:

| Token | Syntax | Description |
|-------|--------|-------------|
| Tool reference | `{{TOOL:name}}` | Canonical tool name; resolved per harness from `token-map.json` |
| Path reference | `{{PATH:path}}` | Canonical path name; resolved per harness from `token-map.json` |
| Section include | `{{SECTION:name}}` | Include content from a section file in the harness directory (substituted by the composer) |

### Examples

```markdown
Use {{TOOL:task}} to spawn subagents.

Read {{PATH:skills/workflow/plan/SKILL.md}} for the full workflow.

{{SECTION:wake}}
```

When composing the final agent file for a specific harness:

1. Start with agent.md content
2. Replace `{{SECTION:name}}` with content from `<harness>/<name>.md`
3. `{{TOOL:name}}` and `{{PATH:name}}` are resolved against `token-map.json` — the
   canonical tool/path/agent names per harness. `scripts/lib/compose-agent.mjs` (used by
   `bin/installers/claude.mjs` / `bin/installers/pi.mjs`) resolves them when generating the flat
   files / installing for claude and pi; pi's `agent-modes` extension does the same at runtime. See the `contract` section of `token-map.json` and
   `token-map.README.md` for the rules.

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

## Composition Rules

### For Harnesses with Sections

When a harness directory contains section files:

```
agent.md + pi/frontmatter.json + pi/wake.md → composed agent
```

The composer:
1. Reads agent.md as the base
2. For each `{{SECTION:name}}` token, reads `<harness>/<name>.md` and replaces the token
3. Prepends YAML frontmatter from `<harness>/frontmatter.json`
4. Outputs the composed agent file

### For Harnesses Without Sections

When a harness directory only has frontmatter.json:

```
agent.md + pi/frontmatter.json → composed agent
```

The composer:
1. Reads agent.md as the base
2. No section replacements needed
3. Prepends YAML frontmatter from `<harness>/frontmatter.json`
4. Outputs the composed agent file

### Agents with No Per-Harness Differences

Agents like `plan`, `ralph-plan`, and `strategy` that have identical behavior across harnesses still need per-harness directories for their frontmatter.json (since tool names differ between harnesses).

```
agents/plan/
├── agent.md              # Shared body (same for all harnesses)
├── pi/frontmatter.json   # PI tools
└── claude/frontmatter.json    # Claude tools
```

## Migration Path

1. Define the format (this document)
2. Migrate ralph agent first (proves the pattern) — DONE
3. Migrate plan, ralph-plan, strategy agents — DONE
4. Update the installer/composer to handle the new format
5. Remove old `*.agent.md` files — DONE (the composable directories are the only committed
   form; every harness composes or renders its own agent files at install time)

All four agents (`ralph`, `plan`, `ralph-plan`, `strategy`) use the composable layout, and no
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

Use the `validate-agent-dir` script to validate agent directories:

```bash
node --test test/validate-agent-dir.test.mjs
```

The validator checks:
- agent.md exists
- At least one harness subdirectory with valid frontmatter.json
- Frontmatter conforms to the schema (required fields, no unknown fields)

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
- Makes the agent's capabilities explicit per harness

### Why strict schema (no unknown fields)?

- Catches typos and configuration errors early
- Makes the format self-documenting
- Prevents accidental field additions that break tooling
