import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { installPi } from "../bin/installers/pi.mjs";

// Real repo root — used by the integration smoke test to prove the installer
// works against the canonical sources (agents/, skills/, token-map.json).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TOOL_MAP = {
  bash: { pi: "bash" },
  view: { pi: "read" },
  create: { pi: "write" },
  glob: { pi: "find" },
  ask_user: { pi: null },
  skill: { pi: null },
  task: { pi: "task" },
};

function tokenMap(extra = {}) {
  return {
    name: "fixture token map",
    version: 1,
    harnesses: ["pi"],
    tools: { ...TOOL_MAP },
    paths: {
      plugin_root: { pi: "~/.pi/agent/npm/node_modules/@jaybeeuu/agent-cortex" },
      skills_dir: { pi: { base: "plugin_root", relative: "skills" } },
      agents_dir: { pi: { base: "plugin_root", relative: "agents" } },
    },
    ...extra,
  };
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-installer-"));
  const output = join(root, "out");
  return {
    root,
    output,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeFixture(fx, relPath, content) {
  const p = join(fx.root, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** Seed a minimal but realistic package tree (agents + token-map + skills). */
function seedPackage(fx, opts = {}) {
  const { agents = {}, skills = {}, tokenMap: map, version } = opts;
  writeFixture(fx, "token-map.json", JSON.stringify(map ?? tokenMap(version ? { version } : {})));
  for (const [name, def] of Object.entries(agents)) {
    writeFixture(fx, `agents/${name}/agent.md`, def.body ?? `# ${name}\nBody of ${name}.`);
    writeFixture(
      fx,
      `agents/${name}/pi/frontmatter.json`,
      JSON.stringify(
        def.frontmatter ?? {
          name: `agent-cortex:${name}`,
          description: `Description of ${name}`,
          tools: ["bash", "view"],
          argumentHint: `Hint for ${name}`,
        },
      ),
    );
    for (const [section, content] of Object.entries(def.sections ?? {})) {
      writeFixture(fx, `agents/${name}/pi/${section}.md`, content);
    }
  }
  for (const [path, content] of Object.entries(skills)) {
    writeFixture(fx, `skills/${path}`, content);
  }
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p).map((f) => join(entry.name, f)));
    else out.push(entry.name);
  }
  return out;
}

// ─── Agent composition ───────────────────────────────────────────────────────

describe("installPi — agent composition", () => {
  it("writes one .agent.md per composable agent dir with pi frontmatter and no leftover tokens", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, {
        agents: {
          alpha: {
            body: "# alpha\nUse {{TOOL:view}} to read.\n{{SECTION:polling}}\nRead {{PATH:skills_dir}}.",
            sections: { polling: "Spawn with {{TOOL:task}}." },
            frontmatter: {
              name: "agent-cortex:alpha",
              description: "Reads things.",
              tools: ["bash", "view", "glob", "ask_user"],
              argumentHint: "Read something",
            },
          },
        },
      });

      const result = installPi({ root: fx.root, output: fx.output });

      const file = join(fx.output, "agents", "alpha.agent.md");
      assert.ok(existsSync(file), "agent file written");
      const content = readFileSync(file, "utf-8");
      assert.ok(content.startsWith("---\n"), "yaml frontmatter");
      assert.match(content, /name: "agent-cortex:alpha"/);
      assert.match(content, /description: "Reads things\."/);
      assert.match(content, /tools: "bash read find"/, "tools translated to pi names, ask_user omitted");
      assert.match(content, /argument-hint: "Read something"/);
      assert.ok(content.includes("Use read to read."), "{{TOOL:view}} substituted");
      assert.ok(content.includes("Spawn with task."), "{{SECTION:polling}} composed from pi/polling.md");
      assert.ok(!/{{/.test(content), "no literal tokens remain");
      assert.equal(result.agents.length, 1);
      assert.deepEqual(result.agents[0], { name: "alpha", filePath: file });
    } finally {
      fx.cleanup();
    }
  });

  it("drops null-mapped tool tokens in prose and reports a warning", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, {
        agents: {
          alpha: { body: "# alpha\nAsk the user with {{TOOL:ask_user}}, then use {{TOOL:bash}}." },
        },
      });

      const result = installPi({ root: fx.root, output: fx.output });
      const content = readFileSync(join(fx.output, "agents", "alpha.agent.md"), "utf-8");

      assert.ok(!content.includes("ask_user"), "null-mapped token dropped from prose");
      assert.ok(content.includes("use bash"), "mapped token substituted");
      assert.ok(!/{{/.test(content));
      assert.ok(result.warnings.some((w) => w.includes("{{TOOL:ask_user}}")), "drop reported as warning");
    } finally {
      fx.cleanup();
    }
  });

  it("throws on an unknown tool token", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, { agents: { alpha: { body: "# alpha\nUse {{TOOL:nope}} now." } } });
      assert.throws(() => installPi({ root: fx.root, output: fx.output }), /unknown tool token {{TOOL:nope}}/);
    } finally {
      fx.cleanup();
    }
  });

  it("throws when a section file referenced by {{SECTION:...}} is missing", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, { agents: { alpha: { body: "# alpha\n{{SECTION:missing}}" } } });
      assert.throws(() => installPi({ root: fx.root, output: fx.output }), /missing section "missing"/);
    } finally {
      fx.cleanup();
    }
  });

  it("resolves named and relative {{PATH:...}} tokens against the plugin root", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, {
        agents: {
          alpha: {
            body: "# alpha\nNamed: {{PATH:skills_dir}}\nRelative: {{PATH:skills/x/SKILL.md}}",
          },
        },
      });

      const result = installPi({ root: fx.root, output: fx.output });
      const content = readFileSync(join(fx.output, "agents", "alpha.agent.md"), "utf-8");

      assert.ok(
        content.includes("Named: ~/.pi/agent/npm/node_modules/@jaybeeuu/agent-cortex/skills"),
        "named path resolves through token-map paths table",
      );
      assert.ok(
        content.includes("Relative: ~/.pi/agent/npm/node_modules/@jaybeeuu/agent-cortex/skills/x/SKILL.md"),
        "relative path resolves against plugin root",
      );
      assert.equal(result.warnings.length, 0);
    } finally {
      fx.cleanup();
    }
  });

  it("honours the --plugin-root override for path resolution", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, {
        agents: {
          alpha: { body: "# alpha\n{{PATH:skills/x/SKILL.md}}" },
        },
      });

      const pluginRoot = join(fx.root, "checkout");
      installPi({ root: fx.root, output: fx.output, pluginRoot });
      const content = readFileSync(join(fx.output, "agents", "alpha.agent.md"), "utf-8");
      assert.ok(content.includes(join(pluginRoot, "skills", "x", "SKILL.md")), "plugin root override used");
    } finally {
      fx.cleanup();
    }
  });

  it("rejects token-map.json versions newer than the implemented contract", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, {
        version: 99,
        agents: { alpha: { body: "# alpha" } },
      });
      assert.throws(() => installPi({ root: fx.root, output: fx.output }), /version 99/);
    } finally {
      fx.cleanup();
    }
  });
});

