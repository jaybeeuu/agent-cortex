// Integration tests for `agent-cortex install copilot`: the install-time
// generator for the Copilot CLI flat agent files (agents/*.agent.md). All tests
// install into mkdtemp dirs so the real repo agents/ is never touched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { installCopilot } from "../bin/installers/copilot.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI_PATH = join(ROOT, "bin", "agent-cortex.mjs");

/** True when a path exists (stat succeeds). */
async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

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

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "copilot-installer-"));
  return {
    root,
    output: join(root, "generated"),
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

async function writeFixture(fx, relPath, content) {
  const p = join(fx.root, relPath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
}

/** Seed a minimal but realistic package tree (agents + token-map). */
async function seedCopilotPackage(fx, opts = {}) {
  const { agents = {} } = opts;
  await writeFixture(fx, "token-map.json", JSON.stringify(tokenMap()));
  for (const [name, def] of Object.entries(agents)) {
    await writeFixture(fx, `agents/${name}/agent.md`, def.body ?? `# ${name}\nBody of ${name}.`);
    await writeFixture(
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
      await writeFixture(fx, `agents/${name}/copilot/${section}.md`, content);
    }
  }
}

/** Deterministic snapshot of a directory: relative paths + byte content. */
async function snapshot(dir) {
  const entries = [];
  const walk = async (p) => {
    for (const e of (await readdir(p, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(p, e.name);
      if (e.isDirectory()) {
        entries.push([e.name, "dir"]);
        await walk(full);
      } else entries.push([e.name, "file", await readFile(full, "utf-8")]);
    }
  };
  await walk(dir);
  return entries;
}

// ─── Agent composition ───────────────────────────────────────────────────────

describe("installCopilot — agent composition", () => {
  it("writes one flat <name>.agent.md per composable agent dir with copilot frontmatter and no leftover tokens", async () => {
    const fx = await makeFixture();
    try {
      await seedCopilotPackage(fx, {
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

      const result = await installCopilot({ root: fx.root, output: fx.output });

      const file = join(fx.output, "alpha.agent.md");
      assert.ok(await pathExists(file), "flat agent file written");
      const content = await readFile(file, "utf-8");
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
      await fx.cleanup();
    }
  });

  it("skips non-composable entries in agents/ and never clobbers composable sources", async () => {
    const fx = await makeFixture();
    try {
      await seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await writeFixture(fx, "agents/README.md", "# agents dir docs\n");

      const result = await installCopilot({ root: fx.root, output: fx.output });

      assert.deepEqual((await readdir(fx.output)).sort(), ["alpha.agent.md"], "no README, no subdirectories written");
      assert.deepEqual(result.agents, ["alpha"]);
      // The composable source dir next to the generated file stays untouched.
      assert.ok(await pathExists(join(fx.root, "agents", "alpha", "agent.md")), "composable source preserved");
      assert.ok(await pathExists(join(fx.root, "agents", "alpha", "copilot", "frontmatter.json")), "harness dir preserved");
    } finally {
      await fx.cleanup();
    }
  });

  it("throws when a composable dir lacks copilot/frontmatter.json", async () => {
    const fx = await makeFixture();
    try {
      await seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await rm(join(fx.root, "agents", "alpha", "copilot"), { recursive: true, force: true });
      await assert.rejects(
        installCopilot({ root: fx.root, output: fx.output }),
        /without copilot\/frontmatter\.json/,
      );
    } finally {
      await fx.cleanup();
    }
  });

  it("defaults to the plugin-scanned agents/ dir of the package root (plugin.json \"agents\": \"agents/\")", async () => {
    const fx = await makeFixture();
    try {
      await seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      const result = await installCopilot({ root: fx.root });

      assert.equal(result.output, join(fx.root, "agents"), "default output is the dir plugin.json scans");
      assert.ok(await pathExists(join(fx.root, "agents", "alpha.agent.md")), "flat file lands next to the composable dir");
      assert.ok(await pathExists(join(fx.root, "agents", "alpha", "agent.md")), "composable source untouched");
    } finally {
      await fx.cleanup();
    }
  });

  it("throws on an unknown tool token", async () => {
    const fx = await makeFixture();
    try {
      await seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha\nUse {{TOOL:nope}} now." } } });
      await assert.rejects(installCopilot({ root: fx.root, output: fx.output }), /unknown tool token {{TOOL:nope}}/);
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Output / dry-run ────────────────────────────────────────────────────────

describe("installCopilot — output & dry-run", () => {
  it("dry-run reports the plan without writing anything", async () => {
    const fx = await makeFixture();
    try {
      await seedCopilotPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      const result = await installCopilot({ root: fx.root, output: fx.output, dryRun: true });

      assert.equal(result.dryRun, true);
      assert.equal(await pathExists(fx.output), false, "no output dir created in dry-run");
      assert.deepEqual(result.agents, ["alpha"], "planned files still reported");
    } finally {
      await fx.cleanup();
    }
  });

  it("is deterministic across repeated installs into the same output", async () => {
    const fx = await makeFixture();
    try {
      await seedCopilotPackage(fx, {
        agents: {
          alpha: { body: "# alpha\n{{SECTION:polling}}", sections: { polling: "Poll with {{TOOL:task}}." } },
          beta: { body: "# beta" },
        },
      });

      await installCopilot({ root: fx.root, output: fx.output });
      const first = await snapshot(fx.output);
      await installCopilot({ root: fx.root, output: fx.output });
      assert.deepEqual(await snapshot(fx.output), first);
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Integration against the real repo ───────────────────────────────────────

describe("installCopilot — real repo integration", () => {
  it("regenerates byte-identical copies of the committed agents/*.agent.md files", async () => {
    const fx = await makeFixture();
    try {
      const result = await installCopilot({ root: ROOT, output: fx.output });

      assert.deepEqual(result.agents.sort(), ["plan", "ralph", "ralph-plan", "strategy"]);
      for (const name of result.agents) {
        const generated = await readFile(join(fx.output, `${name}.agent.md`), "utf-8");
        const committed = await readFile(join(ROOT, "agents", `${name}.agent.md`), "utf-8");
        assert.equal(generated, committed, `${name}.agent.md must match the committed flat file (CI drift check)`);
      }
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── CLI wiring ──────────────────────────────────────────────────────────────

describe("CLI integration", () => {
  it("exits 0 for install copilot --output <tmp> and writes the flat files", async () => {
    const fx = await makeFixture();
    try {
      const { exitCode, stdout } = await runCli(["install", "copilot", "--output", fx.output]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes("copilot"), "prints the harness name");
      assert.ok(stdout.includes("Generated"), "prints the generation summary");
      assert.ok(await pathExists(join(fx.output, "ralph.agent.md")), "agent files written");
      assert.ok(await pathExists(join(fx.output, "plan.agent.md")));
    } finally {
      await fx.cleanup();
    }
  });

  it("exits 0 for install copilot --dry-run and writes nothing", async () => {
    const fx = await makeFixture();
    try {
      const { exitCode, stdout } = await runCli(["install", "copilot", "--output", fx.output, "--dry-run"]);
      assert.equal(exitCode, 0);
      assert.ok(/dry-run/i.test(stdout));
      assert.equal(await pathExists(fx.output), false, "no files written in dry-run");
    } finally {
      await fx.cleanup();
    }
  });

  it("exits 0 for install copilot (default output) without touching committed files", async () => {
    const before = await readFile(join(ROOT, "agents", "ralph.agent.md"), "utf-8");
    const { exitCode } = await runCli(["install", "copilot"]);
    assert.equal(exitCode, 0);
    // Default output regenerates the shared agents/ dir in place — output must
    // stay byte-identical to what is committed.
    assert.equal(await readFile(join(ROOT, "agents", "ralph.agent.md"), "utf-8"), before);
  });
});