#!/usr/bin/env bash
# Installs ~/.copilot/copilot-instructions.md with proactive skill directives.
# Run after cloning this plugin: pnpm install (or bash scripts/install-instructions.sh)
# Safe to re-run — replaces the agent-cortex section only.

set -euo pipefail

INSTRUCTIONS_FILE="$HOME/.copilot/copilot-instructions.md"
MARKER_START="<!-- agent-cortex:start -->"
MARKER_END="<!-- agent-cortex:end -->"

BLOCK="$MARKER_START
<!-- This block is managed by agent-cortex. Manual edits inside will be overwritten. -->

## Proactive skill use (agent-cortex plugin)

You have a set of custom skills available. Apply them automatically whenever they are relevant — the user should not have to invoke them by name.

### Code & tests

- Apply **style-code** whenever writing, editing, or reviewing code. It defines naming, module boundaries, and architectural conventions.
- Apply **style-tests** whenever writing, editing, or reviewing tests. It defines assertion strategy, mock discipline, and what to test.
- Apply **style-comms** whenever writing external-facing communication: tickets, RFCs, PRDs, proposals, or reports.
- Apply **style-documentation** whenever deciding what to document or reviewing existing docs.
- Use **tdd** (red-green-refactor loop) whenever building a new feature or fixing a bug where correctness matters.
- Run **review-security** before committing any changes that touch secrets, auth, or credentials.

### Planning & design

- Use **write-a-prd** when the user wants to plan a new feature or product requirement.
- Use **prd-to-tasks** after a PRD is approved to break it into phased epics and task beads.
- Use **create-task** when creating a new trackable task bead.
- Use **record-idea** when the user shares an early-stage idea that is not yet ready to implement.
- Use **request-refactor-plan** when the user wants to plan a refactor with safe incremental commits.
- Use **write-a-ticket** when writing a ticket for an external issue tracker (e.g. Jira).
- Use **design-an-interface** when the user wants to explore multiple API or module designs.
- Use **technical-direction** when evaluating architecture or technology choices with tradeoff analysis.
- Use **grill-me** or **grill-with-docs** when the user wants to stress-test a plan or design.
- Use **improve-codebase-architecture** when the user wants to find architectural improvement opportunities.

### Task execution

- Use **bd-tool** whenever the user mentions beads, bd, tasks, or asks what work is available.
- Use **ralph** to run all pending beads end-to-end with review gates.
- Use **run-pipeline-stage** to work through individual pipeline stages inline.
- Use **hitl-collab** when a task requires human review, manual steps, or a PR handoff.
- Use **classify-bead** when a bead is missing its implementation-type label.

### Repo & plugin maintenance

- Use **maintain-agent-docs** when reviewing or updating AGENTS.md or agent-consumed docs.
- Use **refactor-skill** when restructuring or reviewing an existing skill.
- Use **write-a-skill** when creating a new skill.
- Use **init-beads** when setting up the bd task-tracker in a new project.

$MARKER_END"

mkdir -p "$(dirname "$INSTRUCTIONS_FILE")"

if [ ! -f "$INSTRUCTIONS_FILE" ]; then
  printf '%s\n' "$BLOCK" > "$INSTRUCTIONS_FILE"
  echo "✓ Created $INSTRUCTIONS_FILE"
elif grep -qF "$MARKER_START" "$INSTRUCTIONS_FILE"; then
  # Write replacement block to a temp file so awk can read it with getline
  BLOCK_FILE=$(mktemp)
  printf '%s\n' "$BLOCK" > "$BLOCK_FILE"
  awk -v start="$MARKER_START" -v end="$MARKER_END" -v blockfile="$BLOCK_FILE" '
    $0 == start {
      while ((getline line < blockfile) > 0) print line
      close(blockfile)
      skip=1; next
    }
    $0 == end { skip=0; next }
    !skip     { print }
  ' "$INSTRUCTIONS_FILE" > "${INSTRUCTIONS_FILE}.tmp"
  mv "${INSTRUCTIONS_FILE}.tmp" "$INSTRUCTIONS_FILE"
  rm -f "$BLOCK_FILE"
  echo "✓ Updated agent-cortex section in $INSTRUCTIONS_FILE"
else
  printf '\n%s\n' "$BLOCK" >> "$INSTRUCTIONS_FILE"
  echo "✓ Appended agent-cortex section to $INSTRUCTIONS_FILE"
fi
