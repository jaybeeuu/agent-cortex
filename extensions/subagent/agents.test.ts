/**
 * Subagent agent discovery — the directories the "user" scope reads.
 *
 * pi has no agent resource type: agents ship beside the extensions that serve
 * them, so user-scope discovery covers pi's own user agent dir (hand-written
 * personal agents, plus copies older installers made) and the package this
 * extension ships inside. `agent-cortex install pi` renders the flat pi agents
 * into `<package>/agents`; a source checkout keeps its composable tree there
 * instead, plus flat renders for other harnesses, which are not pi's agents.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAgents, loadUserAgents, resolveUserAgentDirs } from "./agents.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Write a flat agent file the way a renderer does: frontmatter plus body. */
function writeAgent(dir: string, name: string, body = `# ${name}\n`): string {
	const filePath = join(dir, `${name}.agent.md`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, `---\nname: "${name}"\ndescription: "${name} agent"\n---\n\n${body}`);
	return filePath;
}

/** Write a composable agent source dir: `<agentsDir>/<name>/agent.md`. */
function writeComposableAgent(agentsDir: string, name: string): void {
	const dir = join(agentsDir, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "agent.md"), `# ${name}\n`);
}

describe("resolveUserAgentDirs", () => {
	it("reads the agents a staged package rendered beside the extension", () => {
		const root = mkdtempSync(join(tmpdir(), "subagent-package-"));
		try {
			const shipped = writeAgent(join(root, "agents"), "ralph", "Staged ralph body.\n");

			const dirs = resolveUserAgentDirs(root);

			assert.ok(dirs.includes(join(root, "agents")), `expected ${join(root, "agents")} in ${dirs.join(", ")}`);
			assert.equal(loadUserAgents(dirs).find((agent) => agent.name === "ralph")?.filePath, shipped);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("leaves a source checkout's composable agents tree to the agent-modes extension", () => {
		const root = mkdtempSync(join(tmpdir(), "subagent-checkout-"));
		try {
			writeComposableAgent(join(root, "agents"), "ralph");
			writeAgent(join(root, "agents"), "ralph", "Copilot render.\n");

			const dirs = resolveUserAgentDirs(root);

			assert.ok(!dirs.includes(join(root, "agents")), `checkout agents dir must not be read: ${dirs.join(", ")}`);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("discoverAgents (user scope)", () => {
	it("does not hand pi the flat renders this checkout holds for other harnesses", () => {
		const { agents } = discoverAgents(tmpdir(), "user");

		assert.ok(
			agents.every((agent) => !agent.filePath.startsWith(join(PACKAGE_ROOT, "agents"))),
			`checkout renders leaked into discovery: ${agents.map((agent) => agent.filePath).join(", ")}`,
		);
	});
});

describe("loadUserAgents", () => {
	it("merges every dir and lets the earlier dir win a name collision", () => {
		const root = mkdtempSync(join(tmpdir(), "subagent-agents-"));
		try {
			const personal = join(root, "pi", "agent", "agents");
			const shipped = join(root, "package", "agents");
			writeAgent(personal, "plan", "Personal plan body.\n");
			writeAgent(personal, "personal-only", "Personal agent body.\n");
			writeAgent(shipped, "plan", "Shipped plan body.\n");
			writeAgent(shipped, "shipped-only", "Shipped agent body.\n");

			const agents = loadUserAgents([personal, shipped]);

			assert.deepEqual(
				agents.map((agent) => agent.name).sort(),
				["personal-only", "plan", "shipped-only"],
			);
			assert.equal(agents.find((agent) => agent.name === "plan")?.filePath, join(personal, "plan.agent.md"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reads a tool list whether it is a YAML scalar or sequence", () => {
		const root = mkdtempSync(join(tmpdir(), "subagent-agents-"));
		try {
			const shipped = join(root, "agents");
			mkdirSync(shipped, { recursive: true });
			writeFileSync(join(shipped, "scalar.agent.md"), `---\nname: "scalar"\ndescription: "d"\ntools: "bash, read"\n---\n\n# scalar\n`);
			writeFileSync(join(shipped, "sequence.agent.md"), `---\nname: "sequence"\ndescription: "d"\ntools: ["bash", "read"]\n---\n\n# sequence\n`);

			const tools = Object.fromEntries(loadUserAgents([shipped]).map((agent) => [agent.name, agent.tools]));

			assert.deepEqual(tools, { scalar: ["bash", "read"], sequence: ["bash", "read"] });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("ignores directories that do not exist", () => {
		const root = mkdtempSync(join(tmpdir(), "subagent-agents-"));
		try {
			const shipped = join(root, "agents");
			writeAgent(shipped, "ralph", "Shipped ralph body.\n");

			const agents = loadUserAgents([join(root, "missing"), shipped]);

			assert.deepEqual(
				agents.map((agent) => agent.name),
				["ralph"],
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
