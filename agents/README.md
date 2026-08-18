# Agent Directory Format

This document defines the canonical format for composable agent directories in agent-cortex.

## Motivation

The current format uses a single `*.agent.md` file per agent, combining harness-agnostic logic with harness-specific configuration. This creates duplication when the same agent needs to run on multiple harnesses (PI, Copilot, Claude) with different tool names and polling mechanisms.

The new format separates concerns:

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
| Tool reference | `{{TOOL:name}}` | Canonical tool name; substituted per harness at install time from `token-map.json` |
| Path reference | `{{PATH:path}}` | Canonical path name; resolved per harness at install time from `token-map.json` |
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
3. `{{TOOL:name}}` and `{{PATH:name}}` are substituted by the installer against
   `token-map.json` — the canonical tool/path/agent names per harness. See the
   `contract` section of `token-map.json` and `token-map.README.md` for the rules.

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
2. Migrate ralph agent first (proves the pattern)
3. Migrate plan, ralph-plan, strategy agents
4. Update the installer/composer to handle the new format
5. Remove old `*.agent.md` files

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
