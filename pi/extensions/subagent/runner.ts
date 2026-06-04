/**
 * Runner — subprocess spawning and output parsing.
 *
 * This is the execution core: spawn a PI subprocess in JSON mode,
 * collect messages, aggregate usage, clean up temp files.
 * No orchestration, no rendering, no streaming callbacks.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents.ts";
import { findPackageRoot } from "./agents.ts";
import type { SingleResult as SingleResultType } from "./utils.ts";
import { getFinalOutput, isFailedResult, stripFrontmatter } from "./utils.ts";

export { getFinalOutput, isFailedResult } from "./utils.ts";

// ─── Temp file helpers ─────────────────────────────────────────────────────────

export async function writePromptToTempFile(
	name: string,
	prompt: string,
): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = name.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

// ─── PI subprocess invocation ──────────────────────────────────────────────────

export function getPiInvocation(
	args: string[],
): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

// ─── Subprocess output parsing ─────────────────────────────────────────────────

function processJsonLine(line: string, result: SingleResultType): void {
	if (!line.trim()) return;
	let event: any;
	try {
		event = JSON.parse(line);
	} catch {
		return;
	}

	if (event.type === "message_end" && event.message) {
		const msg = event.message as Message;
		result.messages.push(msg);

		if (msg.role === "assistant") {
			result.usage.turns++;
			const usage = msg.usage;
			if (usage) {
				result.usage.input += usage.input || 0;
				result.usage.output += usage.output || 0;
				result.usage.cacheRead += usage.cacheRead || 0;
				result.usage.cacheWrite += usage.cacheWrite || 0;
				result.usage.cost += usage.cost?.total || 0;
				result.usage.contextTokens = usage.totalTokens || 0;
			}
			if (!result.model && msg.model) result.model = msg.model;
			if (msg.stopReason) result.stopReason = msg.stopReason;
			if (msg.errorMessage) result.errorMessage = msg.errorMessage;
		}
	}

	if (event.type === "tool_result_end" && event.message) {
		result.messages.push(event.message as Message);
	}
}

function spawnPiProcess(
	args: string[],
	result: SingleResultType,
	cwd: string,
	signal?: AbortSignal,
): Promise<number> {
	return new Promise<number>((resolve) => {
		const invocation = getPiInvocation(args);
		const proc = spawn(invocation.command, invocation.args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let buffer = "";

		proc.stdout.on("data", (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processJsonLine(line, result);
		});

		proc.stderr.on("data", (data: Buffer) => {
			result.stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (buffer.trim()) processJsonLine(buffer, result);
			resolve(code ?? 0);
		});

		proc.on("error", () => resolve(1));

		if (signal) {
			const killProc = () => {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			};
			if (signal.aborted) killProc();
			else signal.addEventListener("abort", killProc, { once: true });
		}
	});
}

// ─── Build pi args from config ─────────────────────────────────────────────────

function buildPiArgs(config: {
	model?: string;
	tools?: string[];
	task: string;
	systemPrompt?: string;
}): string[] {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (config.model) args.push("--model", config.model);
	if (config.tools && config.tools.length > 0) args.push("--tools", config.tools.join(","));
	args.push(`Task: ${config.task}`);
	return args;
}

// ─── Agent mode runner ─────────────────────────────────────────────────────────

export async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	signal: AbortSignal | undefined,
): Promise<SingleResultType> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		};
	}

	const result: SingleResultType = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: agent.model,
	};

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	try {
		const args = buildPiArgs({ model: agent.model, tools: agent.tools, task });

		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.splice(args.indexOf("-p") + 1, 0, "--append-system-prompt", tmpPromptPath);
		}

		result.exitCode = await spawnPiProcess(args, result, cwd ?? defaultCwd, signal);
		return result;
	} finally {
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

// ─── Stage mode runner ─────────────────────────────────────────────────────────

export async function runStageSubagent(
	defaultCwd: string,
	extensionDir: string,
	stage: string,
	promptPaths: string[] | undefined,
	task: string,
	cwd: string | undefined,
	signal: AbortSignal | undefined,
): Promise<SingleResultType> {
	const { loadWorkflowStagesConfig } = await import("./agents.ts");
	const workflowStagesConfig = loadWorkflowStagesConfig(extensionDir);

	if (!workflowStagesConfig) {
		return {
			agent: stage,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Stage "${stage}" could not be dispatched: stages.json not found. Create skills/run-beads/stages.json to configure pipeline stages.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		};
	}

	const stageConfig = workflowStagesConfig[stage];
	if (!stageConfig) {
		const available = Object.keys(workflowStagesConfig).join(", ") || "none";
		return {
			agent: stage,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown stage: "${stage}". Available stages: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		};
	}

	const model = stageConfig["model-pi"] || stageConfig.model;
	const tools = stageConfig.tools;

	let tmpDir: string | null = null;
	let tmpFilePath: string | null = null;

	const result: SingleResultType = {
		agent: stage,
		agentSource: "unknown",
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model,
	};

	try {
		const parts: string[] = [];

		if (promptPaths && promptPaths.length > 0) {
			const pkgRoot = findPackageRoot(extensionDir);
			if (pkgRoot) {
				for (const p of promptPaths) {
					const resolved = path.resolve(pkgRoot, p);
					try {
						const content = await fs.promises.readFile(resolved, "utf-8");
						parts.push(stripFrontmatter(content));
					} catch {
						parts.push(`[Could not read prompt file: ${p}]`);
					}
				}
			}
		}

		parts.push(`Task: ${task}`);
		const fullPrompt = parts.join("\n\n");

		const tmp = await writePromptToTempFile(stage, fullPrompt);
		tmpDir = tmp.dir;
		tmpFilePath = tmp.filePath;

		const args: string[] = ["--mode", "json", "-p", "--no-session"];
		if (model) args.push("--model", model);
		if (tools && tools.length > 0) args.push("--tools", tools.join(","));
		args.push("--append-system-prompt", tmpFilePath);

		result.exitCode = await spawnPiProcess(args, result, cwd ?? defaultCwd, signal);
		return result;
	} finally {
		if (tmpFilePath)
			try {
				fs.unlinkSync(tmpFilePath);
			} catch {
				/* ignore */
			}
		if (tmpDir)
			try {
				fs.rmdirSync(tmpDir);
			} catch {
				/* ignore */
			}
	}
}
