import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseManifest,
  planInstalls,
  packageSources,
  manifestFileFor,
} from "../lib/extension-manifest.mjs";
import { installExtensions } from "../bin/installers/ext.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "bin", "agent-cortex.mjs");

/** Run the CLI with an optional env overlay (HOME keeps tests off the real store). */
function runCli(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? error.code ?? 1 : 0, stdout, stderr });
    });
  });
}

/** Write a `harness.extensions.json` into a temp dir and return its path. */
async function writeManifest(dir, harness, extensions) {
  const path = join(dir, `${harness}.extensions.json`);
  await writeFile(path, JSON.stringify({ harness, extensions }, null, 2));
  return path;
}

/** A fake runner that records invocations and (for pi) appends sources to a store. */
function makePiRunner(storePath, { failFor = [] } = {}) {
  const calls = [];
  const failing = new Set(failFor);
  const run = async ({ command, args }) => {
    calls.push({ command, args });
    const source = args[args.length - 1];
    if (failing.has(source)) return { code: 1, stdout: "" };
    let settings = {};
    try {
      settings = JSON.parse(await readFile(storePath, "utf-8"));
    } catch {
      settings = {};
    }
    settings.packages = [...(settings.packages ?? []), source];
    await writeFile(storePath, JSON.stringify(settings));
    return { code: 0, stdout: "" };
  };
  return { calls, run };
}

describe("parseManifest", () => {
  it("parses a harness manifest with string and object entries", async () => {
    const raw = JSON.stringify({
      harness: "pi",
      extensions: ["npm:a", { source: "npm:b", description: "B" }],
    });
    assert.deepStrictEqual(parseManifest(raw, { expectedHarness: "pi" }), {
      harness: "pi",
      extensions: [{ source: "npm:a" }, { source: "npm:b", description: "B" }],
    });
  });

  it("accepts a bare array", async () => {
    assert.deepStrictEqual(parseManifest('["npm:a"]'), { extensions: [{ source: "npm:a" }] });
  });

  it("trims sources", async () => {
    assert.deepStrictEqual(parseManifest('["  npm:a  "]').extensions, [{ source: "npm:a" }]);
  });

  it("rejects invalid JSON", async () => {
    assert.throws(() => parseManifest("{"), /not valid JSON/);
  });

  it("rejects a non-array extensions field", async () => {
    assert.throws(() => parseManifest('{"extensions": {}}'), /extensions/);
  });

  it("rejects an entry without a source", async () => {
    assert.throws(() => parseManifest('[{"description": "x"}]'), /missing a non-empty "source"/);
  });

  it("rejects duplicate sources", async () => {
    assert.throws(() => parseManifest('["npm:a", "npm:a"]'), /duplicate extension source/);
  });

  it("rejects a manifest declaring the wrong harness", async () => {
    assert.throws(() => parseManifest('{"harness": "claude", "extensions": []}', { expectedHarness: "pi" }), /harness "claude"/);
  });
});

describe("planInstalls", () => {
  it("skips installed sources and plans the rest in manifest order", async () => {
    const extensions = [{ source: "npm:a" }, { source: "npm:b" }, { source: "npm:c" }];
    assert.deepStrictEqual(planInstalls(extensions, ["npm:b"]), [
      { source: "npm:a", action: "install" },
      { source: "npm:b", action: "skip" },
      { source: "npm:c", action: "install" },
    ]);
  });
});

describe("packageSources", () => {
  it("extracts source strings from pi's string/object package shapes", async () => {
    assert.deepStrictEqual(packageSources(["npm:a", { source: "npm:b", skills: [] }, 42, { skills: [] }]), [
      "npm:a",
      "npm:b",
    ]);
  });

  it("returns [] for a non-array", async () => {
    assert.deepStrictEqual(packageSources(undefined), []);
  });
});

