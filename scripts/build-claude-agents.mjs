// Regenerates the committed Claude Code plugin subtree (claude/) from the
// canonical composable agent sources (agents/<name>/), agents-native/, the
// grouped skills/ tree, hooks/claude/, and package.json.
//
// This script is a thin wrapper over the shared install-time generator
// (bin/installers/claude.mjs) — `agent-cortex install claude` runs exactly the
// same code path, so install-time and build-time output can never diverge. CI
// runs this and checks `git diff --exit-code claude/...` to guarantee the
// committed subtree is never stale: a fresh clone installs as-is.
//
//   claude/agents/<slug>.md          composed from agents/<name>/agent.md +
//                                    agents/<name>/claude/frontmatter.json +
//                                    agents/<name>/claude/<section>.md ({{SECTION:...}}),
//                                    with {{TOOL:...}}/{{PATH:...}} substituted against
//                                    the claude column of token-map.json. Agents in the
//                                    DEFER set ship instead from agents-native/<name>.md.
//   claude/skills/<name>             symlinks to the grouped skills/<group>/<name> dirs (single source)
//   claude/.claude-plugin/plugin.json  manifest; version tracks package.json
//   claude/hooks.json                copied from hooks/claude/hooks.json
//
// Claude only loads agents from the default ./agents/ dir of the plugin root (custom
// `agents` manifest paths are ignored), so the plugin root is claude/ — isolating it
// from the Copilot .agent.md files, which would otherwise load as broken agents.
//
// Run: pnpm build:claude   (node scripts/build-claude-agents.mjs)
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installClaude } from "../bin/installers/claude.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

installClaude({ root: ROOT, output: join(ROOT, "claude") });