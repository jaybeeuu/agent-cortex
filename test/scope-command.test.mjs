// `ctx scope add` and `ctx scope list`, exercised from a staged install outside the checkout.
//
// The staged copy is the published layout: the directories `package.json` `files` ships and the
// CLI loads, copied beside each other in a temp package root. `bin/agent-cortex.mjs` reaches the
// scope model through `../skills/workflow/hitl-queue/scripts/scopes.mjs`, so a package that ships
// `bin/` without `skills/` fails here rather than on a consumer's machine.
//
// Every run points `AGENT_CORTEX_HOME` and `HOME` at the temp root, so no test reads or writes a
// real install and no path of one machine appears in the suite.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTempRoot } from "./helpers/temp-root.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = createTempRoot("agent-cortex-scope-");

/** @returns {Promise<string>} */
async function stageInstall() {
  const root = await tempRoot.createWorkspace();
  const packageRoot = join(root, "package");
  for (const dir of ["bin", "lib", "scripts", "skills"]) {
    await cp(join(REPO_ROOT, dir), join(packageRoot, dir), { recursive: true });
  }
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "agent-cortex", version: "0.0.0-staged" }, null, 2),
  );
  return join(packageRoot, "bin", "agent-cortex.mjs");
}

const CLI = await stageInstall();

/**
 * Run the staged CLI. `env` replaces `AGENT_CORTEX_HOME` and `HOME`; the rest of the
 * environment is inherited so `node` behaves as usual.
 * @param {string[]} args
 * @param {{ env: Record<string, string>, cwd: string }} options
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
function runCli(args, { env, cwd }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, cwd }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * A directory a run can stand in. `marker` adds the `.beads` that makes it its own workspace.
 * @param {{ marker?: boolean }} [options]
 * @returns {Promise<string>}
 */
async function createDirectory({ marker = true } = {}) {
  const dir = await tempRoot.createWorkspace();
  if (marker) await mkdir(join(dir, ".beads"), { recursive: true });
  return dir;
}

/**
 * The temp home a run reads: `AGENT_CORTEX_HOME` for the scope list, `HOME` for `~`.
 * @returns {Promise<{ home: string, cortexHome: string, env: Record<string, string> }>}
 */
async function createHome() {
  const home = await tempRoot.createWorkspace();
  const cortexHome = join(home, ".agent-cortex");
  await mkdir(cortexHome, { recursive: true });
  return { home, cortexHome, env: { AGENT_CORTEX_HOME: cortexHome, HOME: home } };
}

