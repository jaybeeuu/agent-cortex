/**
 * Pure utility functions for the subagent extension.
 *
 * This module has minimal PI-adjacent imports (type-only) making it testable
 * without a PI runtime. Only utilities actually used by the extension live here.
 */

import type { Message } from "@earendil-works/pi-ai";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

// ─── Output parsing ────────────────────────────────────────────────────────────

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

export function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

export function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

// ─── Frontmatter ───────────────────────────────────────────────────────────────

/**
 * Strip YAML frontmatter (--- ... ---) from the beginning of a string.
 * Returns content after frontmatter, or the original string if no frontmatter.
 */
export function stripFrontmatter(content: string): string {
	const match = content.match(/^---\n(?:[\s\S]*?\n)?---\n/);
	if (match) {
		return content.slice(match[0].length);
	}
	return content;
}
