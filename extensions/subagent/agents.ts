/**
 * Agent discovery for the subagent extension.
 *
 * Discovers user-facing agent .md files from standard PI agent directories:
 *   - ~/.pi/agent/agents/  (user level)
 *   - .pi/agents/           (project level, walked up from cwd)
 *
 * This does NOT include pipeline stage agents — those are configured via
 * skills/run-beads/stages.json and loaded by the stage mode of the subagent tool.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) return agents;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);

		if (!frontmatter.name || !frontmatter.description) continue;

		const tools = Array.isArray(frontmatter.tools)
			? frontmatter.tools.map((t: string) => t.trim()).filter(Boolean)
			: typeof frontmatter.tools === "string"
				? frontmatter.tools
					.split(",")
					.map((t: string) => t.trim())
					.filter(Boolean)
				: undefined;

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}

export interface StageConfig {
	description: string;
	"model-pi"?: string;
	model?: string;
	tools?: string[];
}

export interface StagesConfig {
	[key: string]: StageConfig;
}

/**
 * Load stage configuration from skills/run-beads/stages.json.
 * Returns null if the file doesn't exist (stage mode not yet configured).
 */
export function loadStagesConfig(extensionDir: string): StagesConfig | null {
	// Walk up from extension dir to find the package root (where package.json lives)
	let current = extensionDir;
	while (true) {
		if (fs.existsSync(path.join(current, "package.json"))) break;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}

	const stagesPath = path.join(current, "skills", "run-beads", "stages.json");
	if (!fs.existsSync(stagesPath)) return null;

	try {
		const content = fs.readFileSync(stagesPath, "utf-8");
		return JSON.parse(content) as StagesConfig;
	} catch {
		return null;
	}
}
