# Agent Directory Format

This document defines the canonical format for composable agent directories in agent-cortex.

## Motivation

The original format used a single `*.agent.md` file per agent, combining harness-agnostic logic with harness-specific configuration. This created duplication when the same agent needed to run on multiple harnesses (PI, Copilot, Claude) with different tool names and polling mechanisms.

The composable directory format separates concerns:

- **Shared body**: Harness-agnostic instructions (workflow, branching model, constraints)
- **Harness-specific frontmatter**: Tool names, model preferences, metadata per harness
- **Section files**: Harness-specific instructions (e.g., polling loops) included via tokens

## Directory Structure

```
agents/
├── <agent-name>/
│   ├── agent.md                    # Shared body (harness-agnostic)
│   ├── pi/
│   │   ├── frontmatter.json        # PI-specific metadata
│   │   └── <section>.md            # Optional: PI-specific sections
│   ├── copilot/
│   │   ├── frontmatter.json        # Copilot-specific metadata
│   │   └── <section>.md            # Optional: Copilot-specific sections
│   └── claude/
│       ├── frontmatter.json        # Claude-specific metadata
│       └── <section>.md            # Optional: Claude-specific sections
```

### Example: ralph agent

```
agents/ralph/
├── agent.md                        # Shared body (branching model, dispatch logic, constraints)
├── pi/
│   ├── frontmatter.json            # PI tools: ["bash", "task", "read_agent"]
│   └── polling.md                  # PI polling loop using read_agent
├── copilot/
│   ├── frontmatter.json            # Copilot tools (same as PI for now)
│   └── polling.md                  # Copilot polling (same as PI)
└── claude/
    ├── frontmatter.json            # Claude tools: ["bash", "task"]
    └── polling.md                  # Claude event-driven (no polling)
```

### Example: plan agent (no per-harness sections)

```
agents/plan/
├── agent.md                        # Shared body (planning workflow)
├── pi/
│   └── frontmatter.json            # PI tools
├── copilot/
│   └── frontmatter.json            # Copilot tools
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
- `polling.md` — Polling loop logic (differs between PI and Claude)
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

{{SECTION:polling}}
```

When composing the final agent file for a specific harness:

1. Start with agent.md content
2. Replace `{{SECTION:name}}` with content from `<harness>/<name>.md`
3. `{{TOOL:name}}` and `{{PATH:name}}` are resolved against `token-map.json` — the
   canonical tool/path/agent names per harness. `scripts/lib/compose-agent.mjs` (used by
   `build:copilot` / `build:claude` and by `bin/installers/pi.mjs`) resolves them when
   generating the flat files / installing for pi; pi's `agent-modes` extension does the
   same at runtime. See the `contract` section of `token-map.json` and
   `token-map.README.md` for the rules.

The pi harness's `agent-modes` extension is a runtime consumer of this format: it
composes agent prompts on the fly from `agent.md` + `pi/frontmatter.json`, substituting
tokens against `token-map.json`'s pi column with no install step. See
`extensions/agent-modes/README.md`.

## Composition Rules

### For Harnesses with Sections

When a harness directory contains section files:

```
agent.md + pi/frontmatter.json + pi/polling.md → composed agent
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
├── copilot/frontmatter.json  # Copilot tools
└── claude/frontmatter.json    # Claude tools
```

## Migration Path

1. Define the format (this document)
2. Migrate ralph agent first (proves the pattern) — DONE
3. Migrate plan, ralph-plan, strategy agents — DONE
4. Update the installer/composer to handle the new format
5. Remove old `*.agent.md` files — DONE (the flat files are now **generated output**, see below)

All four agents (`ralph`, `plan`, `ralph-plan`, `strategy`) use the composable layout and the
flat `agents/*.agent.md` files are built from them:

- `scripts/build-copilot-agents.mjs` (`pnpm build:copilot`) composes `agents/*.agent.md` from
  each agent's `copilot/` harness dir — committed for Copilot CLI, which loads `*.agent.md`
  from `plugin.json`'s `agents: "agents/"` path.
- `bin/installers/claude.mjs` (`agent-cortex install claude`; `pnpm build:claude` is a pure
  alias) composes `claude/agents/*.md` from each agent's `claude/` harness dir (except
  `ralph`, which ships natively from `agents-native/ralph.md`, copied verbatim).
- The pi harness delivers two ways: the `agent-modes` extension composes `agent.md` +
  `pi/frontmatter.json` at runtime against `token-map.json`, and `agent-cortex install pi`
  materialises composed agents + token-substituted skills into `~/.pi/agent` at install
  time (see README "Pi harness agents & skills").

Never edit the generated flat/claude files by hand — edit the composable directory. CI
regenerates both outputs and fails on drift. Generation is install-time: `claude` ships
via `bin/installers/claude.mjs`, the single generator behind both `agent-cortex install
claude` and the `pnpm build:claude` alias (the committed `claude/` subtree is regenerated
by it and drift-checked, so it can never be stale); `pi` ships via
`bin/installers/pi.mjs`, which materialises composed agents + token-substituted skills
into `~/.pi/agent`; `copilot` remains a separate workstream (`scripts/build-copilot-agents.mjs`).

## Validation

Use the `validate-agent-dir` script to validate agent directories:

```bash
node --test --import tsx/esm skills/productivity/validate-agent-dir/scripts/validate-agent-dir.test.ts
```

The validator checks:
- agent.md exists
- At least one harness subdirectory with valid frontmatter.json
- Frontmatter conforms to the schema (required fields, no unknown fields)

## Design Decisions

### Why JSON for frontmatter instead of YAML?

- JSON has strict syntax (no comments, no ambiguity)
- Easier to validate with JSON Schema
- Consistent with existing tooling (package.json, plugin.json)
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
