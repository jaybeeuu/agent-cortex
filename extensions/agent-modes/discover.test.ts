import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  type AgentDef,
  type TokenMap,
  discoverAgents,
  loadTokenMap,
} from "./discover.ts";

// Real token-map.json at the package root — the canonical tool/path map the
// extension ships with. Used to verify translation against the source of truth.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_TOKEN_MAP = loadTokenMap(join(REPO_ROOT, "agents"));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface Fixture {
  dir: string;
  agentsDir: string;
  cleanup: () => void;
}

function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "agent-modes-"));
  return {
    dir,
    agentsDir: join(dir, "agents"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function writeFixture(fx: Fixture, relPath: string, content: string): void {
  const p = join(fx.dir, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function writeComposableAgent(
  fx: Fixture,
  name: string,
  opts: {
    body?: string;
    frontmatter?: Record<string, unknown>;
    sections?: Record<string, string>;
  } = {},
): void {
  const base = `agents/${name}`;
  writeFixture(fx, `${base}/agent.md`, opts.body ?? `# ${name}\nBody of ${name}.`);
  writeFixture(
    fx,
    `${base}/pi/frontmatter.json`,
    JSON.stringify(
      opts.frontmatter ?? {
        name: `agent-cortex:${name}`,
        description: `Description of ${name}`,
        tools: ["bash", "view", "task"],
      },
    ),
  );
  for (const [section, body] of Object.entries(opts.sections ?? {})) {
    writeFixture(fx, `${base}/pi/${section}.md`, body);
  }
}

function writeFlatAgent(fx: Fixture, name: string, body: string): void {
  writeFixture(fx, `agents/${name}.agent.md`, body);
}

const fixtures: Fixture[] = [];
function track(fx: Fixture): Fixture {
  fixtures.push(fx);
  return fx;
}

after(() => {
  for (const fx of fixtures) fx.cleanup();
});

const FLAT_FRONTMATTER = (name: string, tools: string) =>
  `---\ndescription: "Flat description of ${name}"\nname: "agent-cortex:${name}"\ntools: ${tools}\n---\n\nFlat body of ${name}.`;

// ─── Tokens ───────────────────────────────────────────────────────────────────

const TOKEN_PROSE =
  "Run with {{TOOL:bash}}.\n" +
  "Ask the user with {{TOOL:ask_user}}.\n" +
  "Read the plan skill at {{PATH:skills/workflow/plan/SKILL.md}}.\n" +
  "Agents live in {{PATH:agents_dir}}.";

// ─── Composable discovery ────────────────────────────────────────────────────

describe("discoverAgents (composable source format)", () => {
  it("discovers agents from <name>/agent.md + <name>/pi/frontmatter.json", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "ralph", {
      body: "# ralph\nUse {{TOOL:task}} to spawn subagents.\n\n{{SECTION:polling}}",
      frontmatter: {
        name: "agent-cortex:ralph",
        description: "Runs beads end-to-end",
        tools: ["bash", "view", "rg", "glob", "task", "read_agent"],
      },
      sections: {
        polling: "## PI polling\nPoll with task + read_agent.",
      },
    });

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);

    assert.equal(agents.length, 1);
    const ralph = agents[0];
    assert.equal(ralph.id, "ralph");
    assert.equal(ralph.name, "agent-cortex:ralph");
    assert.equal(ralph.description, "Runs beads end-to-end");
    // Canonical tool names translated to PI names via token-map (glob→find, rg→grep, view→read).
    assert.deepEqual(ralph.tools, ["bash", "find", "grep", "read", "read_agent", "task"]);
    // SECTION token resolved from pi/<section>.md; TOOL token substituted.
    assert.match(ralph.prompt, /Use task to spawn subagents\./);
    assert.match(ralph.prompt, /Poll with task \+ read_agent\./);
    assert.doesNotMatch(ralph.prompt, /\{\{/);
  });

  it("substitutes TOOL / PATH tokens against token-map.json using the real plugin root", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "plan", {
      body: TOKEN_PROSE,
      frontmatter: { name: "agent-cortex:plan", description: "Planner", tools: [] },
    });

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);
    assert.equal(agents.length, 1);
    const plan = agents[0];

    // {{TOOL:bash}} → bash.
    assert.match(plan.prompt, /Run with bash\./);
    // {{TOOL:ask_user}} → null for pi — token dropped (dangling prose is the author's
    // responsibility per token-map.README), not left as literal token syntax.
    assert.doesNotMatch(plan.prompt, /\{\{TOOL:ask_user\}\}/);
    // Relative {{PATH:...}} resolves against the actual package root (dir of agents/).
    assert.match(plan.prompt, new RegExp(`Read the plan skill at ${escapeRegExp(fx.dir)}/skills/workflow/plan/SKILL\\.md\\.`));
    // Named {{PATH:agents_dir}} resolves to <root>/agents.
    assert.match(plan.prompt, new RegExp(`Agents live in ${escapeRegExp(fx.agentsDir)}\\.`));
    assert.doesNotMatch(plan.prompt, /\{\{/);
  });

  it("drops null-mapped tools (ask_user, skill) from the PI tool set", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "plan", {
      frontmatter: {
        name: "agent-cortex:plan",
        description: "Planner",
        tools: ["bash", "ask_user", "skill", "web_fetch"],
      },
    });

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);
    assert.equal(agents.length, 1);
    // ask_user → null (omitted), skill → null (omitted), web_fetch → fetch_content.
    assert.deepEqual(agents[0].tools, ["bash", "fetch_content"]);
  });

  it("uses the built-in fallback map when token-map.json is unavailable", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "legacy", {
      frontmatter: {
        name: "agent-cortex:legacy",
        description: "No token map",
        tools: ["view", "glob", "ask_user"],
      },
    });

    const agents = discoverAgents(fx.agentsDir);
    assert.equal(agents.length, 1);
    // Copilot→PI fallback: view→read, glob→find+ls; unmapped ask_user passes through.
    assert.deepEqual(agents[0].tools, ["ask_user", "find", "ls", "read"]);
  });

  it("returns an empty list for a missing agents directory", () => {
    const fx = track(makeFixture());
    assert.deepEqual(discoverAgents(join(fx.dir, "does-not-exist"), REAL_TOKEN_MAP), []);
  });

  it("returns an empty list when no agents are present", () => {
    const fx = track(makeFixture());
    mkdirSync(fx.agentsDir, { recursive: true });
    assert.deepEqual(discoverAgents(fx.agentsDir, REAL_TOKEN_MAP), []);
  });
});

