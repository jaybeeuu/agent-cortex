// @ts-check
// Repo-level tests for the composable agent directory validator at
// `scripts/validate-agent-dir.mjs`. The validator has no CLI — it is a pure
// module, so these tests import it by path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { validateFrontmatter, validateToolSet, validateAgentDir } from "../scripts/validate-agent-dir.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

// One temp root for the file; its own after() hook removes every workspace.
const tempRoot = createTempRoot("agent-dir-test-");

/**
 * @typedef {object} Frontmatter
 * @property {string} name
 * @property {string} description
 * @property {string} [model]
 * @property {string} [argumentHint]
 */

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * @param {Partial<Frontmatter>} [overrides]
 * @returns {Frontmatter}
 */
function makeFrontmatter(overrides = {}) {
  return {
    name: "agent-cortex:ralph",
    description: "Parallel task orchestration agent",
    ...overrides,
  };
}

/**
 * @param {string} tmpDir
 * @param {string} name
 * @param {Frontmatter} frontmatter
 * @param {{ body?: string, toolSet?: Record<string, unknown> | null, sections?: Record<string, string>,
 *           skills?: string[] }} [options]
 * @returns {Promise<string>} the agent directory
 */
async function createAgentDir(tmpDir, name, frontmatter, options = {}) {
  const { body = "# Shared body\n\nYou are an agent.", toolSet = { tools: ["bash"], skills: [] }, sections, skills } = options;
  const agentDir = join(tmpDir, "agents", name);
  await mkdir(agentDir, { recursive: true });

  await writeFile(join(agentDir, "agent.md"), body, "utf-8");

  // The tool set is authored once per agent, beside agent.md.
  if (toolSet !== null) {
    await writeFile(join(agentDir, "tools.json"), JSON.stringify(toolSet), "utf-8");
  }

  // Write frontmatter.json for PI harness
  const piDir = join(agentDir, "pi");
  await mkdir(piDir, { recursive: true });
  await writeFile(join(piDir, "frontmatter.json"), JSON.stringify(frontmatter), "utf-8");

  // Write optional sections
  if (sections) {
    for (const [filename, content] of Object.entries(sections)) {
      await writeFile(join(piDir, filename), content, "utf-8");
    }
  }

  // Seed real skill directories under the package root's skills/ tree.
  for (const entry of skills ?? []) {
    const dir = join(tmpDir, "skills", ...entry.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: x\ndescription: d\n---\nBody.\n", "utf-8");
  }

  return agentDir;
}

// ─── Behavior 1: validate frontmatter.json ────────────────────────────────────

describe("validateFrontmatter", () => {
  it("accepts frontmatter with the required fields", () => {
    const result = validateFrontmatter(makeFrontmatter());
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("accepts frontmatter with the optional model and argumentHint fields", () => {
    const fm = makeFrontmatter({ model: "claude-sonnet-4-5", argumentHint: "Run all pending beads" });
    assert.equal(validateFrontmatter(fm).ok, true);
  });

  it("rejects frontmatter missing name", () => {
    const result = validateFrontmatter(/** @type {any} */ ({ description: "desc" }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("name")));
  });

  it("rejects frontmatter missing description", () => {
    const result = validateFrontmatter(/** @type {any} */ ({ name: "test" }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("description")));
  });

  it("rejects a tools list, naming the file that authors it", () => {
    // The tool set is behaviour, not harness metadata: one authored file, so a
    // second copy in a harness frontmatter is refused rather than ignored.
    const result = validateFrontmatter(
      /** @type {any} */ ({ ...makeFrontmatter(), tools: ["bash", "task"] }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("tools.json")));
  });

  it("rejects frontmatter with empty name or description", () => {
    assert.ok(validateFrontmatter(makeFrontmatter({ name: "" })).errors.some((e) => e.includes("name")));
    assert.ok(
      validateFrontmatter(makeFrontmatter({ description: "" })).errors.some((e) => e.includes("description")),
    );
  });

  it("rejects frontmatter with unknown fields", () => {
    const result = validateFrontmatter(/** @type {any} */ ({ ...makeFrontmatter(), unknownField: "value" }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("unknown")));
  });
});

// ─── Behavior 2: validate tools.json ─────────────────────────────────────────

describe("validateToolSet", () => {
  it("accepts a tool set of capability keys plus its skills", () => {
    const result = validateToolSet({ tools: ["bash", "task"], skills: ["workflow/ralph"] });
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("accepts the all-tools sentinel as the sole tools value", () => {
    assert.equal(validateToolSet({ tools: ["*"], skills: [] }).ok, true);
  });

  it("rejects a tool set missing tools or skills", () => {
    assert.ok(validateToolSet({ skills: [] }).errors.some((e) => e.includes("tools")));
    assert.ok(validateToolSet({ tools: ["bash"] }).errors.some((e) => e.includes("skills")));
  });

  it("rejects non-array, empty and non-string tools", () => {
    for (const tools of ["bash", [], ["bash", 5]]) {
      const result = validateToolSet({ tools, skills: [] });
      assert.equal(result.ok, false, `${JSON.stringify(tools)} is refused`);
    }
  });

  it("rejects the all-tools sentinel combined with a tool name", () => {
    // Both installers resolve ["*"] by omitting the rendered tools line, so a
    // mixed list would put a literal `*` where pi's --tools reads a glob and
    // Claude Code expects a name.
    assert.ok(
      validateToolSet({ tools: ["*", "bash"], skills: [] }).errors.some((e) => e.includes("cannot be combined")),
    );
    // Padding carries no meaning, and every layer trims before it compares.
    assert.ok(
      validateToolSet({ tools: [" *", "bash"], skills: [] }).errors.some((e) => e.includes("cannot be combined")),
    );
  });

  it("rejects unknown fields", () => {
    const result = validateToolSet({ tools: ["bash"], skills: [], model: "x" });
    assert.ok(result.errors.some((e) => e.includes("unknown")));
  });
});

// ─── Behavior 3: validate agent directory structure ───────────────────────────

describe("validateAgentDir", () => {
  it("accepts an agent directory with agent.md, tools.json and pi/frontmatter.json", async () => {
    const tmpDir = await tempRoot.createWorkspace();
    const agentDir = await createAgentDir(tmpDir, "ralph", makeFrontmatter());
    assert.deepEqual(await validateAgentDir(agentDir), { ok: true, errors: [] });
  });

  it("accepts an agent directory with multiple harness subdirectories", async () => {
    const tmpDir = await tempRoot.createWorkspace();
    const agentDir = await createAgentDir(tmpDir, "ralph", makeFrontmatter());

    const claudeDir = join(agentDir, "claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "frontmatter.json"), JSON.stringify(makeFrontmatter()), "utf-8");

    assert.deepEqual(await validateAgentDir(agentDir), { ok: true, errors: [] });
  });

  it("accepts an agent directory with section files", async () => {
    const tmpDir = await tempRoot.createWorkspace();
    const agentDir = await createAgentDir(tmpDir, "ralph", makeFrontmatter(), {
      body: "# Body\n\n{{SECTION:wake}}",
      sections: { "wake.md": "# Wake mechanism\n\nYou are woken when a worker completes." },
    });
    assert.deepEqual(await validateAgentDir(agentDir), { ok: true, errors: [] });
  });

  it("accepts a skills entry that names a real skill directory", async () => {
    const tmpDir = await tempRoot.createWorkspace();
    const agentDir = await createAgentDir(tmpDir, "ralph", makeFrontmatter(), {
      toolSet: { tools: ["bash"], skills: ["workflow/ralph"] },
      skills: ["workflow/ralph"],
    });
    assert.deepEqual(await validateAgentDir(agentDir), { ok: true, errors: [] });
  });

  it("rejects a skills entry that names no skill directory", async () => {
    const tmpDir = await tempRoot.createWorkspace();
    const agentDir = await createAgentDir(tmpDir, "ralph", makeFrontmatter(), {
      toolSet: { tools: ["bash"], skills: ["workflow/gone"] },
    });
    const result = await validateAgentDir(agentDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("workflow/gone")));
  });

  it("rejects an agent directory missing tools.json", async () => {
    const tmpDir = await tempRoot.createWorkspace();
    const agentDir = await createAgentDir(tmpDir, "ralph", makeFrontmatter(), { toolSet: null });
    const result = await validateAgentDir(agentDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("tools.json")));
  });

  it("rejects an agent directory missing agent.md", async () => {
    const tmpDir = await tempRoot.createWorkspace();
    const agentDir = join(tmpDir, "agents", "ralph");
    await mkdir(join(agentDir, "pi"), { recursive: true });
    await writeFile(join(agentDir, "pi", "frontmatter.json"), JSON.stringify(makeFrontmatter()), "utf-8");

    const result = await validateAgentDir(agentDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("agent.md")));
  });

  it("rejects an agent directory with no harness subdirectories", async () => {
    const tmpDir = await tempRoot.createWorkspace();
    const agentDir = join(tmpDir, "agents", "ralph");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "agent.md"), "# Body", "utf-8");
    await writeFile(join(agentDir, "tools.json"), JSON.stringify({ tools: ["bash"], skills: [] }), "utf-8");

    const result = await validateAgentDir(agentDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("harness")));
  });

  it("rejects a harness frontmatter that carries a tools list", async () => {
    const tmpDir = await tempRoot.createWorkspace();
    const agentDir = await createAgentDir(
      tmpDir,
      "ralph",
      /** @type {any} */ ({ ...makeFrontmatter(), tools: ["bash"] }),
    );

    const result = await validateAgentDir(agentDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("pi/frontmatter.json") && e.includes("tools.json")));
  });
});