// ─── Skills ──────────────────────────────────────────────────────────────────

describe("installPi — skills", () => {
  it("copies skills into <output>/skills preserving the grouped layout with substituted tokens", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: {
          "engineering/echo/SKILL.md":
            "---\nname: echo\ndescription: Echoes {{TOOL:view}}.\n---\n\nUse {{TOOL:view}} to read and {{TOOL:skill}} for help.\nOpen {{PATH:skills/echo/SKILL.md}}.",
          "engineering/echo/scripts/run.sh": "#!/bin/sh\necho hi\n",
        },
      });

      installPi({ root: fx.root, output: fx.output });

      const skillFile = join(fx.output, "skills", "engineering", "echo", "SKILL.md");
      assert.ok(existsSync(skillFile), "skill copied");
      const content = readFileSync(skillFile, "utf-8");
      assert.ok(content.includes("description: Echoes read."), "token substituted in skill frontmatter");
      assert.ok(content.includes("Use read to read and  for help."), "null-mapped {{TOOL:skill}} dropped");
      assert.ok(
        content.includes(
          "Open ~/.pi/agent/npm/node_modules/@jaybeeuu/agent-cortex/skills/echo/SKILL.md.",
        ),
        "relative path resolved against plugin root",
      );
      assert.ok(!/{{/.test(content), "no literal tokens remain in skill");

      const script = readFileSync(join(fx.output, "skills", "engineering", "echo", "scripts", "run.sh"), "utf-8");
      assert.equal(script, "#!/bin/sh\necho hi\n", "non-md files copied verbatim");
    } finally {
      fx.cleanup();
    }
  });
});

