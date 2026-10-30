import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, stat, lstat, symlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { installPi } from "../bin/installers/pi.mjs";

// Real repo root — used by the integration smoke test to prove the installer
// works against the canonical sources (agents/, skills/, extensions/, token-map.json).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A throwaway package root plus the staging output below it.
 * @typedef {{ root: string, output: string, cleanup: () => Promise<void> }} PackageFixture */

/** True when a path exists (stat succeeds).
 * @param {string} p
 * @returns {Promise<boolean>} */
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
      plugin_root: { pi: "~/.agent-cortex/pi" },
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

/** Write a fixture file, creating its parent directories.
 * @param {PackageFixture} fx
 * @param {string} relPath
 * @param {string} content
 * @returns {Promise<void>} */
async function writeFixture(fx, relPath, content) {
  const p = join(fx.root, relPath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
}

/** Write the fixture package's own package.json (version + declared runtime dependencies). */
function defaultPackageJson(version = "9.9.9", dependencies = {}) {
  return { name: "fixture-package", version, dependencies };
}

/**
 * Create a fake installed dependency — its own directory plus the package.json
 * the installer reads to decide whether it ships pi resources.
 * @param {string} baseDir
 * @param {{
 *   name: string,
 *   version?: string,
 *   dependencies?: Record<string, string>,
 *   pi?: { extensions?: string[], skills?: string[] },
 *   files?: Record<string, string>,
 * }} options
 * @returns {Promise<string>}
 */
async function createInstalledPackage(baseDir, { name, version = "1.0.0", dependencies = {}, pi, files = {} }) {
  const dir = join(baseDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name, version, dependencies, ...(pi === undefined ? {} : { pi }) }, null, 2),
  );
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  return dir;
}

/** Resolve the fake installed packages by name, recording who asked for them.
 * @param {Record<string, string>} packages  Package name → directory
 * @returns {{
 *   calls: Array<{ name: string, fromDir: string | undefined }>,
 *   resolvePackage: (name: string, fromDir?: string) => Promise<string>,
 * }} */
function fakeResolver(packages) {
  /** @type {Array<{ name: string, fromDir: string | undefined }>} */
  const calls = [];
  return {
    calls,
    resolvePackage: async (name, fromDir) => {
      calls.push({ name, fromDir });
      const dir = packages[name];
      if (dir === undefined) throw new Error(`cannot resolve "${name}"`);
      return dir;
    },
  };
}

/**
 * Seed a minimal but realistic package tree: token-map, package.json, agents,
 * skills, and extensions — the sources the staged package is built from.
 * @param {PackageFixture} fx
 * @param {{
 *   agents?: Record<string, {
 *     body?: string,
 *     frontmatter?: Record<string, unknown>,
 *     sections?: Record<string, string>,
 *   }>,
 *   tokenMap?: Record<string, unknown>,
 *   tokenMapVersion?: number,
 *   packageVersion?: string,
 *   dependencies?: Record<string, string>,
 * }} [opts]
 * @returns {Promise<void>}
 */
async function seedPackage(fx, opts = {}) {
  const { agents = {}, tokenMap: map, tokenMapVersion, packageVersion = "9.9.9", dependencies } = opts;
  await writeFixture(fx, "token-map.json", JSON.stringify(map ?? tokenMap(tokenMapVersion ? { version: tokenMapVersion } : {})));
  await writeFixture(fx, "package.json", JSON.stringify(defaultPackageJson(packageVersion, dependencies), null, 2));
  await writeFixture(fx, "extensions/echo/index.ts", "export default () => {};\n");
  await writeFixture(fx, "skills/engineering/echo/SKILL.md", "---\nname: echo\ndescription: d\n---\n\nBody.\n");
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
}

