/**
 * Tests for the subagent extension.
 *
 * Covers pure utility functions (utils.ts), config loading (agents.ts),
 * process invocation helper (runner.ts), and agent file frontmatter parsing.
 *
 * Run: node --test --import tsx/esm test.ts
 */

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import { fileURLToPath } from "node:url";
import {
	stripFrontmatter,
	isFailedResult,
	getFinalOutput,
	getResultOutput,
} from "./utils.ts";
import type { SingleResult } from "./utils.ts";
import { getPiInvocation } from "./runner.ts";
import { loadWorkflowStagesConfig, findPackageRoot, discoverAgents } from "./agents.ts";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─── stripFrontmatter ──────────────────────────────────────────────────────────

describe("stripFrontmatter", () => {
	it("removes YAML frontmatter", () => {
		const input = "---\nname: test\n---\nBody text";
		assert.equal(stripFrontmatter(input), "Body text");
	});

	it("returns original content if no frontmatter", () => {
		const input = "Just body text";
		assert.equal(stripFrontmatter(input), input);
	});

	it("handles empty frontmatter", () => {
		const input = "---\n---\nBody text";
		assert.equal(stripFrontmatter(input), "Body text");
	});

	it("handles multiline body after frontmatter", () => {
		const input = "---\nname: test\n---\nLine 1\nLine 2\nLine 3";
		assert.equal(stripFrontmatter(input), "Line 1\nLine 2\nLine 3");
	});
});

// ─── isFailedResult ────────────────────────────────────────────────────────────

describe("isFailedResult", () => {
	const makeResult = (overrides: Partial<SingleResult>): SingleResult => ({
		agent: "test",
		agentSource: "unknown",
		task: "test",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		...overrides,
	});

	it("returns false for successful result", () => {
		assert.equal(isFailedResult(makeResult({ exitCode: 0 })), false);
	});

	it("returns true when exitCode is non-zero", () => {
		assert.equal(isFailedResult(makeResult({ exitCode: 1 })), true);
	});

	it("returns true when stopReason is error", () => {
		assert.equal(isFailedResult(makeResult({ stopReason: "error" })), true);
	});

	it("returns true when stopReason is aborted", () => {
		assert.equal(isFailedResult(makeResult({ stopReason: "aborted" })), true);
	});

	it("returns false when stopReason is end", () => {
		assert.equal(isFailedResult(makeResult({ stopReason: "end" })), false);
	});
});

// ─── getFinalOutput ────────────────────────────────────────────────────────────

describe("getFinalOutput", () => {
	it("returns last assistant text", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "First output" } as any] },
			{ role: "assistant", content: [{ type: "text", text: "Final output" } as any] },
		];
		assert.equal(getFinalOutput(messages as any), "Final output");
	});

	it("returns empty string when no assistant messages", () => {
		const messages = [{ role: "user", content: [{ type: "text", text: "Hello" } as any] }];
		assert.equal(getFinalOutput(messages as any), "");
	});

	it("returns text from multi-part assistant message", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "toolCall", name: "read", arguments: { path: "x" } },
					{ type: "text", text: "Here is the result" },
				] as any,
			},
		];
		assert.equal(getFinalOutput(messages as any), "Here is the result");
	});
});

// ─── getResultOutput ───────────────────────────────────────────────────────────

describe("getResultOutput", () => {
	const makeResult = (overrides: Partial<SingleResult>): SingleResult => ({
		agent: "test",
		agentSource: "unknown",
		task: "test",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		...overrides,
	});

	it("returns final output for successful result", () => {
		const result = makeResult({
			exitCode: 0,
			messages: [
				{ role: "assistant", content: [{ type: "text", text: "Done!" }] } as any,
			],
		});
		assert.equal(getResultOutput(result), "Done!");
	});

	it("returns errorMessage for failed result", () => {
		const result = makeResult({
			exitCode: 1,
			errorMessage: "Something broke",
		});
		assert.equal(getResultOutput(result), "Something broke");
	});

	it("falls back to stderr for failed result without errorMessage", () => {
		const result = makeResult({
			exitCode: 1,
			stderr: "stderr output",
		});
		assert.equal(getResultOutput(result), "stderr output");
	});

	it('returns "(no output)" as last resort', () => {
		const result = makeResult({ exitCode: 1 });
		assert.equal(getResultOutput(result), "(no output)");
	});
});

