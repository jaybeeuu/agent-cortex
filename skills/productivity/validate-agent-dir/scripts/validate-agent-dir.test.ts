import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  validateFrontmatter,
  validateAgentDir,
  type AgentDir,
  type Frontmatter,
} from "./validate-agent-dir.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeFrontmatter(overrides: Partial<Frontmatter> = {}): Frontmatter {
  return {
    name: "agent-cortex:ralph",
    description: "Parallel task orchestration agent",
    tools: ["bash", "task", "read_agent"],
    ...overrides,
  };
}

function createAgentDir(
  tmpDir: string,
  name: string,
  frontmatter: Frontmatter,
  body: string = "# Shared body\n\nYou are an agent.",
  sections?: Record<string, string>
): void {
  const agentDir = join(tmpDir, "agents", name);
  mkdirSync(agentDir, { recursive: true });

  // Write agent.md
  writeFileSync(join(agentDir, "agent.md"), body, "utf-8");

  // Write frontmatter.json for PI harness
  const piDir = join(agentDir, "pi");
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, "frontmatter.json"), JSON.stringify(frontmatter), "utf-8");

  // Write optional sections
  if (sections) {
    for (const [filename, content] of Object.entries(sections)) {
      writeFileSync(join(piDir, filename), content, "utf-8");
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
    const fm = { description: "desc", tools: ["bash"] } as any;
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("name")));
  });

  it("rejects frontmatter missing description", () => {
    const fm = { name: "test", tools: ["bash"] } as any;
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("description")));
  });

  it("rejects frontmatter missing tools", () => {
    const fm = { name: "test", description: "desc" } as any;
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("tools")));
  });

  it("rejects frontmatter with non-array tools", () => {
    const fm = { name: "test", description: "desc", tools: "bash" } as any;
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
    const fm = makeFrontmatter({ unknownField: "value" } as any);
    const result = validateFrontmatter(fm);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("unknown")));
  });
});

// ─── Behavior 2: validate agent directory structure ───────────────────────────

describe("validateAgentDir", () => {
  let tmpDir: string;

  it("accepts valid agent directory with agent.md and pi/frontmatter.json", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-dir-test-"));
    try {
      createAgentDir(tmpDir, "ralph", makeFrontmatter());
      const result = validateAgentDir(join(tmpDir, "agents", "ralph"));
      assert.equal(result.ok, true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts agent directory with multiple harness subdirectories", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-dir-test-"));
    try {
      const agentDir = join(tmpDir, "agents", "ralph");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "agent.md"), "# Body", "utf-8");

      // PI harness
      const piDir = join(agentDir, "pi");
      mkdirSync(piDir, { recursive: true });
      writeFileSync(
        join(piDir, "frontmatter.json"),
        JSON.stringify(makeFrontmatter({ tools: ["bash", "task"] })),
        "utf-8"
      );

      // Claude harness
      const claudeDir = join(agentDir, "claude");
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(
        join(claudeDir, "frontmatter.json"),
        JSON.stringify(makeFrontmatter({ tools: ["bash", "task"] })),
        "utf-8"
      );

      const result = validateAgentDir(agentDir);
      assert.equal(result.ok, true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts agent directory with section files", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-dir-test-"));
    try {
      createAgentDir(
        tmpDir,
        "ralph",
        makeFrontmatter(),
        "# Body\n\n{{SECTION:polling}}",
        { "polling.md": "# Polling loop\n\nYou poll every 2 minutes." }
      );
      const result = validateAgentDir(join(tmpDir, "agents", "ralph"));
      assert.equal(result.ok, true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects agent directory missing agent.md", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-dir-test-"));
    try {
      const agentDir = join(tmpDir, "agents", "ralph");
      mkdirSync(agentDir, { recursive: true });
      mkdirSync(join(agentDir, "pi"), { recursive: true });
      writeFileSync(
        join(agentDir, "pi", "frontmatter.json"),
        JSON.stringify(makeFrontmatter()),
        "utf-8"
      );

      const result = validateAgentDir(agentDir);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.includes("agent.md")));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects agent directory with no harness subdirectories", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-dir-test-"));
    try {
      const agentDir = join(tmpDir, "agents", "ralph");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "agent.md"), "# Body", "utf-8");

      const result = validateAgentDir(agentDir);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.includes("harness")));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects agent directory with invalid frontmatter in harness", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-dir-test-"));
    try {
      const agentDir = join(tmpDir, "agents", "ralph");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "agent.md"), "# Body", "utf-8");

      const piDir = join(agentDir, "pi");
      mkdirSync(piDir, { recursive: true });
      // Invalid frontmatter: missing tools
      writeFileSync(
        join(piDir, "frontmatter.json"),
        JSON.stringify({ name: "test", description: "desc" }),
        "utf-8"
      );

      const result = validateAgentDir(agentDir);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((e) => e.includes("tools")));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
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
    const body = "# Body\n\n{{SECTION:polling}}";
    const tokens = extractTokens(body);
    assert.deepEqual(tokens.sections, ["polling"]);
  });

  it("extracts multiple tokens of different types", () => {
    const body = `
# Body

Use {{TOOL:task}} to spawn.
Read {{PATH:skills/plan/SKILL.md}}.
{{SECTION:polling}}
`;
    const tokens = extractTokens(body);
    assert.deepEqual(tokens.tools, ["task"]);
    assert.deepEqual(tokens.paths, ["skills/plan/SKILL.md"]);
    assert.deepEqual(tokens.sections, ["polling"]);
  });
});

// ─── Helper: extract tokens from markdown ─────────────────────────────────────

function extractTokens(body: string): {
  tools: string[];
  paths: string[];
  sections: string[];
} {
  const toolPattern = /\{\{TOOL:([^}]+)\}\}/g;
  const pathPattern = /\{\{PATH:([^}]+)\}\}/g;
  const sectionPattern = /\{\{SECTION:([^}]+)\}\}/g;

  const tools: string[] = [];
  const paths: string[] = [];
  const sections: string[] = [];

  let match;
  while ((match = toolPattern.exec(body)) !== null) {
    tools.push(match[1]!);
  }
  while ((match = pathPattern.exec(body)) !== null) {
    paths.push(match[1]!);
  }
  while ((match = sectionPattern.exec(body)) !== null) {
    sections.push(match[1]!);
  }

  return { tools, paths, sections };
}
