// Composes the Copilot/pi agent files (agents/*.agent.md) from the canonical
// composable agent directories (agents/<name>/). The composable dirs are the
// single source of truth — see agents/README.md; the flat *.agent.md files are
// generated, committed output that Copilot CLI loads via plugin.json
// ("agents": "agents/", which scans for *.agent.md files).
// CI regenerates this and checks `git diff --exit-code -- 'agents/*.agent.md'`
// to guarantee it is never stale.
//
//   agents/<name>.agent.md   composed from agents/<name>/agent.md +
//                            agents/<name>/copilot/frontmatter.json +
//                            agents/<name>/copilot/<section>.md ({{SECTION:...}}),
//                            with {{TOOL:...}}/{{PATH:...}} substituted against
//                            the copilot column of token-map.json.
//
// Run: pnpm build:copilot   (node scripts/build-copilot-agents.mjs)
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

import { writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composeAgent } from "./lib/compose-agent.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_SRC = join(ROOT, "agents");

function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Serialise the flat-file YAML frontmatter. Field order and names mirror the
 * pre-migration flat sources (description, name, tools, argument-hint) so
 * Copilot CLI sees the same agent metadata.
 */
function frontmatterYaml(name, fm) {
  const lines = [
    "---",
    `# GENERATED from agents/${name}/ by scripts/build-copilot-agents.mjs — DO NOT EDIT.`,
    `description: ${JSON.stringify(fm.description)}`,
    `name: ${JSON.stringify(fm.name)}`,
    `tools: [${fm.tools.map((t) => JSON.stringify(t)).join(", ")}]`,
  ];
  if (fm.argumentHint) lines.push(`argument-hint: ${JSON.stringify(fm.argumentHint)}`);
  lines.push("---");
  return lines.join("\n");
}

export function buildCopilotAgents() {
  const written = [];
  const entries = readdirSync(AGENT_SRC, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(AGENT_SRC, entry.name);
    if (!existsSync(join(dir, "agent.md"))) continue;
    if (!isDirectory(join(dir, "copilot")) || !existsSync(join(dir, "copilot", "frontmatter.json"))) {
      throw new Error(`agent "${entry.name}": composable directory without copilot/frontmatter.json — define the copilot harness or exclude the agent`);
    }

    const fm = composeAgent(ROOT, entry.name, "copilot");
    const out = `${frontmatterYaml(entry.name, fm)}\n\n${fm.body}\n`;
    writeFileSync(join(AGENT_SRC, `${entry.name}.agent.md`), out);
    written.push(entry.name);
  }

  console.log(`Generated ${written.length} Copilot agent file(s): ${written.join(", ")}`);
}

buildCopilotAgents();