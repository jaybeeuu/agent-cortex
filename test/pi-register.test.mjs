// Tests for the pi package registration step of `agent-cortex install pi`:
// once the package is staged, the plain install registers the staged directory
// with pi by driving pi's own `pi install` / `pi remove` commands, so pi loads
// agents, skills, and extensions from ~/.agent-cortex/pi instead of from a raw
// repo checkout. Registration is idempotent by STATE (pi's configured package
// sources decide install-vs-no-op) and drops any stale raw-repo source so there
// is exactly one agent-cortex source.
//
// The real `pi` CLI is a genuine external system (and its user settings must
// never be touched), so these tests drive the stateful fake from
// test/helpers/fake-pi.mjs against a throwaway directory tree.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerPi } from "../bin/installers/pi.mjs";
import { makeFakePi } from "./helpers/fake-pi.mjs";

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "agent-cortex.mjs");

// The name of this repo's published package — the identity that marks a
// configured local source as a raw agent-cortex checkout (the staged package is
// named @jaybeeuu/agent-cortex-pi).
const RAW_PACKAGE_NAME = "@jaybeeuu/agent-cortex";

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI_PATH, ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) => resolve({ exitCode: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * A throwaway install tree: the repo root that owns the raw package name, a
 * raw-repo checkout (a worktree of it) configured as a pi package source, a
 * fake pi (whose own directory is pi's settings dir), and the staged output.
 */
async function makeInstallTree() {
  const root = await mkdtemp(join(tmpdir(), "pi-register-"));
  const rawRepo = join(root, "checkout");
  const staged = join(root, "out");

  await writeFile(join(root, "package.json"), JSON.stringify({ name: RAW_PACKAGE_NAME, version: "1.42.0" }));
  await mkdir(rawRepo, { recursive: true });
  await writeFile(join(rawRepo, "package.json"), JSON.stringify({ name: RAW_PACKAGE_NAME, version: "1.42.0" }));
  await mkdir(staged, { recursive: true });
  await writeFile(join(staged, "package.json"), JSON.stringify({ name: "@jaybeeuu/agent-cortex-pi", private: true }));

  const piDir = join(root, "pi");
  await mkdir(piDir, { recursive: true });

  return {
    root,
    rawRepo,
    staged,
    piDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** Start the fake `pi` for a tree, seeding pi's configured package sources. */
async function makePi(tree, { packages = [], failWhen = null } = {}) {
  const pi = await makeFakePi(tree.piDir, { packages, failWhen });
  return {
    ...tree,
    pi,
    /** Settings path handed to registerPi (the fake's own settings file). */
    settingsPath: pi.settingsPath,
    /** Absolute paths of the local package sources pi has configured. */
    localSources: async () => {
      const { packages: configured = [] } = JSON.parse(await readFile(pi.settingsPath, "utf-8"));
      return configured
        .map((entry) => (typeof entry === "string" ? entry : entry.source))
        .filter((source) => !source.startsWith("npm:"))
        .map((source) => join(dirname(pi.settingsPath), source));
    },
    /** Raw argv lines pi was invoked with. */
    calls: async () =>
      (await readFile(pi.log, "utf-8").catch(() => "")).split("\n").filter(Boolean),
  };
}

// ─── registerPi ──────────────────────────────────────────────────────────────

describe("registerPi", () => {
  it("registers the staged package and replaces the raw-repo source, leaving one agent-cortex source", async () => {
    const tree = await makeInstallTree();
    try {
      const fx = await makePi(tree, { packages: [{ source: "../checkout", skills: [] }, "npm:context-mode"] });

      const summary = await registerPi({
        root: fx.root,
        output: fx.staged,
        settingsPath: fx.settingsPath,
        piBin: fx.pi.bin,
        warn: () => {},
      });

      assert.deepEqual(summary.commands, [
        ["remove", fx.rawRepo],
        ["install", fx.staged],
      ]);
      assert.deepEqual(summary.removed, [fx.rawRepo]);
      assert.deepEqual(await fx.calls(), [`--version`, `remove ${fx.rawRepo}`, `install ${fx.staged}`]);
      assert.deepEqual(await fx.localSources(), [fx.staged], "the raw repo source is gone, the staged one added");
      assert.ok((await readFile(fx.settingsPath, "utf-8")).includes("npm:context-mode"), "other package sources untouched");
    } finally {
      await tree.cleanup();
    }
  });

  it("is idempotent: a second run spawns nothing and leaves pi's settings unchanged", async () => {
    const tree = await makeInstallTree();
    try {
      const fx = await makePi(tree, { packages: [{ source: "../checkout", skills: [] }] });
      const options = { root: fx.root, output: fx.staged, settingsPath: fx.settingsPath, piBin: fx.pi.bin, warn: () => {} };
      await registerPi(options);
      const callsAfterFirstRun = await fx.calls();
      const settingsAfterFirstRun = await readFile(fx.settingsPath, "utf-8");

      const second = await registerPi(options);

      assert.deepEqual(second.commands, []);
      assert.deepEqual((await fx.calls()).slice(callsAfterFirstRun.length), [], "no further pi invocation");
      assert.equal(await readFile(fx.settingsPath, "utf-8"), settingsAfterFirstRun);
    } finally {
      await tree.cleanup();
    }
  });

  it("registers into an unconfigured pi without touching anything else", async () => {
    const tree = await makeInstallTree();
    try {
      const fx = await makePi(tree);

      const summary = await registerPi({
        root: fx.root,
        output: fx.staged,
        settingsPath: fx.settingsPath,
        piBin: fx.pi.bin,
        warn: () => {},
      });

      assert.deepEqual(summary.commands, [["install", fx.staged]]);
      assert.deepEqual(await fx.localSources(), [fx.staged]);
    } finally {
      await tree.cleanup();
    }
  });

  it("removes a stale raw-repo source when the staged package is already registered", async () => {
    const tree = await makeInstallTree();
    try {
      const fx = await makePi(tree, { packages: ["../out", "../checkout"] });

      const summary = await registerPi({
        root: fx.root,
        output: fx.staged,
        settingsPath: fx.settingsPath,
        piBin: fx.pi.bin,
        warn: () => {},
      });

      assert.deepEqual(summary.commands, [["remove", fx.rawRepo]], "no re-install of the staged source");
      assert.deepEqual(await fx.localSources(), [fx.staged]);
    } finally {
      await tree.cleanup();
    }
  });

  it("--dry-run plans the registration without spawning pi or writing settings", async () => {
    const tree = await makeInstallTree();
    try {
      const fx = await makePi(tree, { packages: [{ source: "../checkout", skills: [] }, "npm:context-mode"] });
      const settingsBefore = await readFile(fx.settingsPath, "utf-8");

      const summary = await registerPi({
        root: fx.root,
        output: fx.staged,
        settingsPath: fx.settingsPath,
        piBin: fx.pi.bin,
        dryRun: true,
        warn: () => {},
      });

      assert.deepEqual(summary.commands, [
        ["remove", fx.rawRepo],
        ["install", fx.staged],
      ]);
      assert.deepEqual(await fx.calls(), [], "nothing spawned");
      assert.equal(await readFile(fx.settingsPath, "utf-8"), settingsBefore, "settings untouched");
    } finally {
      await tree.cleanup();
    }
  });

  it("warns with the manual commands when the pi CLI is unavailable, changing nothing", async () => {
    const tree = await makeInstallTree();
    try {
      const fx = await makePi(tree, { packages: [{ source: "../checkout", skills: [] }] });
      const settingsBefore = await readFile(fx.settingsPath, "utf-8");
      const warnings = [];

      const summary = await registerPi({
        root: fx.root,
        output: fx.staged,
        settingsPath: fx.settingsPath,
        piBin: join(fx.root, "no-such-pi"),
        warn: (message) => warnings.push(message),
      });

      assert.equal(summary.registered, false);
      const warning = warnings.join("\n");
      assert.ok(warning.includes(`pi remove ${fx.rawRepo}`), "prints the manual remove command");
      assert.ok(warning.includes(`pi install ${fx.staged}`), "prints the manual install command");
      assert.equal(await readFile(fx.settingsPath, "utf-8"), settingsBefore, "settings untouched");
    } finally {
      await tree.cleanup();
    }
  });

  it("fails the run on an unavailable pi CLI when --require-register is set", async () => {
    const tree = await makeInstallTree();
    try {
      const fx = await makePi(tree);

      await assert.rejects(
        registerPi({
          root: fx.root,
          output: fx.staged,
          settingsPath: fx.settingsPath,
          piBin: join(fx.root, "no-such-pi"),
          requireRegister: true,
          warn: () => {},
        }),
        /registration/,
      );
    } finally {
      await tree.cleanup();
    }
  });

  it("refuses to register a staged package that does not exist", async () => {
    const tree = await makeInstallTree();
    try {
      const fx = await makePi(tree);

      await assert.rejects(
        registerPi({
          root: fx.root,
          output: join(fx.root, "never-staged"),
          settingsPath: fx.settingsPath,
          piBin: fx.pi.bin,
          warn: () => {},
        }),
        /never-staged/,
      );
    } finally {
      await tree.cleanup();
    }
  });
});

// ─── CLI wiring ──────────────────────────────────────────────────────────────

describe("install pi CLI: registration", () => {
  it("--dry-run without --output prints the registration plan and writes nothing", async () => {
    const home = await mkdtemp(join(tmpdir(), "cli-pi-register-home-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "pi", "--dry-run"], { HOME: home });

      assert.equal(exitCode, 0);
      assert.ok(stdout.includes(`would run: pi install ${join(home, ".agent-cortex", "pi")}`));
      assert.equal(await pathExists(join(home, ".pi")), false, "pi's settings dir untouched");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("--output <dir> stages only — no registration is attempted", async () => {
    const home = await mkdtemp(join(tmpdir(), "cli-pi-register-out-home-"));
    const out = await mkdtemp(join(tmpdir(), "cli-pi-register-out-"));
    try {
      const { exitCode, stdout } = await runCli(["install", "pi", "--output", out], { HOME: home });

      assert.equal(exitCode, 0);
      assert.doesNotMatch(stdout, /Registering the staged pi package/);
      assert.ok(stdout.includes(`pi install ${out}`), "prints the manual registration hint");
      assert.equal(await pathExists(join(home, ".pi")), false, "pi's settings dir untouched");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(out, { recursive: true, force: true });
    }
  });
});
