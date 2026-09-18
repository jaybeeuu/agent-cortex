// Regenerates the committed, self-contained Copilot plugin subtree (copilot/)
// from the canonical sources (agents/<name>/, skills/**, plugin.json, hooks.json).
//
// This script is a thin wrapper over the shared install-time generator
// (bin/installers/copilot.mjs) — `agent-cortex install copilot` runs exactly the
// same code path, so install-time and build-time output can never diverge. CI
// runs this and checks `git diff --exit-code -- copilot/` to guarantee the
// committed subtree is never stale: a fresh clone ships the Copilot plugin
// read-ready.
//
//   copilot/plugin.json            root plugin.json shape, agents/skills pointed
//                                  at ./agents and ./skills, version tracking
//                                  package.json
//   copilot/agents/<name>.agent.md composed from agents/<name>/agent.md +
//                                  agents/<name>/copilot/frontmatter.json +
//                                  agents/<name>/copilot/<section>.md
//                                  ({{SECTION:...}}), with {{TOOL:...}}/
//                                  {{PATH:...}} substituted against the copilot
//                                  column of token-map.json
//   copilot/skills/<group>/<name>/ token-substituted skill tree (groups preserved)
//   copilot/hooks.json             copied from the root hooks.json
//
// The subtree is generated output — never edit it by hand.
//
// Run: pnpm build:copilot   (node scripts/build-copilot-agents.mjs)
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installCopilot } from "../bin/installers/copilot.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

await installCopilot({ root: ROOT });
