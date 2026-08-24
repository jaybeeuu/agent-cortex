// Regenerates the committed Copilot CLI flat agent files (agents/*.agent.md)
// from the canonical composable agent sources (agents/<name>/).
//
// This script is a thin wrapper over the shared install-time generator
// (bin/installers/copilot.mjs) — `agent-cortex install copilot` runs exactly the
// same code path, so install-time and build-time output can never diverge. CI
// runs this and checks `git diff --exit-code -- 'agents/*.agent.md'` to
// guarantee the committed flat files are never stale: a fresh clone (or a
// direct path plugin install) ships the Copilot plugin read-ready.
//
//   agents/<name>.agent.md    composed from agents/<name>/agent.md +
//                             agents/<name>/copilot/frontmatter.json +
//                             agents/<name>/copilot/<section>.md ({{SECTION:...}}),
//                             with {{TOOL:...}}/{{PATH:...}} substituted against
//                             the copilot column of token-map.json.
//
// The flat files live in the same agents/ directory the Copilot plugin scans
// (plugin.json "agents": "agents/"), next to the composable dirs they come
// from — the generator only writes *.agent.md files and never deletes.
//
// Run: pnpm build:copilot   (node scripts/build-copilot-agents.mjs)
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installCopilot } from "../bin/installers/copilot.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

installCopilot({ root: ROOT, output: join(ROOT, "agents") });