/** Relative paths of every file below `dir`, empty when it does not exist.
 * @param {string} dir
 * @returns {Promise<string[]>} */
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
            body: "# alpha\nUse {{TOOL:view}} to read.\n{{SECTION:wake}}\nRead {{PATH:skills_dir}}.",
            sections: { wake: "Spawn with {{TOOL:task}}." },
            frontmatter: {
              name: "agent-cortex:alpha",
              description: "Reads things.",
              tools: ["bash", "view", "glob", "ask_user"],
              argumentHint: "Read something",
            },
          },
        },
      });

      const result = await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });

      const file = join(fx.output, "agents", "alpha.agent.md");
      assert.ok(await pathExists(file), "agent file written");
      const content = await readFile(file, "utf-8");
      assert.ok(content.startsWith("---\n"), "yaml frontmatter");
      assert.match(content, /name: "agent-cortex:alpha"/);
      assert.match(content, /description: "Reads things\."/);
      assert.match(content, /tools: "bash, read, find"/, "tools translated to pi names, ask_user omitted");
      assert.match(content, /argument-hint: "Read something"/);
      assert.ok(content.includes("Use read to read."), "{{TOOL:view}} substituted");
      assert.ok(content.includes("Spawn with task."), "{{SECTION:wake}} composed from pi/wake.md");
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

      await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });
      const content = await readFile(join(fx.output, "agents", "alpha.agent.md"), "utf-8");

      // pi's parseFrontmatter hands the tools value back as one scalar string.
      const toolsLine = content.match(/^tools: (.*)$/m);
      assert.ok(toolsLine, "the rendered frontmatter carries a tools line");
      /** @type {string} */
      const scalar = JSON.parse(toolsLine[1]);
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

      const result = await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });
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
      await assert.rejects(
        installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage }),
        /unknown tool token {{TOOL:nope}}/,
      );
    } finally {
      await fx.cleanup();
    }
  });

  it("throws when a section file referenced by {{SECTION:...}} is missing", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha\n{{SECTION:missing}}" } } });
      await assert.rejects(
        installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage }),
        /missing section "missing"/,
      );
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

      const result = await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });
      const content = await readFile(join(fx.output, "agents", "alpha.agent.md"), "utf-8");

      assert.ok(content.includes("Named: ~/.agent-cortex/pi/skills"), "named path resolves through token-map paths table");
      assert.ok(
        content.includes("Relative: ~/.agent-cortex/pi/skills/x/SKILL.md"),
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
      await installPi({
        root: fx.root,
        output: fx.output,
        pluginRoot,
        resolvePackage: fakeResolver({}).resolvePackage,
      });
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
        tokenMapVersion: 99,
        agents: { alpha: { body: "# alpha" } },
      });
      await assert.rejects(
        installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage }),
        /version 99/,
      );
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
      });
      await writeFixture(
        fx,
        "skills/engineering/echo/SKILL.md",
        "---\nname: echo\ndescription: Echoes {{TOOL:view}}.\n---\n\nUse {{TOOL:view}} to read and {{TOOL:skill}} for help.\nOpen {{PATH:skills/echo/SKILL.md}}.",
      );
      await writeFixture(fx, "skills/engineering/echo/scripts/run.sh", "#!/bin/sh\necho hi\n");

      await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });

      const skillFile = join(fx.output, "skills", "engineering", "echo", "SKILL.md");
      assert.ok(await pathExists(skillFile), "skill copied");
      const content = await readFile(skillFile, "utf-8");
      assert.ok(content.includes("description: Echoes read."), "token substituted in skill frontmatter");
      assert.ok(content.includes("Use read to read and  for help."), "null-mapped {{TOOL:skill}} dropped");
      assert.ok(
        content.includes("Open ~/.agent-cortex/pi/skills/echo/SKILL.md."),
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

// ─── Extensions ──────────────────────────────────────────────────────────────

describe("installPi — extensions", () => {
  it("copies the extensions tree into the staged package", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await writeFixture(fx, "extensions/modes/index.ts", "export default () => {};\n");
      await writeFixture(fx, "extensions/auto-name.ts", "export default () => {};\n");

      const result = await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });

      assert.equal(result.extensions.files, 3, "every extension file copied");
      assert.ok(await pathExists(join(fx.output, "extensions", "modes", "index.ts")));
      assert.ok(await pathExists(join(fx.output, "extensions", "auto-name.ts")));
    } finally {
      await fx.cleanup();
    }
  });

  it("never copies node_modules or symlinks out of the extensions tree", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await writeFixture(fx, "extensions/linked/index.ts", "export default () => {};\n");
      await writeFixture(fx, "extensions/linked/node_modules/dep/package.json", "{}\n");
      await symlink(join(fx.root, "extensions", "linked", "index.ts"), join(fx.root, "extensions", "alias.ts"));

      await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });

      assert.equal(await pathExists(join(fx.output, "extensions", "linked", "node_modules")), false);
      assert.equal(await pathExists(join(fx.output, "extensions", "alias.ts")), false);
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Staged package manifest ─────────────────────────────────────────────────