// ─── Prompt composition (file reading + frontmatter stripping) ───────────────

describe("prompt composition", () => {
	it("reads, strips frontmatter from, and concatenates multiple prompt files", async () => {
		const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "subagent-test-"));
		try {
			// Create two playbook-like files with frontmatter
			const playbook1 = path.join(tmpDir, "playbook1.md");
			fs.writeFileSync(
				playbook1,
				"---\nname: stage-one\n---\nPlaybook 1 content",
			);
			const playbook2 = path.join(tmpDir, "playbook2.md");
			fs.writeFileSync(
				playbook2,
				"---\nname: stage-two\ntools: [read, bash]\n---\nPlaybook 2 content",
			);

			// Simulate what runStageSubagent does internally
			const parts: string[] = [];
			for (const p of [playbook1, playbook2]) {
				const content = fs.readFileSync(p, "utf-8");
				parts.push(stripFrontmatter(content));
			}
			parts.push("Task: do the thing");

			const fullPrompt = parts.join("\n\n");
			assert.ok(fullPrompt.includes("Playbook 1 content"));
			assert.ok(fullPrompt.includes("Playbook 2 content"));
			assert.ok(fullPrompt.includes("Task: do the thing"));
			assert.ok(!fullPrompt.includes("---\nname:")); // frontmatter stripped
			assert.ok(!fullPrompt.includes("tools: [read, bash]")); // YAML not in output
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("handles empty promptPaths gracefully", async () => {
		const parts: string[] = [];
		parts.push("Task: just this");
		const fullPrompt = parts.join("\n\n");
		assert.equal(fullPrompt, "Task: just this");
	});

	it("skips missing prompt files with a placeholder message", async () => {
		const parts: string[] = [];
		const missingPath = "/nonexistent/playbook.md";
		try {
			const content = fs.readFileSync(missingPath, "utf-8");
			parts.push(stripFrontmatter(content));
		} catch {
			parts.push(`[Could not read prompt file: ${missingPath}]`);
		}
		parts.push("Task: proceed");

		const fullPrompt = parts.join("\n\n");
		assert.ok(fullPrompt.includes("Could not read prompt file"));
		assert.ok(fullPrompt.includes("Task: proceed"));
	});
});

// ─── getPiInvocation ───────────────────────────────────────────────────────────

describe("getPiInvocation", () => {
	it("returns a command and args array", () => {
		const inv = getPiInvocation(["--mode", "json", "-p"]);
		assert.ok(typeof inv.command === "string");
		assert.ok(Array.isArray(inv.args));
	});
});

// ─── loadWorkflowStagesConfig ─────────────────────────────────────────────────

describe("loadWorkflowStagesConfig", () => {
	it("loads seven pipeline stages from the project stages.json", () => {
		// Test lives in pi/extensions/subagent/ — findPackageRoot walks up to repo root
		const pkgRoot = findPackageRoot(__dirname);
		assert.notEqual(pkgRoot, null, "Should find repo root via findPackageRoot");

		const config = loadWorkflowStagesConfig(__dirname);
		assert.notEqual(config, null, "Should load stages.json from pi.stageConfig");

		// All seven pipeline stages must be present (sorted alphabetically)
		const expectedStages = [
			"coding",
			"documenting",
			"fixing",
			"reviewing",
			"test-reviewing",
			"test-writing",
			"verifying",
		];
		assert.deepEqual(Object.keys(config!).sort(), expectedStages);

		// Each stage must have a description
		for (const stage of expectedStages) {
			assert.ok(
				config![stage].description,
				`Stage "${stage}" is missing a description`,
			);
			assert.ok(
				config![stage].description.length > 0,
				`Stage "${stage}" has an empty description`,
			);
		}

		// Coding stage should have full tools and use the strongest model (big-pickle)
		assert.equal(config!.coding.description, "Implement features via TDD vertical slices using the style-code skill");
		assert.equal(config!.coding["model-pi"], "big-pickle");
		assert.ok(config!.coding.tools!.includes("edit"));
		assert.ok(config!.coding.tools!.includes("write"));

		// Verifying stage should be read-only (no edit/write) and use a flash model
		assert.equal(config!.verifying["model-pi"], "deepseek-v4-flash-free");
		assert.ok(!config!.verifying.tools!.includes("edit"));
		assert.ok(!config!.verifying.tools!.includes("write"));
	});


	it("returns null when stages.json does not exist", () => {
		const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "subagent-test-"));
		try {
			// No package.json at all
			const result = loadWorkflowStagesConfig(tmpDir);
			assert.equal(result, null);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns parsed config when package.json has pi.stageConfig", () => {
		const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "subagent-test-"));
		try {
			const stagesDir = path.join(tmpDir, "my", "custom", "path");
			fs.mkdirSync(stagesDir, { recursive: true });
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({
					name: "test",
					pi: { stageConfig: "./my/custom/path/stages.json" },
				}),
			);
			const config = {
				coding: {
					description: "Write code",
					"model-pi": "claude-sonnet-4-5",
					tools: ["read", "bash", "edit", "write"],
				},
			};
			fs.writeFileSync(path.join(stagesDir, "stages.json"), JSON.stringify(config));

			const result = loadWorkflowStagesConfig(tmpDir);
			assert.notEqual(result, null);
			assert.equal(result!.coding.description, "Write code");
			assert.equal(result!.coding["model-pi"], "claude-sonnet-4-5");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns null when package.json has no pi.stageConfig", () => {
		const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "subagent-test-"));
		try {
			fs.writeFileSync(
				path.join(tmpDir, "package.json"),
				JSON.stringify({ name: "test", pi: { extensions: ["./ext"] } }),
			);
			const result = loadWorkflowStagesConfig(tmpDir);
			assert.equal(result, null);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

// ─── findPackageRoot ───────────────────────────────────────────────────────────

describe("findPackageRoot", () => {
	it("finds package root by walking up", () => {
		const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "subagent-test-"));
		try {
			fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));
			const nested = path.join(tmpDir, "a", "b", "c");
			fs.mkdirSync(nested, { recursive: true });
			assert.equal(findPackageRoot(nested), tmpDir);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns null when no package.json found", () => {
		const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "subagent-test-"));
		try {
			const result = findPackageRoot(tmpDir);
			assert.equal(result, null);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

// ─── discoverAgents ────────────────────────────────────────────────────────────

describe("discoverAgents", () => {
	it("returns empty agents when dirs don't exist", () => {
		const tmpDir = fs.mkdtempSync(path.join(tmpdir(), "subagent-test-"));
		try {
			const result = discoverAgents(tmpDir, "user");
			assert.equal(result.agents.length, 0);
			assert.equal(result.projectAgentsDir, null);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

// ─── Frontmatter tool parsing ──────────────────────────────────────────────────

describe("frontmatter tool parsing", () => {
	function parseTools(content: string): string[] {
		const { frontmatter } = parseFrontmatter<Record<string, any>>(content);
		return Array.isArray(frontmatter.tools)
			? frontmatter.tools.map((t: string) => t.trim()).filter(Boolean)
			: typeof frontmatter.tools === "string"
				? frontmatter.tools.split(",").map((t: string) => t.trim()).filter(Boolean)
				: [];
	}

	it("parses array tools from YAML frontmatter", () => {
		const content = `---
name: test-agent
description: An agent for testing
tools:
  - read
  - bash
  - edit
---
This is the system prompt.`;
		assert.deepEqual(parseTools(content), ["read", "bash", "edit"]);
	});

	it("parses comma-separated string tools", () => {
		const content = `---
name: test-agent
description: An agent for testing
tools: read, bash, edit
---
This is the system prompt.`;
		assert.deepEqual(parseTools(content), ["read", "bash", "edit"]);
	});

	it("handles missing tools field", () => {
		const content = `---
name: test-agent
description: An agent for testing
---
This is the system prompt.`;
		assert.deepEqual(parseTools(content), []);
	});
});