/** @param {string} path @returns {Promise<boolean>} */
async function exists(path) {
  return await stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * The user-level list as the command left it, typed only far enough to read it back.
 * @param {string} cortexHome
 * @returns {Promise<Record<string, unknown> & { scopes: Record<string, unknown>[] }>}
 */
async function readConfig(cortexHome) {
  return JSON.parse(await readFile(join(cortexHome, "scopes.json"), "utf8"));
}

/** @param {string} path @returns {Promise<string>} */
async function resolved(path) {
  return await realpath(path);
}

describe("scope add", () => {
  it("adds a scope to an empty user list with its name, kind and resolved path", async () => {
    const workspace = await createDirectory();
    const notes = await createDirectory();
    const { cortexHome, env } = await createHome();

    const result = await runCli(["scope", "add", "--path", notes, "--name", "notes", "--kind", "personal"], {
      env,
      cwd: workspace,
    });

    assert.equal(result.exitCode, 0, result.stderr);
    const config = await readConfig(cortexHome);
    const entry = config.scopes.find((scope) => scope.name === "notes");
    assert.deepEqual(entry, {
      name: "notes",
      path: await resolved(notes),
      kind: "personal",
      readOnly: true,
    });
    assert.match(result.stdout, /Added scope "notes" \(personal\)/);
  });

  it("refuses a directory with no .beads of its own and names that check", async () => {
    const workspace = await createDirectory();
    const plain = await createDirectory({ marker: false });
    const { cortexHome, env } = await createHome();

    const result = await runCli(["scope", "add", "--path", plain, "--name", "notes"], { env, cwd: workspace });

    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /carries no \.beads of its own/);
    assert.match(result.stderr, /check: it is its own bd workspace/);
    assert.equal(await exists(join(cortexHome, "scopes.json")), false, "no list is written for a refused directory");
  });

  it("refuses a nested directory that would borrow the enclosing workspace's beads", async () => {
    const workspace = await createDirectory();
    const nested = join(workspace, "packages", "inner");
    await mkdir(nested, { recursive: true });
    const { cortexHome, env } = await createHome();

    const result = await runCli(["scope", "add", "--path", nested], { env, cwd: workspace });

    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /carries no \.beads of its own/);
    assert.match(result.stderr, /check: it is its own bd workspace/);
    assert.equal(await exists(join(cortexHome, "scopes.json")), false, "no list is written for a refused directory");
  });

  it("refuses a path that does not exist and names that check", async () => {
    const workspace = await createDirectory();
    const absent = join(workspace, "not-created-yet");
    const { cortexHome, env } = await createHome();

    const result = await runCli(["scope", "add", "--path", absent], { env, cwd: workspace });

    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /does not exist/);
    assert.match(result.stderr, /check: the directory exists/);
    assert.equal(await exists(join(cortexHome, "scopes.json")), false, "no list is written for a refused directory");
  });

  it("keeps the current workspace in the list when it adds the first scope", async () => {
    const workspace = await createDirectory();
    const notes = await createDirectory();
    const { cortexHome, env } = await createHome();

    const result = await runCli(["scope", "add", "--path", notes, "--name", "notes"], { env, cwd: workspace });

    assert.equal(result.exitCode, 0, result.stderr);
    const config = await readConfig(cortexHome);
    const currentPath = await resolved(workspace);
    const retained = config.scopes.find((scope) => scope.path === currentPath);
    assert.deepEqual(retained, {
      name: "code",
      path: await resolved(workspace),
      kind: "code",
      readOnly: false,
    });
    assert.match(result.stdout, /the current workspace stays in the list as "code"/);
  });

  it("keeps the current workspace when the existing list does not name it", async () => {
    const workspace = await createDirectory();
    const notes = await createDirectory();
    const { cortexHome, env } = await createHome();
    const other = await createDirectory();
    await writeFile(
      join(cortexHome, "scopes.json"),
      JSON.stringify({ scopes: [{ name: "other", path: other, kind: "ops" }] }, null, 2),
    );

    const result = await runCli(["scope", "add", "--path", notes, "--name", "notes"], { env, cwd: workspace });

    assert.equal(result.exitCode, 0, result.stderr);
    const config = await readConfig(cortexHome);
    const paths = config.scopes.map((scope) => scope.path);
    assert.ok(paths.includes(await resolved(workspace)), "the current workspace is retained");
    assert.ok(paths.includes(await resolved(other)), "the entry already in the list is retained");
    assert.equal(config.scopes.length, 3);
  });

  it("preserves unknown keys and every untouched entry while it updates one", async () => {
    const workspace = await createDirectory();
    const notes = await createDirectory();
    const other = await createDirectory();
    const { cortexHome, env } = await createHome();
    const seeded = {
      version: 7,
      vault: { path: "kept", unknown: [1, 2] },
      scopes: [
        { name: "code", path: workspace, kind: "code", readOnly: false },
        { name: "notes", path: notes, kind: "personal", pinned: true },
        { name: "other", path: other, kind: "ops" },
      ],
      trailing: "kept",
    };
    await writeFile(join(cortexHome, "scopes.json"), JSON.stringify(seeded, null, 2));

    const result = await runCli(["scope", "add", "--path", notes, "--name", "notes", "--kind", "ops"], {
      env,
      cwd: workspace,
    });

    assert.equal(result.exitCode, 0, result.stderr);
    const config = await readConfig(cortexHome);
    assert.equal(config.version, 7);
    assert.deepEqual(config.vault, { path: "kept", unknown: [1, 2] });
    assert.equal(config.trailing, "kept");
    assert.equal(config.scopes.length, 3);
    assert.deepEqual(config.scopes[0], seeded.scopes[0]);
    assert.deepEqual(config.scopes[2], seeded.scopes[2]);
    assert.equal(config.scopes[1].kind, "ops", "the touched entry changed");
    assert.equal(config.scopes[1].pinned, true, "the touched entry keeps its own unknown key");
  });

  it("updates an existing entry instead of appending a duplicate", async () => {
    const workspace = await createDirectory();
    const notes = await createDirectory();
    const { cortexHome, env } = await createHome();
    const args = ["scope", "add", "--path", notes, "--name", "notes"];

    assert.equal((await runCli(args, { env, cwd: workspace })).exitCode, 0);
    const second = await runCli(args, { env, cwd: workspace });

    assert.equal(second.exitCode, 0, second.stderr);
    assert.match(second.stdout, /Updated scope "notes"/);
    const config = await readConfig(cortexHome);
    assert.equal(config.scopes.filter((scope) => scope.name === "notes").length, 1);
  });

  it("refuses a name another workspace already holds and names that workspace", async () => {
    const workspace = await createDirectory();
    const base = await tempRoot.createWorkspace();
    const first = join(base, "one", "shared");
    const second = join(base, "two", "shared");
    for (const dir of [first, second]) await mkdir(join(dir, ".beads"), { recursive: true });
    const { cortexHome, env } = await createHome();
    assert.equal((await runCli(["scope", "add", "--path", first], { env, cwd: workspace })).exitCode, 0);

    // Both directories are named "shared", so the second add takes the same default name.
    const result = await runCli(["scope", "add", "--path", second], { env, cwd: workspace });

    const holder = await resolved(first);
    const proposed = await resolved(second);
    assert.equal(result.exitCode, 2);
    assert.ok(
      result.stderr.includes(`already names ${holder}.`),
      `the refusal names the workspace that holds the name: ${result.stderr}`,
    );
    assert.ok(
      !result.stderr.includes(`already names ${proposed}.`),
      `the refusal does not name the workspace being added as the holder: ${result.stderr}`,
    );
    assert.match(result.stderr, /Pass --name to register/);
    const config = await readConfig(cortexHome);
    assert.equal(config.scopes.length, 2, "the refused entry was not written");
  });

  it("refuses a user list it cannot parse and leaves it byte for byte", async () => {
    const workspace = await createDirectory();
    const notes = await createDirectory();
    const { cortexHome, env } = await createHome();
    const seeded = {
      scopes: [
        { name: "code", path: workspace, kind: "code", readOnly: false },
        { name: "broken" },
      ],
    };
    const broken = JSON.stringify(seeded, null, 2);
    await writeFile(join(cortexHome, "scopes.json"), broken);

    const result = await runCli(["scope", "add", "--path", notes, "--name", "notes"], { env, cwd: workspace });

    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /scope 2 in .* has no "path"/);
    assert.equal(await readFile(join(cortexHome, "scopes.json"), "utf8"), broken);
  });
});

