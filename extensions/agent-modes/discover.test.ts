import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  type AgentDef,
  type TokenMap,
  DEFAULT_TOOLS,
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
    tools?: string[];
    skills?: string[];
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
      },
    ),
  );
  // The tool set lives once per agent, beside agent.md (agents/README.md).
  writeFixture(
    fx,
    `${base}/tools.json`,
    JSON.stringify({ tools: opts.tools ?? ["bash", "view", "task"], skills: opts.skills ?? [] }),
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
  "Run with {{CAPABILITY:bash}}.\n" +
  "Ask the user with {{CAPABILITY:ask_user}}.\n" +
  "Read the plan skill at {{PATH:skills/workflow/plan/SKILL.md}}.\n" +
  "Agents live in {{PATH:agents_dir}}.";

// ─── Composable discovery ────────────────────────────────────────────────────

describe("discoverAgents (composable source format)", () => {
  it("discovers agents from <name>/agent.md + <name>/pi/frontmatter.json + <name>/tools.json", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "ralph", {
      body: "# ralph\nUse {{CAPABILITY:task}} to spawn subagents.\n\n{{SECTION:wake}}",
      frontmatter: {
        name: "agent-cortex:ralph",
        description: "Runs beads end-to-end",
      },
      tools: ["bash", "view", "rg", "glob", "task", "read_agent"],
      sections: {
        wake: "## PI wake\nPoll with task + read_agent.",
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
    // SECTION token resolved from pi/<section>.md; CAPABILITY token substituted.
    assert.match(ralph.prompt, /Use task to spawn subagents\./);
    assert.match(ralph.prompt, /Poll with task \+ read_agent\./);
    assert.doesNotMatch(ralph.prompt, /\{\{/);
  });

  it("substitutes CAPABILITY / PATH tokens against token-map.json using the real plugin root", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "plan", {
      body: TOKEN_PROSE,
      frontmatter: { name: "agent-cortex:plan", description: "Planner" },
      tools: [],
    });

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);
    assert.equal(agents.length, 1);
    const plan = agents[0];

    // {{CAPABILITY:bash}} → bash.
    assert.match(plan.prompt, /Run with bash\./);
    // {{CAPABILITY:ask_user}} → ask_questions (pi's native structured-questions tool).
    assert.match(plan.prompt, /Ask the user with ask_questions\./);
    assert.doesNotMatch(plan.prompt, /\{\{CAPABILITY:ask_user\}\}/);
    // Relative {{PATH:...}} resolves against the actual package root (dir of agents/).
    assert.match(plan.prompt, new RegExp(`Read the plan skill at ${escapeRegExp(fx.dir)}/skills/workflow/plan/SKILL\\.md\\.`));
    // Named {{PATH:agents_dir}} resolves to <root>/agents.
    assert.match(plan.prompt, new RegExp(`Agents live in ${escapeRegExp(fx.agentsDir)}\\.`));
    assert.doesNotMatch(plan.prompt, /\{\{/);
  });

  it("maps ask_user → ask_questions and skill → read into the PI tool set", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "plan", {
      frontmatter: {
        name: "agent-cortex:plan",
        description: "Planner",
      },
      tools: ["bash", "ask_user", "skill", "web_fetch"],
    });

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);
    assert.equal(agents.length, 1);
    // ask_user → ask_questions, skill → read (pi reads skill files), web_fetch → fetch_content.
    assert.deepEqual(agents[0].tools, ["ask_questions", "bash", "fetch_content", "read"]);
  });

  it("omits a capability whose pi binding is null, without warning", () => {
    const fx = track(makeFixture());
    const NULL_MAP = {
      capabilities: { ask_user: { claude: { name: "AskUserQuestion", type: "tool" }, pi: null } },
      paths: {},
    } as TokenMap;
    writeComposableAgent(fx, "plan", {
      frontmatter: {
        name: "agent-cortex:plan",
        description: "Planner",
      },
      tools: ["ask_user", "bash"],
    });

    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));
    let agents;
    try {
      agents = discoverAgents(fx.agentsDir, NULL_MAP);
    } finally {
      console.warn = original;
    }
    assert.equal(agents.length, 1);
    // With a null pi column the entry is omitted silently: one authored set
    // serves both harnesses, so a harness-only row is normal, not a defect.
    // (bash survives so the result is observable — an all-dropped list would be
    // normalised to DEFAULT_TOOLS, which is "no restriction", not the omit result.)
    assert.deepEqual(agents[0].tools, ["bash"]);
    assert.deepEqual(warnings, [], "an expected omission is not warning noise");
  });

  it("refuses a capability bound to a command in a tool list, naming the canonical key", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "plan", {
      frontmatter: {
        name: "agent-cortex:plan",
        description: "Planner",
      },
      // The post-merge-watch extension registers a CLI flag, not a pi tool.
      tools: ["bash", "post_merge_watch"],
    });

    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));
    try {
      const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);
      // The agent is skipped, not enabled with a name pi never offers as a tool.
      assert.deepEqual(agents, []);
    } finally {
      console.warn = original;
    }

    assert.ok(
      warnings.some((w) => w.includes('capability "post_merge_watch"') && w.includes("command")),
      `warning names the canonical key: ${warnings.join(" | ")}`,
    );
  });

  it("keeps the all-tools sentinel as the resolved tool list", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "guppi", {
      frontmatter: { name: "agent-cortex:guppi", description: "Collaborator" },
      tools: ["*"],
    });

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);

    assert.equal(agents.length, 1);
    // "*" is not a tool name, so it must not be translated, sorted among names
    // or normalised to DEFAULT_TOOLS: activation resolves it against the
    // session's real tool set (the index.test.ts activation case).
    assert.deepEqual(agents[0].tools, ["*"]);
  });

  it("normalises a whitespace-padded all-tools sentinel to the sentinel", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "guppi", {
      frontmatter: { name: "agent-cortex:guppi", description: "Collaborator" },
      tools: ["* "],
    });

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);

    assert.equal(agents.length, 1);
    // Padding carries no meaning in a YAML scalar, and the installers trim the
    // same authored value before they compare, so the padded form must not
    // survive as a tool name: it resolves to the sentinel at activation.
    assert.deepEqual(agents[0].tools, ["*"]);
  });

  it("uses the built-in fallback map when token-map.json is unavailable", () => {
    const fx = track(makeFixture());
    writeComposableAgent(fx, "legacy", {
      frontmatter: {
        name: "agent-cortex:legacy",
        description: "No token map",
      },
      tools: ["view", "glob", "ask_user"],
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
  it("reads a space-separated scalar tools list instead of falling back to defaults", () => {
    const fx = track(makeFixture());
    writeFlatAgent(fx, "ralph", FLAT_FRONTMATTER("ralph", '"bash read grep task"'));

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);

    // A collapsed scalar would land on DEFAULT_TOOLS, lifting the restriction
    // rather than applying it — the tool names must survive the parse.
    assert.deepEqual(agents[0].tools, ["bash", "grep", "read", "task"]);
  });

  it("reads a comma-separated scalar tools list", () => {
    const fx = track(makeFixture());
    writeFlatAgent(fx, "ralph", FLAT_FRONTMATTER("ralph", '"bash, view, task"'));

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);

    assert.deepEqual(agents[0].tools, ["bash", "read", "task"]);
  });

  it("reads an absent tools key as every tool, because the installers omit the line for it", () => {
    const fx = track(makeFixture());
    // A staged pi package's render for a ["*"] agent: no tools line at all.
    writeFlatAgent(fx, "guppi", '---\nname: "agent-cortex:guppi"\ndescription: "Collaborator"\n---\n\nFlat body.');

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);

    assert.equal(agents.length, 1);
    assert.deepEqual(agents[0].tools, ["*"]);
  });

  it("keeps DEFAULT_TOOLS when a flat agent's frontmatter cannot be parsed", () => {
    const fx = track(makeFixture());
    // No opening delimiter, so no frontmatter can be read: a corrupt file must
    // not be mistaken for "no tools key" and must never grant every tool.
    writeFlatAgent(fx, "legacy", "# legacy\n\nBody with no frontmatter.\n");

    const agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);

    assert.equal(agents.length, 1);
    assert.deepEqual(agents[0].tools, DEFAULT_TOOLS);
  });

  it("skips only the flat agent whose tool list names a command, and warns about it", () => {
    const fx = track(makeFixture());
    // The post-merge-watch extension registers a CLI flag on pi, so the map
    // binds post_merge_watch to a command. Binding one in a tool list is a
    // defect in that one file.
    writeFlatAgent(fx, "broken", FLAT_FRONTMATTER("broken", '["bash", "post_merge_watch"]'));
    writeFlatAgent(fx, "strategy", FLAT_FRONTMATTER("strategy", '["bash", "view"]'));

    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));
    let agents: AgentDef[];
    try {
      agents = discoverAgents(fx.agentsDir, REAL_TOKEN_MAP);
    } finally {
      console.warn = original;
    }

    // The flat path is the production read path, and discoverAgents is called
    // unguarded from the extension factory: throwing here takes down the whole
    // session, so the offending agent is skipped and the sound one survives.
    assert.deepEqual(
      agents.map((a) => a.id),
      ["strategy"],
    );
    assert.deepEqual(agents[0].tools, ["bash", "read"]);

    assert.ok(
      warnings.some(
        (w) => w.includes('Skipping agent "broken"') && w.includes('capability "post_merge_watch"'),
      ),
      `warning names the skipped agent and the canonical key: ${warnings.join(" | ")}`,
    );
  });
});

// ─── loadTokenMap ────────────────────────────────────────────────────────────

describe("loadTokenMap", () => {
  it("reads the real token-map.json at the package root", () => {
    assert.ok(REAL_TOKEN_MAP);
    assert.equal(typeof REAL_TOKEN_MAP?.capabilities?.bash?.pi?.name, "string");
    // ask_user → ask_questions (pi's native structured-questions tool); skill → read.
    assert.equal(REAL_TOKEN_MAP?.capabilities?.ask_user?.pi?.name, "ask_questions");
    assert.equal(REAL_TOKEN_MAP?.capabilities?.skill?.pi?.name, "read");
    assert.ok(REAL_TOKEN_MAP?.paths?.agents_dir);
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}