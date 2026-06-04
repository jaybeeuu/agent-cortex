/**
 * Agent discovery and stage config loading for the subagent extension.
 *
 * Discovery sources:
 *   - User agents: ~/.pi/agent/agents/ (standard PI directory)
 *   - Project agents: .pi/agents/ (walked up from cwd)
 *   - Package agents: resolved from pi.agents in package.json (bundled agents)
 *
 * Stage config path is resolved from pi.stageConfig in package.json.
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

export interface WorkflowStageConfig {
	description: string;
	"model-pi"?: string;
	model?: string;
	tools?: string[];
}

export interface WorkflowStagesConfig {
	[key: string]: WorkflowStageConfig;
}

interface PiManifest {
	extensions?: string[];
	skills?: string[];
	stageConfig?: string;
	agents?: string[];
}

// ─── Package manifest helpers ──────────────────────────────────────────────────

/**
 * Find the package root directory by walking up from `startDir` until
 * a directory containing a package.json with a "pi" manifest key is found.
 *
 * This skips intermediate package.json files (e.g. the extension's own
 * package.json inside node_modules or nested packages) to find the outer
 * PI package root that has the pi.stageConfig and pi.agents entries.
 *
 * If no package.json with a "pi" key is found, returns the first package.json
 * encountered (fallback). Returns null if no package.json at all.
 */
export function findPackageRoot(startDir: string): string | null {
	let current = startDir;
	let firstPkgDir: string | null = null;

	while (true) {
		const pkgPath = path.join(current, "package.json");
		if (fs.existsSync(pkgPath)) {
			if (firstPkgDir === null) firstPkgDir = current;

			// Check if this package.json has a "pi" key (the outer PI package manifest)
			try {
				const content = fs.readFileSync(pkgPath, "utf-8");
				const pkg = JSON.parse(content);
				if (pkg.pi) return current;
			} catch {
				// Invalid JSON or read error — continue walking up
			}
		}

		const parent = path.dirname(current);
		if (parent === current) return firstPkgDir;
		current = parent;
	}
}

/**
 * Read the pi manifest from a package.json at the given package root.
 * Returns null if the file doesn't exist or has no valid pi key.
 */
function readPiManifest(pkgRoot: string): PiManifest | null {
	const pkgPath = path.join(pkgRoot, "package.json");
	if (!fs.existsSync(pkgPath)) return null;
	try {
		const content = fs.readFileSync(pkgPath, "utf-8");
		const pkg = JSON.parse(content);
		return pkg.pi || null;
	} catch {
		return null;
	}
}

/**
 * Resolve a path from a pi manifest entry relative to the package root.
 * The manifest entry can be a string or an array of strings.
 */
function resolveManifestPaths(pkgRoot: string, entry: string | string[] | undefined): string[] {
	if (!entry) return [];
	const items = Array.isArray(entry) ? entry : [entry];
	return items
		.map((p) => path.resolve(pkgRoot, p))
		.filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
}

// ─── Agent loading ─────────────────────────────────────────────────────────────

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

// ─── Directory helpers ─────────────────────────────────────────────────────────

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

// ─── Discovery entry points ────────────────────────────────────────────────────

/**
 * Discover user-facing agents from standard PI directories and package agents.
 */
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

export function formatAgentList(
	agents: AgentConfig[],
	maxItems: number,
): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}

/**
 * Load workflow stage configuration from the path specified in the package manifest
 * (pi.stageConfig). Returns null if the manifest or config file doesn't exist.
 */
export function loadWorkflowStagesConfig(extensionDir: string): WorkflowStagesConfig | null {
	const pkgRoot = findPackageRoot(extensionDir);
	if (!pkgRoot) return null;

	const manifest = readPiManifest(pkgRoot);
	if (!manifest?.stageConfig) return null;

	const stagesPath = path.resolve(pkgRoot, manifest.stageConfig);
	if (!fs.existsSync(stagesPath)) return null;

	try {
		const content = fs.readFileSync(stagesPath, "utf-8");
		return JSON.parse(content) as WorkflowStagesConfig;
	} catch {
		return null;
	}
}
