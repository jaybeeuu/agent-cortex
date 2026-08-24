// Integration tests for `agent-cortex install copilot`: the install-time
// generator for the Copilot CLI flat agent files (agents/*.agent.md). All tests
// install into mkdtemp dirs so the real repo agents/ is never touched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { installCopilot } from "../bin/installers/copilot.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PATH = join(ROOT, "bin", "agent-cortex.mjs");

function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], (error, stdout, stderr) => {
      resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr });
    });
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function tokenMap() {
  return {
    name: "fixture token map",
    version: 1,
    harnesses: ["copilot"],
    tools: {
      bash: { copilot: "bash" },
      view: { copilot: "view" },
      task: { copilot: "task" },
      ask_user: { copilot: "ask_user" },
    },
    paths: {
      plugin_root: { copilot: "~/.copilot/installed-plugins/_direct/agent-cortex" },
      agents_dir: { copilot: { base: "plugin_root", relative: "agents" } },
    },
  };
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "copilot-installer-"));
  return {
    root,
    output: join(root, "generated"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeFixture(fx, relPath, content) {
  const p = join(fx.root, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** Seed a minimal but realistic package tree (agents + token-map). */
function seedCopilotPackage(fx, opts = {}) {
  const { agents = {} } = opts;
  writeFixture(fx, "token-map.json", JSON.stringify(tokenMap()));
  for (const [name, def] of Object.entries(agents)) {
    writeFixture(fx, `agents/${name}/agent.md`, def.body ?? `# ${name}\nBody of ${name}.`);
    writeFixture(
      fx,
      `agents/${name}/copilot/frontmatter.json`,
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
      writeFixture(fx, `agents/${name}/copilot/${section}.md`, content);
    }
  }
}

/** Deterministic snapshot of a directory: relative paths + byte content. */
function snapshot(dir) {
  const entries = [];
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(p, e.name);
      if (e.isDirectory()) {
        entries.push([e.name, "dir"]);
        walk(full);
      } else entries.push([e.name, "file", readFileSync(full, "utf-8")]);
    }
  };
  walk(dir);
  return entries;
}

// ─── Agent composition ───────────────────────────────────────────────────────

describe("installCopilot — agent composition", () => {
  it("writes one flat <name>.agent.md per composable agent dir with copilot frontmatter and no leftover tokens", () => {
    const fx = makeFixture();
    try {
      seedCopilotPackage(fx, {
        agents: {
          alpha: {
            body: "# alpha\nUse {{TOOL:view}} to read.\n{{SECTION:polling}}\nRead {{PATH:agents_dir}}.",
            sections: { polling: "Spawn with {{TOOL:task}}." },
            frontmatter: {
              name: "agent-cortex:alpha",
              description: "Reads things.",
              tools: ["bash", "view"],
              argumentHint: "Read something",
            },
          },
        },
      });

      const result = installCopilot({ root: fx.root, output: fx.output });

      const file = join(fx.output, "alpha.agent.md");
      assert.ok(existsSync(file), "flat agent file written");
      const content = readFileSync(file, "utf-8");
      assert.ok(content.startsWith("---\n"), "yaml frontmatter");
      assert.ok(content.includes("# GENERATED from agents/alpha/ by scripts/build-copilot-agents.mjs — DO NOT EDIT."));
      // Committed flat-file field order: description, name, tools (YAML array), argument-hint.
      const order = ["description:", "name: \"agent-cortex:alpha\"", "tools: [", "argument-hint:"].map((s) => content.indexOf(s));
      assert.ok(order.every((i) => i !== -1), "all frontmatter fields present");
      assert.deepEqual([...order].sort((a, b) => a - b), order, "frontmatter fields in committed order");
      assert.match(content, /tools: \["bash", "view"\]/, "copilot tools kept as a YAML array (no translation)");
      assert.ok(content.includes("Use view to read."), "{{TOOL:view}} substituted");
      assert.ok(content.includes("Spawn with task."), "{{SECTION:polling}} composed from copilot/polling.md");
      assert.ok(!/{{/.test(content), "no literal tokens remain");
      assert.equal(result.agents.length, 1);
      assert.deepEqual(result.agents, ["alpha"]);
      assert.equal(result.output, fx.output);
    } finally {
      fx.cleanup();
    }
  });

  it("skips non-composable entries in agents/ and never clobbers composable sources", () => {
    const fx = makeFixture();
    try {
      seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      writeFixture(fx, "agents/README.md", "# agents dir docs\n");

      const result = installCopilot({ root: fx.root, output: fx.output });

      assert.deepEqual(readdirSync(fx.output).sort(), ["alpha.agent.md"], "no README, no subdirectories written");
      assert.deepEqual(result.agents, ["alpha"]);
      // The composable source dir next to the generated file stays untouched.
      assert.ok(existsSync(join(fx.root, "agents", "alpha", "agent.md")), "composable source preserved");
      assert.ok(existsSync(join(fx.root, "agents", "alpha", "copilot", "frontmatter.json")), "harness dir preserved");
    } finally {
      fx.cleanup();
    }
  });

  it("throws when a composable dir lacks copilot/frontmatter.json", () => {
    const fx = makeFixture();
    try {
      seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      rmSync(join(fx.root, "agents", "alpha", "copilot"), { recursive: true, force: true });
      assert.throws(
        () => installCopilot({ root: fx.root, output: fx.output }),
        /without copilot\/frontmatter\.json/,
      );
    } finally {
      fx.cleanup();
    }
  });

  it("defaults to the plugin-scanned agents/ dir of the package root (plugin.json \"agents\": \"agents/\")", () => {
    const fx = makeFixture();
    try {
      seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      const result = installCopilot({ root: fx.root });

      assert.equal(result.output, join(fx.root, "agents"), "default output is the dir plugin.json scans");
      assert.ok(existsSync(join(fx.root, "agents", "alpha.agent.md")), "flat file lands next to the composable dir");
      assert.ok(existsSync(join(fx.root, "agents", "alpha", "agent.md")), "composable source untouched");
    } finally {
      fx.cleanup();
    }
  });

  it("throws on an unknown tool token", () => {
    const fx = makeFixture();
    try {
      seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha\nUse {{TOOL:nope}} now." } } });
      assert.throws(() => installCopilot({ root: fx.root, output: fx.output }), /unknown tool token {{TOOL:nope}}/);
    } finally {
      fx.cleanup();
    }
  });
});

// ─── Output / dry-run ────────────────────────────────────────────────────────

describe("installCopilot — output & dry-run", () => {
  it("dry-run reports the plan without writing anything", () => {
    const fx = makeFixture();
    try {
      seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      const result = installCopilot({ root: fx.root, output: fx.output, dryRun: true });

      assert.equal(result.dryRun, true);
      assert.equal(existsSync(fx.output), false, "no output dir created in dry-run");
      assert.deepEqual(result.agents, ["alpha"], "planned files still reported");
    } finally {
      fx.cleanup();
    }
  });

  it("is deterministic across repeated installs into the same output", () => {
    const fx = makeFixture();
    try {
      seedCopilotPackage(fx, {
        agents: {
          alpha: { body: "# alpha\n{{SECTION:polling}}", sections: { polling: "Poll with {{TOOL:task}}." } },
          beta: { body: "# beta" },
        },
      });

      installCopilot({ root: fx.root, output: fx.output });
      const first = snapshot(fx.output);
      installCopilot({ root: fx.root, output: fx.output });
      assert.deepEqual(snapshot(fx.output), first);
    } finally {
      fx.cleanup();
    }
  });
});

// ─── Integration against the real repo ───────────────────────────────────────

describe("installCopilot — real repo integration", () => {
  it("regenerates byte-identical copies of the committed agents/*.agent.md files", () => {
    const fx = makeFixture();
    try {
      const result = installCopilot({ root: ROOT, output: fx.output });

      assert.deepEqual(result.agents.sort(), ["plan", "ralph", "ralph-plan", "strategy"]);
      for (const name of result.agents) {
        const generated = readFileSync(join(fx.output, `${name}.agent.md`), "utf-8");
        const committed = readFileSync(join(ROOT, "agents", `${name}.agent.md`), "utf-8");
        assert.equal(generated, committed, `${name}.agent.md must match the committed flat file (CI drift check)`);
      }
    } finally {
      fx.cleanup();
    }
  });
});

// ─── CLI wiring ──────────────────────────────────────────────────────────────

describe("CLI integration", () => {
  it("exits 0 for install copilot --output <tmp> and writes the flat files", async () => {
    const fx = makeFixture();
    try {
      const { exitCode, stdout } = await runCli(["install", "copilot", "--output", fx.output]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes("copilot"), "prints the harness name");
      assert.ok(stdout.includes("Generated"), "prints the generation summary");
      assert.ok(existsSync(join(fx.output, "ralph.agent.md")), "agent files written");
      assert.ok(existsSync(join(fx.output, "plan.agent.md")));
    } finally {
      fx.cleanup();
    }
  });

  it("exits 0 for install copilot --dry-run and writes nothing", async () => {
    const fx = makeFixture();
    try {
      const { exitCode, stdout } = await runCli(["install", "copilot", "--output", fx.output, "--dry-run"]);
      assert.equal(exitCode, 0);
      assert.ok(/dry-run/i.test(stdout));
      assert.equal(existsSync(fx.output), false, "no files written in dry-run");
    } finally {
      fx.cleanup();
    }
  });

  it("exits 0 for install copilot (default output) without touching committed files", async () => {
    const before = readFileSync(join(ROOT, "agents", "ralph.agent.md"), "utf-8");
    const { exitCode } = await runCli(["install", "copilot"]);
    assert.equal(exitCode, 0);
    // Default output regenerates the shared agents/ dir in place — output must
    // stay byte-identical to what is committed.
    assert.equal(readFileSync(join(ROOT, "agents", "ralph.agent.md"), "utf-8"), before);
  });
});