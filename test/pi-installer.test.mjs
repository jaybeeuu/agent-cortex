import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, stat, lstat, symlink } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { installPi } from "../bin/installers/pi.mjs";

const execFileAsync = promisify(execFile);

// Real repo root — used by the integration smoke test to prove the installer
// works against the canonical sources (agents/, skills/, token-map.json).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** True when a path exists (stat succeeds). */
async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

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

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-installer-"));
  const output = join(root, "out");
  return {
    root,
    output,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * A main checkout plus a linked git worktree under .agent-cortex/worktrees/<id> —
 * the layout ralph runs beads in. `root` is the worktree, so fixture writers
 * target it the way a worktree invocation of the installer would.
 */
async function makeWorktreeFixture() {
  const dir = await mkdtemp(join(tmpdir(), "pi-installer-worktree-"));
  const main = join(dir, "repo");
  const worktree = join(main, ".agent-cortex", "worktrees", "agnt-ctx-test");
  const git = (...args) =>
    execFileAsync("git", [
      "-C",
      main,
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=test",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ]);
  await mkdir(main, { recursive: true });
  await git("init", "--quiet");
  await git("commit", "--quiet", "--allow-empty", "-m", "initial");
  await git("worktree", "add", "--quiet", worktree);
  return {
    root: worktree,
    main,
    worktree,
    output: join(dir, "out"),
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  };
}

async function writeFixture(fx, relPath, content) {
  const p = join(fx.root, relPath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
}

/** Template pi settings the fixture package ships (defaults the installer merges). */
function defaultPiSettings() {
  return {
    packages: [{ source: "../../src/agent-cortex", skills: [] }, "npm:pi-web-access@0.10.7"],
    defaultModel: "template/model",
    theme: "dark",
    tinyModel: { model: "template/tiny", maxNameLength: 40 },
  };
}

function defaultPiKeybindings() {
  return { "tui.input.newLine": ["shift+enter"] };
}

/** Seed a minimal but realistic package tree (agents + token-map + skills + pi templates). */
async function seedPackage(fx, opts = {}) {
  const { agents = {}, skills = {}, tokenMap: map, version, packages } = opts;
  await writeFixture(fx, "token-map.json", JSON.stringify(map ?? tokenMap(version ? { version } : {})));
  if (packages) {
    await writeFixture(fx, "package.json", JSON.stringify({ name: "fixture", pi: { packages } }));
  }
  await writeFixture(fx, "pi/settings.json", JSON.stringify(opts.piSettings ?? defaultPiSettings(), null, 2));
  await writeFixture(fx, "pi/keybindings.json", JSON.stringify(opts.piKeybindings ?? defaultPiKeybindings(), null, 2));
  for (const [name, def] of Object.entries(agents)) {
    await writeFixture(fx, `agents/${name}/agent.md`, def.body ?? `# ${name}\nBody of ${name}.`);
    await writeFixture(
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
      await writeFixture(fx, `agents/${name}/pi/${section}.md`, content);
    }
  }
  for (const [path, content] of Object.entries(skills)) {
    await writeFixture(fx, `skills/${path}`, content);
  }
}

async function listFiles(dir) {
  if (!(await pathExists(dir))) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(p)).map((f) => join(entry.name, f)));
    else out.push(entry.name);
  }
  return out;
}

// ─── Agent composition ───────────────────────────────────────────────────────

describe("installPi — agent composition", () => {
  it("writes one .agent.md per composable agent dir with pi frontmatter and no leftover tokens", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
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

      const result = await installPi({ root: fx.root, output: fx.output });

      const file = join(fx.output, "agents", "alpha.agent.md");
      assert.ok(await pathExists(file), "agent file written");
      const content = await readFile(file, "utf-8");
      assert.ok(content.startsWith("---\n"), "yaml frontmatter");
      assert.match(content, /name: "agent-cortex:alpha"/);
      assert.match(content, /description: "Reads things\."/);
      assert.match(content, /tools: "bash, read, find"/, "tools translated to pi names, ask_user omitted");
      assert.match(content, /argument-hint: "Read something"/);
      assert.ok(content.includes("Use read to read."), "{{TOOL:view}} substituted");
      assert.ok(content.includes("Spawn with task."), "{{SECTION:polling}} composed from pi/polling.md");
      assert.ok(!/{{/.test(content), "no literal tokens remain");
      assert.equal(result.agents.length, 1);
      assert.deepEqual(result.agents[0], { name: "alpha", filePath: file });
    } finally {
      await fx.cleanup();
    }
  });

  it("renders the tool list with the separator its consumers split on (round trip)", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: {
          alpha: {
            frontmatter: {
              name: "agent-cortex:alpha",
              description: "Delegates.",
              tools: ["bash", "view", "glob", "task", "read_agent"],
            },
          },
        },
      });

      await installPi({ root: fx.root, output: fx.output });
      const content = await readFile(join(fx.output, "agents", "alpha.agent.md"), "utf-8");

      // pi's parseFrontmatter hands the tools value back as one scalar string.
      const scalar = JSON.parse(content.match(/^tools: (.*)$/m)[1]);
      assert.equal(typeof scalar, "string");

      // extensions/subagent/agents.ts turns that scalar into `pi --tools`, and pi's
      // flag parser splits on commas — so the rendered form must survive a comma
      // split with the tool names intact, or the subagent starts with no tools.
      assert.deepEqual(
        scalar.split(",").map((t) => t.trim()),
        ["bash", "read", "find", "task", "read_agent"],
      );
    } finally {
      await fx.cleanup();
    }
  });

  it("drops null-mapped tool tokens in prose and reports a warning", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: {
          alpha: { body: "# alpha\nAsk the user with {{TOOL:ask_user}}, then use {{TOOL:bash}}." },
        },
      });

      const result = await installPi({ root: fx.root, output: fx.output });
      const content = await readFile(join(fx.output, "agents", "alpha.agent.md"), "utf-8");

      assert.ok(!content.includes("ask_user"), "null-mapped token dropped from prose");
      assert.ok(content.includes("use bash"), "mapped token substituted");
      assert.ok(!/{{/.test(content));
      assert.ok(result.warnings.some((w) => w.includes("{{TOOL:ask_user}}")), "drop reported as warning");
    } finally {
      await fx.cleanup();
    }
  });

  it("throws on an unknown tool token", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha\nUse {{TOOL:nope}} now." } } });
      await assert.rejects(installPi({ root: fx.root, output: fx.output }), /unknown tool token {{TOOL:nope}}/);
    } finally {
      await fx.cleanup();
    }
  });

  it("throws when a section file referenced by {{SECTION:...}} is missing", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha\n{{SECTION:missing}}" } } });
      await assert.rejects(installPi({ root: fx.root, output: fx.output }), /missing section "missing"/);
    } finally {
      await fx.cleanup();
    }
  });

  it("resolves named and relative {{PATH:...}} tokens against the plugin root", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: {
          alpha: {
            body: "# alpha\nNamed: {{PATH:skills_dir}}\nRelative: {{PATH:skills/x/SKILL.md}}",
          },
        },
      });

      const result = await installPi({ root: fx.root, output: fx.output });
      const content = await readFile(join(fx.output, "agents", "alpha.agent.md"), "utf-8");

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
      await fx.cleanup();
    }
  });

  it("honours the --plugin-root override for path resolution", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: {
          alpha: { body: "# alpha\n{{PATH:skills/x/SKILL.md}}" },
        },
      });

      const pluginRoot = join(fx.root, "checkout");
      await installPi({ root: fx.root, output: fx.output, pluginRoot });
      const content = await readFile(join(fx.output, "agents", "alpha.agent.md"), "utf-8");
      assert.ok(content.includes(join(pluginRoot, "skills", "x", "SKILL.md")), "plugin root override used");
    } finally {
      await fx.cleanup();
    }
  });

  it("rejects token-map.json versions newer than the implemented contract", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        version: 99,
        agents: { alpha: { body: "# alpha" } },
      });
      await assert.rejects(installPi({ root: fx.root, output: fx.output }), /version 99/);
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Third-party package provisioning ────────────────────────────────────────