describe("installPi — staged package manifest", () => {
  it("writes a pi package manifest for the staged resources", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      const result = await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });

      const manifest = JSON.parse(await readFile(join(fx.output, "package.json"), "utf-8"));
      assert.deepEqual(manifest.keywords, ["pi-package"]);
      assert.equal(manifest.version, "9.9.9", "version tracks the package being staged");
      assert.deepEqual(manifest.pi, { extensions: ["./extensions"], skills: ["./skills"] });
      assert.match(manifest["//"], /GENERATED by `agent-cortex install pi`/);
      assert.equal(result.manifest.path, join(fx.output, "package.json"));
    } finally {
      await fx.cleanup();
    }
  });

  it("ships token-map.json so the staged agent-modes extension keeps its source of truth", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });

      await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });

      const staged = JSON.parse(await readFile(join(fx.output, "token-map.json"), "utf-8"));
      assert.deepEqual(staged, tokenMap(), "token map copied verbatim");
    } finally {
      await fx.cleanup();
    }
  });

  it("refuses to stage into the package root, where it would clear the sources", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await assert.rejects(
        installPi({ root: fx.root, output: fx.root, resolvePackage: fakeResolver({}).resolvePackage }),
        /refusing to stage/,
      );
      assert.ok(await pathExists(join(fx.root, "agents", "alpha", "agent.md")), "sources untouched");
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Bundled third-party packages ────────────────────────────────────────────

describe("installPi — bundled pi packages", () => {
  it("copies declared pi packages into node_modules and loads their resources from the manifest", async () => {
    const fx = await makeFixture();
    try {
      const installed = join(fx.root, "installed");
      const questions = await createInstalledPackage(installed, {
        name: "pi-questions",
        pi: { extensions: ["./extensions/ask-questions.ts"] },
        files: { "extensions/ask-questions.ts": "export default () => {};\n" },
      });
      const web = await createInstalledPackage(installed, {
        name: "pi-web-access",
        pi: { extensions: ["./index.ts"], skills: ["./skills"] },
        files: { "index.ts": "export default () => {};\n", "skills/web/SKILL.md": "---\nname: web\n---\n" },
      });
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        dependencies: { "pi-questions": "^1.0.0", "pi-web-access": "1.0.0" },
      });

      const result = await installPi({
        root: fx.root,
        output: fx.output,
        resolvePackage: fakeResolver({ "pi-questions": questions, "pi-web-access": web }).resolvePackage,
      });

      assert.deepEqual(result.packages.bundled, ["pi-questions", "pi-web-access"]);
      assert.ok(await pathExists(join(fx.output, "node_modules", "pi-questions", "extensions", "ask-questions.ts")));
      assert.ok(await pathExists(join(fx.output, "node_modules", "pi-web-access", "skills", "web", "SKILL.md")));

      const manifest = JSON.parse(await readFile(join(fx.output, "package.json"), "utf-8"));
      assert.deepEqual(manifest.pi.extensions, [
        "./extensions",
        "node_modules/pi-questions/extensions/ask-questions.ts",
        "node_modules/pi-web-access/index.ts",
      ]);
      assert.deepEqual(manifest.pi.skills, ["./skills", "node_modules/pi-web-access/skills"]);
    } finally {
      await fx.cleanup();
    }
  });

  it("copies the transitive closure, resolving each dependency from its dependent", async () => {
    const fx = await makeFixture();
    try {
      const installed = join(fx.root, "installed");
      const web = await createInstalledPackage(installed, {
        name: "pi-web-access",
        dependencies: { "p-limit": "^6.0.0" },
        pi: { extensions: ["./index.ts"] },
        files: { "index.ts": "export default () => {};\n" },
      });
      const limit = await createInstalledPackage(installed, {
        name: "p-limit",
        files: { "index.js": "export const limit = 1;\n" },
      });
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        dependencies: { "pi-web-access": "1.0.0" },
      });
      const resolver = fakeResolver({ "pi-web-access": web, "p-limit": limit });

      const result = await installPi({ root: fx.root, output: fx.output, resolvePackage: resolver.resolvePackage });

      assert.deepEqual(result.packages.bundled, ["pi-web-access"], "only declared packages contribute resources");
      assert.deepEqual(result.packages.staged, ["pi-web-access", "p-limit"]);
      assert.ok(await pathExists(join(fx.output, "node_modules", "p-limit", "index.js")));
      assert.deepEqual(
        resolver.calls.find((call) => call.name === "p-limit")?.fromDir,
        web,
        "transitive dependency resolved from its dependent, not a hoisted root",
      );
      const manifest = JSON.parse(await readFile(join(fx.output, "package.json"), "utf-8"));
      assert.deepEqual(manifest.pi.extensions, ["./extensions", "node_modules/pi-web-access/index.ts"]);
    } finally {
      await fx.cleanup();
    }
  });

  it("leaves ordinary dependencies out of node_modules and the manifest", async () => {
    const fx = await makeFixture();
    try {
      const installed = join(fx.root, "installed");
      const util = await createInstalledPackage(installed, { name: "plain-util", files: { "index.js": "export {};\n" } });
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        dependencies: { "plain-util": "^1.0.0" },
      });

      const result = await installPi({
        root: fx.root,
        output: fx.output,
        resolvePackage: fakeResolver({ "plain-util": util }).resolvePackage,
      });

      assert.deepEqual(result.packages.staged, []);
      assert.equal(await pathExists(join(fx.output, "node_modules")), false);
    } finally {
      await fx.cleanup();
    }
  });

  it("fails the install when a declared dependency cannot be resolved, leaving the previous staging intact", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });
      const staged = await readFile(join(fx.output, "agents", "alpha.agent.md"), "utf-8");

      await writeFixture(fx, "package.json", JSON.stringify(defaultPackageJson("9.9.9", { "pi-questions": "^1.0.0" })));

      await assert.rejects(
        installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage }),
        /cannot resolve "pi-questions"/,
      );
      assert.equal(await readFile(join(fx.output, "agents", "alpha.agent.md"), "utf-8"), staged);
    } finally {
      await fx.cleanup();
    }
  });

  it("fails when a bundled package's declared resource is missing from its published files", async () => {
    const fx = await makeFixture();
    try {
      const installed = join(fx.root, "installed");
      const questions = await createInstalledPackage(installed, {
        name: "pi-questions",
        pi: { extensions: ["./extensions/ask-questions.ts"] },
      });
      await seedPackage(fx, {
        agents: { alpha: { body: "# alpha" } },
        dependencies: { "pi-questions": "^1.0.0" },
      });

      await assert.rejects(
        installPi({
          root: fx.root,
          output: fx.output,
          resolvePackage: fakeResolver({ "pi-questions": questions }).resolvePackage,
        }),
        /references missing resources: node_modules\/pi-questions\/extensions\/ask-questions\.ts/,
      );
    } finally {
      await fx.cleanup();
    }
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe("installPi — re-staging", () => {
  it("removes artifacts of a previous run instead of accumulating them", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });
      const first = (await listFiles(fx.output)).sort();

      await writeFixture(fx, "skills/engineering/echo/SKILL.md", "---\nname: echo\ndescription: d\n---\n\nUpdated.\n");
      await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });

      assert.deepEqual((await listFiles(fx.output)).sort(), first, "same tree, no stale copies");
    } finally {
      await fx.cleanup();
    }
  });

  it("drops a skill that no longer exists in the sources", async () => {
    const fx = await makeFixture();
    try {
      await seedPackage(fx, { agents: { alpha: { body: "# alpha" } } });
      await writeFixture(fx, "skills/engineering/retired/SKILL.md", "---\nname: retired\ndescription: d\n---\n\nBody.\n");
      await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });
      assert.ok(await pathExists(join(fx.output, "skills", "engineering", "retired", "SKILL.md")));

      await rm(join(fx.root, "skills", "engineering", "retired"), { recursive: true });
      await installPi({ root: fx.root, output: fx.output, resolvePackage: fakeResolver({}).resolvePackage });

      assert.equal(await pathExists(join(fx.output, "skills", "engineering", "retired")), false);
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
      });

      const result = await installPi({
        root: fx.root,
        output: fx.output,
        dryRun: true,
        resolvePackage: fakeResolver({}).resolvePackage,
      });

      assert.equal(result.dryRun, true);
      assert.equal((await listFiles(fx.output)).length, 0, "no files written in dry-run");
      assert.equal(result.agents.length, 1);
      assert.equal(result.agents[0].name, "alpha");
      assert.equal(result.skills.skills, 1);
      assert.equal(result.manifest.path, join(fx.output, "package.json"));
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
      await installPi({ root: fx.root, output: deep, resolvePackage: fakeResolver({}).resolvePackage });
      assert.ok(await pathExists(join(deep, "agents", "alpha.agent.md")));
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
      assert.ok(ralph.includes("## Wake mechanism (PI — blocking wait)"), "{{SECTION:wake}} composed from pi/wake.md");
      const bodyTokens = ralph.split("---\n").slice(2).join("---\n");
      assert.ok(!/{{/.test(bodyTokens), "no literal tokens in ralph body");

      // plan body carries the relative {{PATH:...}} resolved against the plugin root.
      // Tool list preserves authoring order (composer translateToolList, unlike the
      // runtime agent-modes translateTools which sorts): ask_user → ask_questions,
      // skill → read (last position).
      const plan = await readFile(join(fx.output, "agents", "plan.agent.md"), "utf-8");
      assert.match(plan, /tools: "bash, read, edit, write, grep, find, ask_questions, task, read_agent, read"/);
      assert.ok(
        plan.includes("~/.agent-cortex/pi/skills/workflow/plan/SKILL.md"),
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

  it("stages a self-contained package: real files only, bundled pi tools, nothing outside the output", async () => {
    const fx = await makeFixture();
    try {
      const result = await installPi({ root: REPO_ROOT, output: fx.output });

      const manifest = JSON.parse(await readFile(join(fx.output, "package.json"), "utf-8"));
      assert.deepEqual(manifest.pi.extensions, [
        "./extensions",
        "node_modules/pi-questions/extensions/ask-questions.ts",
        "node_modules/pi-web-access/index.ts",
      ]);
      assert.deepEqual(manifest.pi.skills, ["./skills", "node_modules/pi-web-access/skills"]);
      assert.deepEqual(result.packages.bundled, ["pi-questions", "pi-web-access"]);

      for (const rel of [...manifest.pi.extensions, ...manifest.pi.skills]) {
        assert.ok(await pathExists(join(fx.output, rel)), `manifest resource ${rel} exists`);
      }
      for (const name of ["pi-questions", "pi-web-access"]) {
        assert.equal((await lstat(join(fx.output, "node_modules", name))).isSymbolicLink(), false, `${name} is a real directory`);
      }

      const tree = await listFiles(fx.output);
      assert.ok(tree.some((f) => f.startsWith(join("extensions", "agent-modes"))), "extensions staged");
      assert.ok(tree.some((f) => f === "token-map.json"), "token map staged");

      const links = [];
      for (const rel of tree) {
        if ((await lstat(join(fx.output, rel))).isSymbolicLink()) links.push(rel);
      }
      assert.deepEqual(links, [], "staged tree contains no symlinks");
    } finally {
      await fx.cleanup();
    }
  });
});