// ─── Behavior 4: token format validation ──────────────────────────────────────

describe("token format in agent.md body", () => {
  it("accepts valid {{CAPABILITY:name}} tokens", () => {
    const body = "# Body\n\nUse {{CAPABILITY:task}} to spawn subagents.";
    const tokens = extractTokens(body);
    assert.deepEqual(tokens.tools, ["task"]);
  });

  it("accepts valid {{PATH:name}} tokens", () => {
    const body = "# Body\n\nRead {{PATH:skills/workflow/plan/SKILL.md}}";
    const tokens = extractTokens(body);
    assert.deepEqual(tokens.paths, ["skills/workflow/plan/SKILL.md"]);
  });

  it("accepts valid {{SECTION:name}} tokens", () => {
    const body = "# Body\n\n{{SECTION:wake}}";
    const tokens = extractTokens(body);
    assert.deepEqual(tokens.sections, ["wake"]);
  });

  it("extracts multiple tokens of different types", () => {
    const body = `
# Body

Use {{CAPABILITY:task}} to spawn.
Read {{PATH:skills/plan/SKILL.md}}.
{{SECTION:wake}}
`;
    const tokens = extractTokens(body);
    assert.deepEqual(tokens.tools, ["task"]);
    assert.deepEqual(tokens.paths, ["skills/plan/SKILL.md"]);
    assert.deepEqual(tokens.sections, ["wake"]);
  });
});

// ─── Helper: extract tokens from markdown ─────────────────────────────────────

/**
 * @param {string} body
 * @returns {{ tools: string[], paths: string[], sections: string[] }}
 */
function extractTokens(body) {
  const toolPattern = /\{\{CAPABILITY:([^}]+)\}\}/g;
  const pathPattern = /\{\{PATH:([^}]+)\}\}/g;
  const sectionPattern = /\{\{SECTION:([^}]+)\}\}/g;

  /** @type {string[]} */
  const tools = [];
  /** @type {string[]} */
  const paths = [];
  /** @type {string[]} */
  const sections = [];

  let match;
  while ((match = toolPattern.exec(body)) !== null) {
    tools.push(/** @type {string} */ (match[1]));
  }
  while ((match = pathPattern.exec(body)) !== null) {
    paths.push(/** @type {string} */ (match[1]));
  }
  while ((match = sectionPattern.exec(body)) !== null) {
    sections.push(/** @type {string} */ (match[1]));
  }

  return { tools, paths, sections };
}