describe("manifestFileFor", () => {
  it("resolves the committed per-harness filename", async () => {
    assert.equal(manifestFileFor("/pkg", "pi"), join("/pkg", "pi.extensions.json"));
    assert.equal(manifestFileFor("/pkg", "claude"), join("/pkg", "claude.extensions.json"));
  });

  it("rejects a harness without a manifest", async () => {
    assert.throws(() => manifestFileFor("/pkg", "copilot"), /no extension manifest/);
  });
});

describe("installExtensions (pi)", () => {
  it("installs every declared extension and preserves manifest order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-install-"));
    try {
      const manifestPath = await writeManifest(dir, "pi", ["npm:a", "npm:b"]);
      const store = join(dir, "settings.json");
      const { calls, run } = makePiRunner(store);

      const result = await installExtensions({ harness: "pi", manifestPath, piStore: store, run, warn: () => {} });

      assert.deepStrictEqual(calls.map((c) => c.args), [
        ["install", "npm:a"],
        ["install", "npm:b"],
      ]);
      assert.deepStrictEqual(result.plan.map((p) => p.status), ["installed", "installed"]);
      assert.equal(result.installed, 2);
      assert.equal(result.failed, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent — a second run installs nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-install-"));
    try {
      const manifestPath = await writeManifest(dir, "pi", ["npm:a", "npm:b"]);
      const store = join(dir, "settings.json");
      const first = makePiRunner(store);
      await installExtensions({ harness: "pi", manifestPath, piStore: store, run: first.run, warn: () => {} });

      const second = makePiRunner(store);
      const result = await installExtensions({ harness: "pi", manifestPath, piStore: store, run: second.run, warn: () => {} });

      assert.deepStrictEqual(second.calls, [], "no installer invoked on the second run");
      assert.deepStrictEqual(result.plan.map((p) => p.status), ["already-installed", "already-installed"]);
      assert.equal(result.installed, 0);
      assert.equal(result.skipped, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns and continues when one extension fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-install-"));
    try {
      const manifestPath = await writeManifest(dir, "pi", ["npm:a", "npm:bad", "npm:c"]);
      const store = join(dir, "settings.json");
      const warnings = [];
      const { calls, run } = makePiRunner(store, { failFor: ["npm:bad"] });

      const result = await installExtensions({
        harness: "pi",
        manifestPath,
        piStore: store,
        run,
        warn: (msg) => warnings.push(msg),
      });

      assert.equal(calls.length, 3, "the failing extension does not abort the rest");
      assert.deepStrictEqual(result.plan.map((p) => p.status), ["installed", "failed", "installed"]);
      assert.equal(result.failed, 1);
      assert.equal(result.installed, 2);
      assert.ok(warnings.some((w) => w.includes("npm:bad")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never invokes the installer in dry-run mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-install-"));
    try {
      const manifestPath = await writeManifest(dir, "pi", ["npm:a", "npm:b"]);
      const store = join(dir, "settings.json");
      const { calls, run } = makePiRunner(store);

      const result = await installExtensions({
        harness: "pi",
        manifestPath,
        piStore: store,
        run,
        warn: () => {},
        dryRun: true,
      });

      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(result.plan.map((p) => p.status), ["would-install", "would-install"]);
      assert.equal(result.dryRun, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats an unreadable pi store as empty and warns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-install-"));
    try {
      const manifestPath = await writeManifest(dir, "pi", ["npm:a"]);
      const store = join(dir, "settings.json");
      await writeFile(store, "{ not json");
      const warnings = [];
      const { run } = makePiRunner(store);

      const result = await installExtensions({
        harness: "pi",
        manifestPath,
        piStore: store,
        run,
        warn: (msg) => warnings.push(msg),
      });

      assert.equal(result.installed, 1);
      assert.ok(warnings.some((w) => w.includes("not valid JSON")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws when the manifest file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-install-"));
    try {
      await assert.rejects(
        installExtensions({ harness: "pi", manifestPath: join(dir, "nope.json"), piStore: join(dir, "s.json"), run: async () => ({ code: 0, stdout: "" }), warn: () => {} }),
        /no pi extension manifest/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("installExtensions (claude)", () => {
  it("installs plugins missing from `claude plugin list --json`", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-install-"));
    try {
      const manifestPath = await writeManifest(dir, "claude", ["foo@market", "bar@market"]);
      const calls = [];
      const run = async ({ command, args, capture }) => {
        calls.push({ command, args });
        if (capture) return { code: 0, stdout: JSON.stringify([{ id: "foo@market", version: "1.0.0" }]) };
        return { code: 0, stdout: "" };
      };

      const result = await installExtensions({ harness: "claude", manifestPath, run, warn: () => {} });

      assert.deepStrictEqual(calls, [
        { command: "claude", args: ["plugin", "list", "--json"] },
        { command: "claude", args: ["plugin", "install", "bar@market", "-y"] },
      ]);
      assert.deepStrictEqual(result.plan.map((p) => p.status), ["already-installed", "installed"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns and plans every plugin when the claude CLI cannot list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-install-"));
    try {
      const manifestPath = await writeManifest(dir, "claude", ["foo@market"]);
      const warnings = [];
      const run = async ({ capture }) =>
        capture ? { code: null, stdout: "", error: new Error("spawn claude ENOENT") } : { code: 1, stdout: "" };

      const result = await installExtensions({
        harness: "claude",
        manifestPath,
        run,
        warn: (msg) => warnings.push(msg),
      });

      assert.equal(result.failed, 1);
      assert.ok(warnings.some((w) => w.includes("could not list installed claude plugins")));
      assert.ok(warnings.some((w) => w.includes("foo@market")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI ext install", () => {
  it("prints a deterministic dry-run plan against an isolated store", async () => {
    const home = await mkdtemp(join(tmpdir(), "ext-cli-"));
    try {
      const { exitCode, stdout } = await runCli(["ext", "install", "--harness", "pi", "--dry-run"], { HOME: home });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Installing declared extensions for "pi" harness'));
      assert.ok(stdout.includes("→ npm:pi-web-access@0.10.7 (would install)"));
      assert.ok(stdout.includes("5 to install, 0 already installed, 0 failed"));
      assert.ok(stdout.includes("(dry-run — nothing installed)"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports declared extensions already present in the store", async () => {
    const home = await mkdtemp(join(tmpdir(), "ext-cli-"));
    try {
      const storeDir = join(home, ".pi", "agent");
      await mkdir(storeDir, { recursive: true });
      const manifest = JSON.parse(await readFile(join(__dirname, "..", "pi.extensions.json"), "utf-8"));
      await writeFile(
        join(storeDir, "settings.json"),
        JSON.stringify({ packages: manifest.extensions.map((e) => e.source) }),
      );

      const { exitCode, stdout } = await runCli(["ext", "install", "--harness", "pi", "--dry-run"], { HOME: home });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes("· npm:pi-web-access@0.10.7 (already installed)"));
      assert.ok(stdout.includes("0 to install, 5 already installed, 0 failed"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("exits 1 and explains when --harness is missing", async () => {
    const { exitCode, stderr } = await runCli(["ext", "install"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Missing --harness"));
  });

  it("exits 1 for an unsupported harness", async () => {
    const { exitCode, stderr } = await runCli(["ext", "install", "--harness", "copilot"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Unknown harness "copilot"'));
  });

  it("exits 1 for an unknown ext subcommand", async () => {
    const { exitCode, stderr } = await runCli(["ext", "frobnicate"]);
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes("Unknown ext subcommand"));
  });

  it("prints help for `ext --help`", async () => {
    const { exitCode, stdout } = await runCli(["ext", "--help"]);
    assert.equal(exitCode, 0);
    assert.ok(stdout.includes("ext install"));
  });
});