describe("scope list", () => {
  it("prints every resolved scope with its kind, read-only flag and availability", async () => {
    const workspace = await createDirectory();
    const { home, cortexHome, env } = await createHome();
    const relativeWorkspace = join(cortexHome, "notes");
    const homeWorkspace = join(home, "home-workspace");
    for (const dir of [relativeWorkspace, homeWorkspace]) {
      await mkdir(join(dir, ".beads"), { recursive: true });
    }
    await writeFile(
      join(cortexHome, "scopes.json"),
      JSON.stringify(
        {
          scopes: [
            { name: "code", path: workspace, kind: "code", readOnly: false },
            { name: "notes", path: "notes", kind: "personal" },
            { name: "home", path: "~/home-workspace", kind: "ops" },
            { name: "gone", path: "~/absent", kind: "ops" },
          ],
        },
        null,
        2,
      ),
    );

    const result = await runCli(["scope", "list"], { env, cwd: workspace });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`scopes · ${cortexHome}/scopes\\.json`));
    assert.match(result.stdout, /code\s+code\s+readOnly=false\s+available \(writable\)\s+\S+/);
    assert.ok(result.stdout.includes(await resolved(relativeWorkspace)), "the relative path is resolved and printed");
    assert.ok(result.stdout.includes(await resolved(homeWorkspace)), "the ~-relative path is resolved and printed");
    assert.match(result.stdout, /notes\s+personal\s+readOnly=true\s+available/);
    assert.match(result.stdout, /home\s+ops\s+readOnly=true\s+available/);
    assert.match(result.stdout, /gone\s+ops\s+readOnly=true\s+unavailable: workspace does not exist/);
  });

  it("prints the implicit current workspace when no list is configured", async () => {
    const workspace = await createDirectory();
    const { env } = await createHome();

    const result = await runCli(["scope", "list"], { env, cwd: workspace });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /none configured — the current workspace alone/);
    assert.match(result.stdout, /code\s+code\s+readOnly=false\s+available \(writable\)/);
    assert.ok(result.stdout.includes(await resolved(workspace)));
  });
});