describe("installPi — package provisioning", () => {
  function recordingRunner() {
    const calls = [];
    return {
      calls,
      runInstall: async (source) => {
        calls.push(source);
        return { ok: true, error: null };
      },
    };
  }

  it("does not touch the pi package store unless provisioning is requested", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        packages: ["npm:pi-questions"],
      });
      const { calls, runInstall } = recordingRunner();

      const result = await installPi({ root: fx.root, output: fx.output, runInstall });

      assert.deepEqual(calls, []);
      assert.equal(result.packages, null);
    } finally {
      await fx.cleanup();
    }
  });

  it("installs the packages declared in the package manifest when enabled", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        packages: ["npm:pi-questions", "npm:pi-web-access@0.10.7"],
      });
      const { calls, runInstall } = recordingRunner();

      const result = await installPi({ root: fx.root, output: fx.output, provisionPackages: true, runInstall });

      assert.deepEqual(calls, ["npm:pi-questions", "npm:pi-web-access@0.10.7"]);
      assert.deepEqual(result.packages.installed, ["npm:pi-questions", "npm:pi-web-access@0.10.7"]);
      assert.deepEqual(result.packages.failed, []);
    } finally {
      await fx.cleanup();
    }
  });

  it("dry-run reports the package plan without installing", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        packages: ["npm:pi-questions"],
      });
      const { calls, runInstall } = recordingRunner();

      const result = await installPi({
        root: fx.root,
        output: fx.output,
        provisionPackages: true,
        dryRun: true,
        runInstall,
      });

      assert.deepEqual(calls, []);
      assert.deepEqual(result.packages.planned, ["npm:pi-questions"]);
    } finally {
      await fx.cleanup();
    }
  });

  it("warns but still installs agents when a package install fails", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        packages: ["npm:pi-questions"],
      });

      const result = await installPi({
        root: fx.root,
        output: fx.output,
        provisionPackages: true,
        runInstall: async () => ({ ok: false, error: "offline" }),
      });

      assert.ok(await pathExists(join(fx.output, "agents", "alpha.agent.md")), "agents still installed");
      assert.deepEqual(result.packages.failed, [{ source: "npm:pi-questions", error: "offline" }]);
      assert.ok(result.warnings.some((w) => w.includes("npm:pi-questions")), "failure surfaced as a warning");
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Skills ──────────────────────────────────────────────────────────────────