// ─── Output / dry-run ────────────────────────────────────────────────────────

describe("installPi — output & dry-run", () => {
  it("dry-run writes nothing but reports the planned output", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: { "engineering/echo/SKILL.md": "---\nname: echo\ndescription: d\n---\n\nBody." },
      });

      const result = installPi({ root: fx.root, output: fx.output, dryRun: true });

      assert.equal(result.dryRun, true);
      assert.equal(listFiles(fx.output).length, 0, "no files written in dry-run");
      assert.equal(result.agents.length, 1);
      assert.equal(result.agents[0].name, "alpha");
      assert.equal(result.skills.skills, 1);
      // Planned paths are still reported so the user can see what would happen.
      assert.ok(result.agents[0].filePath.startsWith(fx.output));
    } finally {
      fx.cleanup();
    }
  });

  it("creates the output directory hierarchy when needed", () => {
    const fx = makeFixture();
    try {
      seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      const deep = join(fx.output, "nested", "deep");
      installPi({ root: fx.root, output: deep });
      assert.ok(existsSync(join(deep, "agents", "alpha.agent.md")));
    } finally {
      fx.cleanup();
    }
  });
});

// ─── Integration against the real repo ───────────────────────────────────────

describe("installPi — real repo integration", () => {
  it("installs every canonical agent with pi tool names and no leftover tokens", () => {
    const fx = makeFixture();
    try {
      const result = installPi({ root: REPO_ROOT, output: fx.output });

      const names = result.agents.map((a) => a.name).sort();
      assert.deepEqual(names, ["plan", "ralph", "ralph-plan", "strategy"]);

      // ralph pi frontmatter: ["bash", "view", "rg", "glob", "task", "read_agent"]
      const ralph = readFileSync(join(fx.output, "agents", "ralph.agent.md"), "utf-8");
      assert.match(ralph, /name: "agent-cortex:ralph"/);
      assert.match(ralph, /tools: "bash read grep find task read_agent"/);
      assert.ok(ralph.includes("## Spawning subagents (PI)"), "{{SECTION:polling}} composed from pi/polling.md");
      const bodyTokens = ralph.split("---\n").slice(2).join("---\n");
      assert.ok(!/{{/.test(bodyTokens), "no literal tokens in ralph body");

      // plan body carries the relative {{PATH:...}} resolved against the plugin root
      const plan = readFileSync(join(fx.output, "agents", "plan.agent.md"), "utf-8");
      assert.match(plan, /tools: "bash read edit write grep find task read_agent"/);
      assert.ok(
        plan.includes("~/.pi/agent/npm/node_modules/@jaybeeuu/agent-cortex/skills/workflow/plan/SKILL.md"),
        "plan PATH token resolved against token-map plugin root",
      );

      // ralph-plan prose {{TOOL:ask_user}} is dropped (null for pi)
      const ralphPlan = readFileSync(join(fx.output, "agents", "ralph-plan.agent.md"), "utf-8");
      assert.ok(!ralphPlan.includes("ask_user"), "null-mapped tool omitted from ralph-plan body");
      assert.ok(
        result.warnings.some((w) => w.includes("ask_user")),
        "ralph-plan null tool dropped with a warning",
      );

      // strategy: web_fetch → fetch_content; ask_user/skill omitted
      const strategy = readFileSync(join(fx.output, "agents", "strategy.agent.md"), "utf-8");
      assert.match(strategy, /tools: "bash read grep find fetch_content edit write"/);
    } finally {
      fx.cleanup();
    }
  });

  it("substitutes tokens in every installed skill markdown", () => {
    const fx = makeFixture();
    try {
      const result = installPi({ root: REPO_ROOT, output: fx.output });
      assert.ok(result.skills.skills > 20, `expected the full skill tree, got ${result.skills.skills}`);

      const files = listFiles(join(fx.output, "skills")).filter((f) => f.endsWith(".md"));
      assert.ok(files.length > 0);
      for (const f of files) {
        const content = readFileSync(join(fx.output, "skills", f), "utf-8");
        assert.ok(!/{{/.test(content), `no literal tokens in skill ${f}`);
      }
    } finally {
      fx.cleanup();
    }
  });
});