// ─── Flat fallback ────────────────────────────────────────────────────────────

describe("discoverAgents (flat fallback)", () => {
  it("prefers a composable directory over its flat file for the same agent", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "ralph", { body: "Composable body." });
    writeFlatAgent(fx, "ralph", FLAT_FRONTMATTER("ralph", '["bash", "view"]'));

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);

    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "ralph");
    assert.match(agents[0].prompt, /Composable body\./);
    assert.doesNotMatch(agents[0].prompt, /Flat body/);
  });

  it("falls back to flat *.agent.md for agents without a composable directory", () => {
    const fx = track(makeFixture());
    writeFlatAgent(fx, "strategy", FLAT_FRONTMATTER("strategy", '["bash", "view", "web_fetch"]'));

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);

    assert.equal(agents.length, 1);
    const strategy = agents[0];
    assert.equal(strategy.id, "strategy");
    assert.equal(strategy.name, "agent-cortex:strategy");
    assert.equal(strategy.description, "Flat description of strategy");
    // view→read, web_fetch→fetch_content via token-map.
    assert.deepEqual(strategy.tools, ["bash", "fetch_content", "read"]);
    assert.match(strategy.prompt, /Flat body of strategy\./);
  });
});

// ─── loadTokenMap ────────────────────────────────────────────────────────────

describe("loadTokenMap", () => {
  it("reads the real token-map.json at the package root", () => {
    assert.ok(REAL_TOKEN_MAP);
    assert.equal(typeof REAL_TOKEN_MAP?.tools?.bash?.pi, "string");
    // ask_user has no PI equivalent per the contract — must stay null.
    assert.equal(REAL_TOKEN_MAP?.tools?.ask_user?.pi, null);
    assert.ok(REAL_TOKEN_MAP?.paths?.agents_dir);
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}