/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * Parse a frontmatter `tools` value into PI tool names.
 *
 * `parseFrontmatter` returns the scalar as a single string, and agent files are
 * written with either a comma-separated list (`tools: read, grep`) or a
 * whitespace-separated one. Splitting on commas alone collapses the whitespace
 * form into one bogus name, which becomes a `--tools` allowlist matching no
 * tool — the subagent then runs with an empty tool block. Accept both
 * separators so neither form can zero out the tool list.
 *
 * @param {string | undefined} tools  Raw frontmatter `tools` scalar
 * @returns {string[] | undefined} Tool names, or undefined when there are none
 */
export function parseToolList(tools: string | undefined): string[] | undefined {
	const parsed = tools?.split(/[,\s]+/).filter(Boolean);

	return parsed && parsed.length > 0 ? parsed : undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

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

		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);

		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
			continue;
		}

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: readTools(frontmatter.tools),
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

/**
 * The tools of a frontmatter `tools` value, which is written either as a YAML
 * scalar (one string) or as a YAML sequence (an array).
 */
function readTools(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const tools = value
			.filter((tool): tool is string => typeof tool === "string")
			.map((tool) => tool.trim())
			.filter(Boolean);
		return tools.length > 0 ? tools : undefined;
	}
	return parseToolList(typeof value === "string" ? value : undefined);
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

/**
 * The package this extension ships inside: `<extension>/../..`, i.e. the repo
 * checkout or the staged pi package.
 */
const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * True when `agentsDir` is a rendered tree — flat `*.agent.md` files and no
 * composable `<name>/agent.md` source directories.
 */
function isRenderedAgentsTree(agentsDir: string): boolean {
	if (!isDirectory(agentsDir)) return false;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(agentsDir, { withFileTypes: true });
	} catch {
		return false;
	}
	return !entries.some((entry) => entry.isDirectory() && fs.existsSync(path.join(agentsDir, entry.name, "agent.md")));
}

/**
 * Directories the "user" scope discovers agents from, in precedence order.
 *
 * pi's own user agent dir comes first: it holds hand-written personal agents
 * and the copies older installers made, so existing setups keep resolving what
 * they did before. Second is the package this extension ships inside, which is
 * what makes a staged pi package self-contained — `agent-cortex install pi`
 * renders the flat pi agents into `<package>/agents`.
 *
 * A source checkout contributes nothing: its `agents/` tree is the composable
 * source (composed at runtime by the agent-modes extension) alongside flat
 * renders for other harnesses — Copilot's, whose tool names pi does not have.
 */
export function resolveUserAgentDirs(packageRoot: string = PACKAGE_ROOT): string[] {
	const dirs: string[] = [];
	const add = (dir: string) => {
		const resolved = path.resolve(dir);
		if (!dirs.includes(resolved) && isDirectory(resolved)) dirs.push(resolved);
	};

	add(path.join(getAgentDir(), "agents"));
	const packageAgentsDir = path.join(packageRoot, "agents");
	if (isRenderedAgentsTree(packageAgentsDir)) add(packageAgentsDir);

	return dirs;
}

/**
 * Load the user-scope agents from `dirs`, first directory wins on a name
 * collision. Missing directories contribute nothing.
 */
export function loadUserAgents(dirs: string[]): AgentConfig[] {
	const byName = new Map<string, AgentConfig>();
	for (const dir of dirs) {
		for (const agent of loadAgentsFromDir(dir, "user")) {
			if (!byName.has(agent.name)) byName.set(agent.name, agent);
		}
	}
	return Array.from(byName.values());
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadUserAgents(resolveUserAgentDirs());
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
