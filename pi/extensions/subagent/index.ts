/**
 * Subagent Tool — Run a task in an isolated PI subprocess.
 *
 * Two modes:
 *   agent mode  — { agent, task } — loads a user-facing .agent.md file
 *   stage mode  — { stage, task } — looks up stages.json + playbook files
 *
 * That's it. No parallel, no chain, no streaming callbacks, no TUI.
 * Orchestration belongs in the calling skill (e.g. skills/ralph).
 *
 * Based on PI's shipped subagent example at examples/extensions/subagent/.
 */

import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentScope, discoverAgents } from "./agents.ts";
import { getFinalOutput, getResultOutput } from "./runner.ts";
import { runSingleAgent, runStageSubagent } from "./runner.ts";

/** Directory where this extension file lives (used to resolve package root). */
const extensionDir = fileURLToPath(new URL(".", import.meta.url));

// ─── Parameter schema ─────────────────────────────────────────────────────────

const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({
			description:
				"Name of a user-facing agent (found via .agent.md files in PI agent directories or pi.agents in package.json)",
		}),
	),
	stage: Type.Optional(
		Type.String({
			description:
				"Name of a pipeline stage (looked up in stages.json, resolved via pi.stageConfig in package.json)",
		}),
	),
	task: Type.String({ description: "The task text for the subagent to execute" }),
	model: Type.Optional(Type.String({ description: "Optional model override (e.g. claude-sonnet-4-20250514)" })),
	tools: Type.Optional(
		Type.Array(Type.String(), {
			description: "Optional tool overrides (e.g. [\"read\",\"bash\",\"edit\",\"write\"])",
		}),
	),
	promptPaths: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Playbook prompt file paths to prepend into the subagent prompt (resolved relative to package root, stage mode only)",
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the subprocess" })),
	agentScope: Type.Optional(
		StringEnum(["user", "project", "both"] as const, {
			description: 'Which agent directories to search. Default: "user".',
			default: "user",
		}),
	),
});

// ─── Extension entry point ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Run a task in an isolated PI subprocess using a configured agent or pipeline stage.",
			"Agent mode (agent + task): loads the agent's .agent.md file for system prompt, model, and tools.",
			"Stage mode (stage + task): looks up stage config in stages.json, resolves playbook prompt files, and composes the full prompt.",
			"Returns the subagent's final output text.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal) {
			const hasAgent = Boolean(params.agent);
			const hasStage = Boolean(params.stage);

			if (!hasAgent && !hasStage) {
				return {
					content: [{ type: "text", text: "Provide either agent (for user-facing agents) or stage (for pipeline stages)." }],
					isError: true,
				};
			}

			if (hasAgent && hasStage) {
				return {
					content: [{ type: "text", text: "Provide either agent or stage, not both." }],
					isError: true,
				};
			}

			// ── Stage mode ──────────────────────────────────────────────────
			if (hasStage) {
				const result = await runStageSubagent(
					process.cwd(),
					extensionDir,
					params.stage!,
					params.promptPaths,
					params.task,
					params.cwd,
					signal,
				);

				const isError = result.exitCode !== 0;
				return {
					content: [{ type: "text", text: getResultOutput(result) }],
					isError,
				};
			}

			// ── Agent mode ──────────────────────────────────────────────────
			const scope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(process.cwd(), scope);
			if (discovery.agents.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No agents found in ${scope} scope. Available agents: none.`,
						},
					],
					isError: true,
				};
			}

			const result = await runSingleAgent(
				process.cwd(),
				discovery.agents,
				params.agent!,
				params.task,
				params.cwd,
				signal,
			);

			const isError = result.exitCode !== 0;
			return {
				content: [{ type: "text", text: getResultOutput(result) }],
				isError,
			};
		},

		renderCall(args, theme) {
			const label = args.agent
				? theme.fg("accent", args.agent)
				: theme.fg("accent", `stage:${args.stage}`);
			const preview =
				args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task;
			return `${theme.fg("toolTitle", theme.bold("subagent "))}${label}\n  ${theme.fg("dim", preview)}`;
		},

		renderResult(result, { expanded }, theme) {
			const text =
				result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
			if (expanded) return text;
			const firstLine = text.split("\n")[0];
			return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
		},
	});
}