describe("installPi — skills", () => {
  it("copies skills into <output>/skills preserving the grouped layout with substituted tokens", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: {
          "engineering/echo/SKILL.md":
            "---\nname: echo\ndescription: Echoes {{TOOL:view}}.\n---\n\nUse {{TOOL:view}} to read and {{TOOL:skill}} for help.\nOpen {{PATH:skills/echo/SKILL.md}}.",
          "engineering/echo/scripts/run.sh": "#!/bin/sh\necho hi\n",
        },
      });

      await installPi({ root: fx.root, output: fx.output });

      const skillFile = join(fx.output, "skills", "engineering", "echo", "SKILL.md");
      assert.ok(await pathExists(skillFile), "skill copied");
      const content = await readFile(skillFile, "utf-8");
      assert.ok(content.includes("description: Echoes read."), "token substituted in skill frontmatter");
      assert.ok(content.includes("Use read to read and  for help."), "null-mapped {{TOOL:skill}} dropped");
      assert.ok(
        content.includes(
          "Open ~/.pi/agent/npm/node_modules/@jaybeeuu/agent-cortex/skills/echo/SKILL.md.",
        ),
        "relative path resolved against plugin root",
      );
      assert.ok(!/{{/.test(content), "no literal tokens remain in skill");

      const script = await readFile(join(fx.output, "skills", "engineering", "echo", "scripts", "run.sh"), "utf-8");
      assert.equal(script, "#!/bin/sh\necho hi\n", "non-md files copied verbatim");
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Pruning stale installs ──────────────────────────────────────────────────

/** The marker line every generated pi agent file opens its frontmatter with. */
const GENERATED_AGENT_MARKER = "# GENERATED from agents/";

function generatedAgentFile(name) {
  return ['---', `${GENERATED_AGENT_MARKER}${name}/ by bin/installers/pi.mjs — DO NOT EDIT.`, `name: "agent-cortex:${name}"`, `description: "Description of ${name}"`, 'tools: "bash"', "---", "", `Body of ${name}.`, ""].join(
    "\n",
  );
}

describe("installPi — pruning stale installs", () => {
  it("removes a skill directory the source no longer contains", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: {
          "engineering/echo/SKILL.md": "---\nname: echo\ndescription: d\n---\n\nEcho body.",
          "engineering/doomed/SKILL.md": "---\nname: doomed\ndescription: d\n---\n\nDoomed body.",
        },
      });
      await installPi({ root: fx.root, output: fx.output });

      await rm(join(fx.root, "skills", "engineering", "doomed"), { recursive: true, force: true });
      const result = await installPi({ root: fx.root, output: fx.output });

      assert.equal(
        await pathExists(join(fx.output, "skills", "engineering", "doomed")),
        false,
        "skill directory dropped upstream is gone, empty parent left behind is removed too",
      );
      assert.ok(await pathExists(join(fx.output, "skills", "engineering", "echo", "SKILL.md")), "live skill kept");
      assert.deepEqual(result.pruned.files, [join(fx.output, "skills", "engineering", "doomed", "SKILL.md")]);
    } finally {
      await fx.cleanup();
    }
  });

  it("removes a file dropped from inside a live skill", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: {
          "planning/create-task/SKILL.md": "---\nname: create-task\ndescription: d\n---\n\nBody.",
          "planning/create-task/scripts/pnpm-workspace.yaml": "packages: []\n",
        },
      });
      await installPi({ root: fx.root, output: fx.output });

      await rm(join(fx.root, "skills", "planning", "create-task", "scripts"), { recursive: true, force: true });
      await installPi({ root: fx.root, output: fx.output });

      assert.equal(
        await pathExists(join(fx.output, "skills", "planning", "create-task", "scripts")),
        false,
        "orphaned support file and its directory are gone",
      );
      assert.ok(await pathExists(join(fx.output, "skills", "planning", "create-task", "SKILL.md")), "live skill kept");
    } finally {
      await fx.cleanup();
    }
  });

  it("removes an agent file an earlier install generated but the source dropped", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      // An install from before the ownership manifest existed: the file carries
      // the GENERATED marker but no record of it survives.
      await mkdir(join(fx.output, "agents"), { recursive: true });
      await writeFile(join(fx.output, "agents", "retired.agent.md"), generatedAgentFile("retired"));

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.equal(await pathExists(join(fx.output, "agents", "retired.agent.md")), false, "stale agent pruned");
      assert.deepEqual(result.pruned.files, [join(fx.output, "agents", "retired.agent.md")]);
      assert.ok(await pathExists(join(fx.output, "agents", "alpha.agent.md")), "source agent written");
    } finally {
      await fx.cleanup();
    }
  });

  it("leaves an agent another harness generated untouched", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await mkdir(join(fx.output, "agents"), { recursive: true });
      await writeFile(
        join(fx.output, "agents", "copilot.agent.md"),
        '---\n# GENERATED from agents/copilot/ by scripts/build-copilot-agents.mjs — DO NOT EDIT.\nname: "copilot"\n---\n\nBody.\n',
      );

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.ok(
        await pathExists(join(fx.output, "agents", "copilot.agent.md")),
        "the marker alone is not evidence this installer wrote the file",
      );
      assert.deepEqual(result.pruned, { files: [], dirs: [] });
    } finally {
      await fx.cleanup();
    }
  });

  it("dry-run reports the planned removals without deleting them", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: {
          "engineering/echo/SKILL.md": "---\nname: echo\ndescription: d\n---\n\nEcho body.",
          "engineering/doomed/SKILL.md": "---\nname: doomed\ndescription: d\n---\n\nDoomed body.",
        },
      });
      await installPi({ root: fx.root, output: fx.output });

      await rm(join(fx.root, "skills", "engineering", "doomed"), { recursive: true, force: true });
      const result = await installPi({ root: fx.root, output: fx.output, dryRun: true });

      assert.deepEqual(result.pruned.files, [join(fx.output, "skills", "engineering", "doomed", "SKILL.md")]);
      assert.deepEqual(result.pruned.dirs, [join(fx.output, "skills", "engineering", "doomed")]);
      assert.ok(
        await pathExists(join(fx.output, "skills", "engineering", "doomed", "SKILL.md")),
        "dry-run deletes nothing",
      );
    } finally {
      await fx.cleanup();
    }
  });

  it("leaves skill and agent files it has no ownership evidence for untouched", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: { "engineering/echo/SKILL.md": "---\nname: echo\ndescription: d\n---\n\nEcho body." },
      });
      await installPi({ root: fx.root, output: fx.output });

      // A user-authored skill in the same group as an installed one, and a
      // hand-written agent file (no GENERATED marker).
      await mkdir(join(fx.output, "skills", "engineering", "mine"), { recursive: true });
      await writeFile(join(fx.output, "skills", "engineering", "mine", "SKILL.md"), "---\nname: mine\n---\n\nMine.");
      await writeFile(join(fx.output, "agents", "mine.agent.md"), "---\nname: mine\n---\n\nMine.\n");

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.deepEqual(result.pruned, { files: [], dirs: [] }, "nothing unowned was removed");
      assert.ok(await pathExists(join(fx.output, "skills", "engineering", "mine", "SKILL.md")), "user skill kept");
      assert.ok(await pathExists(join(fx.output, "agents", "mine.agent.md")), "hand-written agent kept");
    } finally {
      await fx.cleanup();
    }
  });

  it("does not delete files through a manifest entry that escapes its tree", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: { "engineering/echo/SKILL.md": "---\nname: echo\ndescription: d\n---\n\nEcho body." },
      });
      await installPi({ root: fx.root, output: fx.output });

      // The record is hand-editable and is the one input that authorises
      // deletion, so a traversal entry must never reach the filesystem.
      const manifestPath = join(fx.output, ".agent-cortex-install.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      await writeFile(
        manifestPath,
        JSON.stringify({ ...manifest, skills: [...manifest.skills, "../victim.txt", "../../victim2.txt"] }),
      );
      await writeFile(join(fx.output, "victim.txt"), "beside the skills tree");
      await writeFile(join(fx.root, "victim2.txt"), "outside the output dir");

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.ok(await pathExists(join(fx.output, "victim.txt")), "entry escaping the skills tree deleted nothing");
      assert.ok(await pathExists(join(fx.root, "victim2.txt")), "entry escaping the output dir deleted nothing");
      assert.deepEqual(result.pruned, { files: [], dirs: [] }, "rejected entries are not reported as removed");
      assert.ok(
        result.warnings.some((warning) => warning.includes("../victim.txt")),
        "the rejected entries are reported",
      );
    } finally {
      await fx.cleanup();
    }
  });

  it("keeps the installed skills when the source yields none", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: { "engineering/echo/SKILL.md": "---\nname: echo\ndescription: d\n---\n\nEcho body." },
      });
      await installPi({ root: fx.root, output: fx.output });

      // A degraded checkout (sparse, mid-flight rename) must not be able to
      // wipe a working install just because it produced nothing this run.
      await rm(join(fx.root, "skills"), { recursive: true, force: true });
      const result = await installPi({ root: fx.root, output: fx.output });

      assert.ok(
        await pathExists(join(fx.output, "skills", "engineering", "echo", "SKILL.md")),
        "installed skill survives a source that ships no skills",
      );
      assert.deepEqual(result.pruned, { files: [], dirs: [] }, "nothing is pruned from the skipped tree");
      assert.ok(
        result.warnings.some((warning) => warning.includes("skills")),
        "the skipped prune is reported",
      );
    } finally {
      await fx.cleanup();
    }
  });

  it("prunes a skill the source drops while it was degraded, once the source recovers", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: {
          "engineering/echo/SKILL.md": "---\nname: echo\ndescription: d\n---\n\nEcho body.",
          "engineering/doomed/SKILL.md": "---\nname: doomed\ndescription: d\n---\n\nDoomed body.",
        },
      });
      await installPi({ root: fx.root, output: fx.output });

      // A degraded checkout keeps the installed copies and records nothing of
      // its own — the record is ownership evidence, so the skip must not erase it.
      await rm(join(fx.root, "skills"), { recursive: true, force: true });
      await installPi({ root: fx.root, output: fx.output });

      // The source recovers, shipping one skill fewer than before the degrade.
      await writeFixture(fx, "skills/engineering/echo/SKILL.md", "---\nname: echo\ndescription: d\n---\n\nEcho body.");
      const result = await installPi({ root: fx.root, output: fx.output });

      assert.equal(
        await pathExists(join(fx.output, "skills", "engineering", "doomed", "SKILL.md")),
        false,
        "a skill dropped upstream is pruned even though a degraded run sat in between",
      );
      assert.deepEqual(result.pruned.files, [join(fx.output, "skills", "engineering", "doomed", "SKILL.md")]);
    } finally {
      await fx.cleanup();
    }
  });

  it("does not delete a copy it just installed through a manifest entry that only differs by normalisation", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: { "g/s/SKILL.md": "---\nname: s\ndescription: d\n---\n\nBody." },
      });
      await installPi({ root: fx.root, output: fx.output });

      // Each entry normalises onto the path this run writes, so trusting one
      // would authorise deleting the copy the source still ships.
      const manifestPath = join(fx.output, ".agent-cortex-install.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      await writeFile(
        manifestPath,
        JSON.stringify({
          ...manifest,
          skills: ["g/./s/SKILL.md", "./g/s/SKILL.md", "g//s/SKILL.md", "g/s/./SKILL.md", "g/s/SKILL.md/"],
        }),
      );

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.ok(await pathExists(join(fx.output, "skills", "g", "s", "SKILL.md")), "the installed copy survives");
      assert.deepEqual(result.pruned, { files: [], dirs: [] }, "a normalisation-only entry authorises no deletion");
    } finally {
      await fx.cleanup();
    }
  });

  it("leaves a directory it did not empty alone", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: {
          "engineering/echo/SKILL.md": "---\nname: echo\ndescription: d\n---\n\nEcho body.",
          "engineering/doomed/SKILL.md": "---\nname: doomed\ndescription: d\n---\n\nDoomed body.",
        },
      });
      await installPi({ root: fx.root, output: fx.output });

      await rm(join(fx.root, "skills", "engineering", "doomed"), { recursive: true, force: true });
      // Empty before the prune ran, and never written by the installer.
      await mkdir(join(fx.output, "skills", "engineering", "user-empty"), { recursive: true });

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.ok(
        await pathExists(join(fx.output, "skills", "engineering", "user-empty")),
        "a directory the prune did not empty is not removed",
      );
      assert.deepEqual(result.pruned.dirs, [join(fx.output, "skills", "engineering", "doomed")]);
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Output / dry-run ────────────────────────────────────────────────────────

