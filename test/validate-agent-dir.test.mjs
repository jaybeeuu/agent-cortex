// @ts-check
// Repo-level tests for skills/productivity/validate-agent-dir. The validator
// has no CLI — it is a pure module, so these tests import it by path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  validateFrontmatter,
  validateAgentDir,
} from "../skills/productivity/validate-agent-dir/scripts/validate-agent-dir.mjs";

/**
 * @typedef {object} Frontmatter
 * @property {string} name
 * @property {string} description
 * @property {string[]} tools
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
    tools: ["bash", "task", "read_agent"],
    ...overrides,
  };
}

/** Fresh temp dir per test, cleaned up by the caller. */
function makeTmpDir() {
  return mkdtemp(join(tmpdir(), "agent-dir-test-"));
}

/**
 * @param {string} tmpDir
 * @param {string} name
 * @param {Frontmatter} frontmatter
 * @param {string} [body]
 * @param {Record<string, string>} [sections]
 * @returns {Promise<void>}
 */
async function createAgentDir(
  tmpDir,
  name,
  frontmatter,
  body = "# Shared body\n\nYou are an agent.",
  sections
) {
  const agentDir = join(tmpDir, "agents", name);
  await mkdir(agentDir, { recursive: true });

  // Write agent.md
  await writeFile(join(agentDir, "agent.md"), body, "utf-8");

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
}

// ─── Behavior 1: validate frontmatter.json ────────────────────────────────────

describe("validateFrontmatter", () => {
  it("accepts valid frontmatter with required fields", () => {
    const fm = makeFrontmatter();
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, true);
  });

  it("accepts frontmatter with optional model field", () => {
    const fm = makeFrontmatter({ model: "claude-sonnet-4-5" });
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, true);
  });

  it("accepts frontmatter with optional argumentHint field", () => {
    const fm = makeFrontmatter({ argumentHint: "Run all pending beads" });
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, true);
  });

  it("rejects frontmatter missing name", () => {
    const fm = /** @type {any} */ ({ description: "desc", tools: ["bash"] });
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("name")));
  });

  it("rejects frontmatter missing description", () => {
    const fm = /** @type {any} */ ({ name: "test", tools: ["bash"] });
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("description")));
  });

  it("rejects frontmatter missing tools", () => {
    const fm = /** @type {any} */ ({ name: "test", description: "desc" });
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("tools")));
  });

  it("rejects frontmatter with non-array tools", () => {
    const fm = /** @type {any} */ ({ name: "test", description: "desc", tools: "bash" });
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("tools")));
  });

  it("rejects frontmatter with empty name", () => {
    const fm = makeFrontmatter({ name: "" });
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("name")));
  });

  it("rejects frontmatter with empty description", () => {
    const fm = makeFrontmatter({ description: "" });
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("description")));
  });

  it("rejects frontmatter with empty tools array", () => {
    const fm = makeFrontmatter({ tools: [] });
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("tools")));
  });

  it("rejects frontmatter with unknown fields", () => {
    const fm = makeFrontmatter(/** @type {any} */ ({ unknownField: "value" }));
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("unknown")));
  });
});

// ─── Behavior 2: validate agent directory structure ───────────────────────────

describe("validateAgentDir", () => {
  it("accepts valid agent directory with agent.md and pi/frontmatter.json", async () => {
    const tmpDir = await makeTmpDir();
    try {
      await createAgentDir(tmpDir, "ralph", makeFrontmatter());
      const result = validateAgentDir(join(tmpDir, "agents", "ralph"));
      assert.equal(result.ok, true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts agent directory with multiple harness subdirectories", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const agentDir = join(tmpDir, "agents", "ralph");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.md"), "# Body", "utf-8");

      // PI harness
      const piDir = join(agentDir, "pi");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        join(piDir, "frontmatter.json"),
        JSON.stringify(makeFrontmatter({ tools: ["bash", "task"] })),
        "utf-8"
      );

      // Claude harness
      const claudeDir = join(agentDir, "claude");
      await mkdir(claudeDir, { recursive: true });
      await writeFile(
        join(claudeDir, "frontmatter.json"),
        JSON.stringify(makeFrontmatter({ tools: ["bash", "task"] })),
        "utf-8"
      );

      const result = validateAgentDir(agentDir);
      assert.equal(result.ok, true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts agent directory with section files", async () => {
    const tmpDir = await makeTmpDir();
    try {
      await createAgentDir(
        tmpDir,
        "ralph",
        makeFrontmatter(),
        "# Body\n\n{{SECTION:wake}}",
        { "wake.md": "# Wake mechanism\n\nYou are woken when a worker completes." }
      );
      const result = validateAgentDir(join(tmpDir, "agents", "ralph"));
      assert.equal(result.ok, true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects agent directory missing agent.md", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const agentDir = join(tmpDir, "agents", "ralph");
      await mkdir(agentDir, { recursive: true });
      await mkdir(join(agentDir, "pi"), { recursive: true });
      await writeFile(
        join(agentDir, "pi", "frontmatter.json"),
        JSON.stringify(makeFrontmatter()),
        "utf-8"
      );

      const result = validateAgentDir(agentDir);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.includes("agent.md")));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects agent directory with no harness subdirectories", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const agentDir = join(tmpDir, "agents", "ralph");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.md"), "# Body", "utf-8");

      const result = validateAgentDir(agentDir);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.includes("harness")));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects agent directory with invalid frontmatter in harness", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const agentDir = join(tmpDir, "agents", "ralph");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.md"), "# Body", "utf-8");

      const piDir = join(agentDir, "pi");
      await mkdir(piDir, { recursive: true });
      // Invalid frontmatter: missing tools
      await writeFile(
        join(piDir, "frontmatter.json"),
        JSON.stringify({ name: "test", description: "desc" }),
        "utf-8"
      );

      const result = validateAgentDir(agentDir);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.includes("tools")));
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── Behavior 3: token format validation ──────────────────────────────────────

describe("token format in agent.md body", () => {
  it("accepts valid {{TOOL:name}} tokens", () => {
    const body = "# Body\n\nUse {{TOOL:task}} to spawn subagents.";
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

Use {{TOOL:task}} to spawn.
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
  const toolPattern = /\{\{TOOL:([^}]+)\}\}/g;
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