describe("installPi — output & dry-run", () => {
  it("dry-run writes nothing but reports the planned output", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        skills: { "engineering/echo/SKILL.md": "---\nname: echo\ndescription: d\n---\n\nBody." },
      });

      const result = await installPi({ root: fx.root, output: fx.output, dryRun: true });

      assert.equal(result.dryRun, true);
      assert.equal((await listFiles(fx.output)).length, 0, "no files written in dry-run");
      assert.equal(result.agents.length, 1);
      assert.equal(result.agents[0].name, "alpha");
      assert.equal(result.skills.skills, 1);
      // Planned paths are still reported so the user can see what would happen.
      assert.ok(result.agents[0].filePath.startsWith(fx.output));
    } finally {
      await fx.cleanup();
    }
  });

  it("creates the output directory hierarchy when needed", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      const deep = join(fx.output, "nested", "deep");
      await installPi({ root: fx.root, output: deep });
      assert.ok(await pathExists(join(deep, "agents", "alpha.agent.md")));
    } finally {
      await fx.cleanup();
    }
  });

  it("installs into a fresh output dir when the source ships no agents and no skills", async () => {
    const fx = await makeFixture();
    try {
      // Nothing creates <output> before the ownership record is written, so the
      // install must not depend on a write having happened first.
      await seedPackage(fx);
      await mkdir(join(fx.root, "agents"), { recursive: true });
      const deep = join(fx.output, "nested", "deep");
      await installPi({ root: fx.root, output: deep });
      assert.ok(await pathExists(join(deep, "settings.json")), "config written into a fresh output dir");
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Pi settings.json ────────────────────────────────────────────────────────

describe("installPi — pi settings.json", () => {
  it("writes a real settings.json with the repo path package and template keys", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      const result = await installPi({ root: fx.root, output: fx.output });

      const settingsPath = join(fx.output, "settings.json");
      assert.equal((await lstat(settingsPath)).isSymbolicLink(), false, "settings.json is a real file");
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));

      const repoEntry = settings.packages.find((p) => !(typeof p === "string" ? p : p.source).startsWith("npm:"));
      assert.deepEqual(repoEntry.skills, [], "repo path package keeps the package filter shape");
      assert.equal(resolve(dirname(settingsPath), repoEntry.source), fx.root, "repo path package resolves to the package root");
      assert.ok(settings.packages.includes("npm:pi-web-access@0.10.7"), "template npm deps preserved");
      assert.equal(settings.defaultModel, "template/model", "template key present");
      assert.match(settings["//"], /GENERATED from pi\/settings\.json/);
      assert.equal(result.settings.action, "written");
    } finally {
      await fx.cleanup();
    }
  });

  it("registers the main checkout instead of the git worktree the installer ran in", async () => {
    const fx = await makeWorktreeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      const result = await installPi({ root: fx.root, output: fx.output });

      const settingsPath = join(fx.output, "settings.json");
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      const repoEntry = settings.packages.find((p) => !(typeof p === "string" ? p : p.source).startsWith("npm:"));
      assert.equal(
        resolve(dirname(settingsPath), repoEntry.source),
        fx.main,
        "package source points at the main checkout, never the ephemeral worktree",
      );
      assert.ok(
        result.warnings.some((w) => w.includes(fx.main)),
        "the worktree invocation is reported, naming the checkout it registered instead",
      );
    } finally {
      await fx.cleanup();
    }
  });

  it("preserves personal values and unknown keys while filling template defaults", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await writeFixture(
        fx,
        "out/settings.json",
        JSON.stringify({
          defaultModel: "personal/model",
          theme: "light",
          personalOnly: { nested: true },
          tinyModel: { model: "personal/tiny" },
        }),
      );

      await installPi({ root: fx.root, output: fx.output });

      const settings = JSON.parse(await readFile(join(fx.output, "settings.json"), "utf-8"));
      assert.equal(settings.defaultModel, "personal/model", "personal value wins over the template default");
      assert.equal(settings.theme, "light", "personal value wins over the template default");
      assert.deepEqual(settings.personalOnly, { nested: true }, "unknown key preserved");
      assert.equal(settings.tinyModel.model, "personal/tiny", "nested personal leaf retained");
      assert.equal(settings.tinyModel.maxNameLength, 40, "nested template default filled in");
      assert.ok(
        settings.packages.some((p) => !(typeof p === "string" ? p : p.source).startsWith("npm:")),
        "packages stays CLI-managed",
      );
    } finally {
      await fx.cleanup();
    }
  });

  it("replaces a legacy symlink with a real managed file", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await mkdir(fx.output, { recursive: true });
      await symlink(join(fx.root, "pi", "settings.json"), join(fx.output, "settings.json"));

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.equal(result.settings.action, "removed-symlink");
      const settingsPath = join(fx.output, "settings.json");
      assert.equal((await lstat(settingsPath)).isSymbolicLink(), false, "symlink replaced by a real file");
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      assert.ok(settings.packages.length > 0, "managed packages written");
    } finally {
      await fx.cleanup();
    }
  });

  it("re-running leaves settings.json unchanged", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await installPi({ root: fx.root, output: fx.output });
      const first = await readFile(join(fx.output, "settings.json"), "utf-8");

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.equal(result.settings.action, "unchanged");
      assert.equal(await readFile(join(fx.output, "settings.json"), "utf-8"), first);
    } finally {
      await fx.cleanup();
    }
  });

  it("dry-run plans the settings write without touching the filesystem", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      const result = await installPi({ root: fx.root, output: fx.output, dryRun: true });

      assert.equal(result.settings.action, "would-write");
      assert.equal(await pathExists(join(fx.output, "settings.json")), false, "no file written in dry-run");
    } finally {
      await fx.cleanup();
    }
  });

  it("dry-run reports would-remove-symlink for a legacy symlink", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await mkdir(fx.output, { recursive: true });
      const link = join(fx.output, "settings.json");
      await symlink(join(fx.root, "pi", "settings.json"), link);

      const result = await installPi({ root: fx.root, output: fx.output, dryRun: true });

      assert.equal(result.settings.action, "would-remove-symlink");
      assert.equal(result.settings.removedSymlink, true);
      assert.equal((await lstat(link)).isSymbolicLink(), true, "symlink untouched in dry-run");
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Pi keybindings.json ─────────────────────────────────────────────────────

describe("installPi — pi keybindings.json", () => {
  it("writes the template bindings as a real generated file", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      const result = await installPi({ root: fx.root, output: fx.output });

      const keybindingsPath = join(fx.output, "keybindings.json");
      assert.equal((await lstat(keybindingsPath)).isSymbolicLink(), false, "keybindings.json is a real file");
      const keybindings = JSON.parse(await readFile(keybindingsPath, "utf-8"));
      assert.deepEqual(keybindings["tui.input.newLine"], ["shift+enter"], "template bindings copied");
      assert.match(keybindings["//"], /GENERATED from pi\/keybindings\.json/);
      assert.equal(result.keybindings.action, "written");
    } finally {
      await fx.cleanup();
    }
  });

  it("leaves a user-modified keybindings file alone", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await writeFixture(
        fx,
        "out/keybindings.json",
        JSON.stringify({ "tui.input.newLine": ["ctrl+j"] }, null, 2),
      );

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.equal(result.keybindings.action, "skipped");
      const keybindings = JSON.parse(await readFile(join(fx.output, "keybindings.json"), "utf-8"));
      assert.deepEqual(keybindings["tui.input.newLine"], ["ctrl+j"], "user edit preserved");
    } finally {
      await fx.cleanup();
    }
  });

  it("refreshes an unmodified install when the template changes", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await installPi({ root: fx.root, output: fx.output });
      await writeFixture(
        fx,
        "pi/keybindings.json",
        JSON.stringify({ "tui.input.newLine": ["ctrl+j"] }, null, 2),
      );

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.equal(result.keybindings.action, "written");
      const keybindings = JSON.parse(await readFile(join(fx.output, "keybindings.json"), "utf-8"));
      assert.deepEqual(keybindings["tui.input.newLine"], ["ctrl+j"], "updated template applied");
    } finally {
      await fx.cleanup();
    }
  });

  it("replaces a legacy symlink with a real file", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await mkdir(fx.output, { recursive: true });
      await symlink(join(fx.root, "pi", "keybindings.json"), join(fx.output, "keybindings.json"));

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.equal(result.keybindings.action, "removed-symlink");
      assert.equal((await lstat(join(fx.output, "keybindings.json"))).isSymbolicLink(), false);
    } finally {
      await fx.cleanup();
    }
  });

  it("re-running leaves keybindings.json unchanged", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await installPi({ root: fx.root, output: fx.output });
      const first = await readFile(join(fx.output, "keybindings.json"), "utf-8");

      const result = await installPi({ root: fx.root, output: fx.output });

      assert.equal(result.keybindings.action, "unchanged");
      assert.equal(await readFile(join(fx.output, "keybindings.json"), "utf-8"), first);
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Integration against the real repo ───────────────────────────────────────

describe("installPi — real repo integration", () => {
  it("installs every canonical agent with pi tool names and no leftover tokens", async () => {
    const fx = await makeFixture();
    try {
      const result = await installPi({ root: REPO_ROOT, output: fx.output });

      const names = result.agents.map((a) => a.name).sort();
      assert.deepEqual(names, ["plan", "ralph", "ralph-plan", "strategy"]);

      // ralph pi frontmatter: ["bash", "view", "rg", "glob", "task", "read_agent", "wait_for_agents"]
      const ralph = await readFile(join(fx.output, "agents", "ralph.agent.md"), "utf-8");
      assert.match(ralph, /name: "agent-cortex:ralph"/);
      assert.match(ralph, /tools: "bash, read, grep, find, task, read_agent, wait_for_agents"/);
      assert.ok(ralph.includes("## Spawning subagents (PI)"), "{{SECTION:polling}} composed from pi/polling.md");
      const bodyTokens = ralph.split("---\n").slice(2).join("---\n");
      assert.ok(!/{{/.test(bodyTokens), "no literal tokens in ralph body");

      // plan body carries the relative {{PATH:...}} resolved against the plugin root.
      // Tool list preserves authoring order (composer translateToolList, unlike the
      // runtime agent-modes translateTools which sorts): ask_user → ask_questions,
      // skill → read (last position).
      const plan = await readFile(join(fx.output, "agents", "plan.agent.md"), "utf-8");
      assert.match(plan, /tools: "bash, read, edit, write, grep, find, ask_questions, task, read_agent, read"/);
      assert.ok(
        plan.includes("~/.pi/agent/npm/node_modules/@jaybeeuu/agent-cortex/skills/workflow/plan/SKILL.md"),
        "plan PATH token resolved against token-map plugin root",
      );

      // ralph-plan prose {{TOOL:ask_user}} now substitutes to ask_questions
      const ralphPlan = await readFile(join(fx.output, "agents", "ralph-plan.agent.md"), "utf-8");
      assert.ok(!ralphPlan.includes("ask_user"), "ask_user never appears in ralph-plan body");
      assert.ok(ralphPlan.includes("ask_questions"), "{{TOOL:ask_user}} substituted to ask_questions");
      assert.ok(
        !result.warnings.some((w) => w.includes("ask_user")),
        "no null-tool warning for ralph-plan (ask_user now maps to ask_questions)",
      );

      // strategy: web_fetch → fetch_content; ask_user → ask_questions; skill → read
      // (authoring order preserved: bash, view→read, rg→grep, glob→find, ask_user→
      // ask_questions, web_fetch→fetch_content, skill→read, edit, create)
      const strategy = await readFile(join(fx.output, "agents", "strategy.agent.md"), "utf-8");
      assert.match(strategy, /tools: "bash, read, grep, find, ask_questions, fetch_content, read, edit, write"/);
    } finally {
      await fx.cleanup();
    }
  });

  it("substitutes tokens in every installed skill markdown", async () => {
    const fx = await makeFixture();
    try {
      const result = await installPi({ root: REPO_ROOT, output: fx.output });
      assert.ok(result.skills.skills > 20, `expected the full skill tree, got ${result.skills.skills}`);

      const files = (await listFiles(join(fx.output, "skills"))).filter((f) => f.endsWith(".md"));
      assert.ok(files.length > 0);
      for (const f of files) {
        const content = await readFile(join(fx.output, "skills", f), "utf-8");
        assert.ok(!/{{/.test(content), `no literal tokens in skill ${f}`);
      }
    } finally {
      await fx.cleanup();
    }
  });
});