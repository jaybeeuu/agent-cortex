// Behaviour tests for the release gates: the inverted PR changeset gate and the
// no-publish release gate that keep `main` from re-publishing a version, and the
// publish gate that refuses to publish unless typecheck and tests pass.
// The decision logic is pure; the CLI adapters are exercised through their
// process boundary because that is the contract CI depends on.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLISH_COMMAND,
  NO_PUBLISH_COMMAND,
  evaluateChangesetGate,
  parseNameStatus,
  resolvePublishCommand,
} from "../scripts/lib/release-gates.mjs";

const CHECK_CHANGESET = fileURLToPath(new URL("../scripts/check-changeset.mjs", import.meta.url));
const RESOLVE_PUBLISH = fileURLToPath(
  new URL("../scripts/resolve-publish-command.mjs", import.meta.url),
);
const MANIFEST = fileURLToPath(new URL("../package.json", import.meta.url));

/** Run a script with the given argv/env, resolving with its exit code and streams.
 * @param {string} script
 * @param {{ args?: string[], env?: Record<string, string | undefined>, stdin?: string }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>} */
function runScript(script, { args = [], env = {}, stdin = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

describe("parseNameStatus", () => {
  it("parses added and modified paths from git diff --name-status output", () => {
    const changes = parseNameStatus("M\tpackage.json\nA\t.changeset/fix-release.md\n");

    assert.deepEqual(changes, [
      { status: "M", path: "package.json" },
      { status: "A", path: ".changeset/fix-release.md" },
    ]);
  });

  it("uses the new path for a rename", () => {
    const changes = parseNameStatus("R087\t.changeset/old.md\t.changeset/new.md\n");

    assert.deepEqual(changes, [{ status: "R", path: ".changeset/new.md" }]);
  });

  it("returns no changes for empty output", () => {
    assert.deepEqual(parseNameStatus(""), []);
  });
});

describe("evaluateChangesetGate", () => {
  it("passes a PR that adds a changeset", () => {
    const result = evaluateChangesetGate({
      changes: [{ status: "A", path: ".changeset/fix-release.md" }],
      labels: [],
      headRef: "fix/release-gate",
      actor: "jaybeeuu",
    });

    assert.deepEqual(result, { ok: true, reason: "changeset-added" });
  });

  it("fails a CI-only change that adds no changeset", () => {
    const result = evaluateChangesetGate({
      changes: [{ status: "M", path: ".github/workflows/ci.yml" }],
      labels: [],
      headRef: "chore/bump-pnpm",
      actor: "jaybeeuu",
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing-changeset");
  });

  it("fails a PR that only modifies an existing changeset", () => {
    const result = evaluateChangesetGate({
      changes: [{ status: "M", path: ".changeset/pending.md" }],
      labels: [],
      headRef: "chore/edit-changeset",
      actor: "jaybeeuu",
    });

    assert.equal(result.ok, false);
  });

  it("fails a PR that only adds the changeset README", () => {
    const result = evaluateChangesetGate({
      changes: [{ status: "A", path: ".changeset/README.md" }],
      labels: [],
      headRef: "docs/changesets",
      actor: "jaybeeuu",
    });

    assert.equal(result.ok, false);
  });

  it("passes an unlabelled-change PR carrying the no-publish label", () => {
    const result = evaluateChangesetGate({
      changes: [{ status: "M", path: ".github/workflows/ci.yml" }],
      labels: ["no-publish"],
      headRef: "chore/bump-pnpm",
      actor: "jaybeeuu",
    });

    assert.deepEqual(result, { ok: true, reason: "no-publish-label" });
  });

  it("passes the Version Packages PR by head branch", () => {
    const result = evaluateChangesetGate({
      changes: [{ status: "M", path: "package.json" }],
      labels: [],
      headRef: "changeset-release/main",
      actor: "jaybeeuu",
    });

    assert.deepEqual(result, { ok: true, reason: "version-packages-pr" });
  });

  it("passes a PR opened by the GitHub Actions bot", () => {
    const result = evaluateChangesetGate({
      changes: [{ status: "M", path: "package.json" }],
      labels: [],
      headRef: "automation/some-branch",
      actor: "github-actions[bot]",
    });

    assert.deepEqual(result, { ok: true, reason: "version-packages-pr" });
  });
});

describe("resolvePublishCommand", () => {
  it("publishes by default when the merged PR has no labels", () => {
    assert.equal(resolvePublishCommand([]), PUBLISH_COMMAND);
  });

  it("publishes when the merged PR carries unrelated labels", () => {
    assert.equal(resolvePublishCommand(["bug", "priority:p2"]), PUBLISH_COMMAND);
  });

  it("refuses to publish when the merged PR carries the no-publish label", () => {
    assert.equal(resolvePublishCommand(["bug", "no-publish"]), NO_PUBLISH_COMMAND);
  });

  it("matches the label exactly, not as a substring", () => {
    assert.equal(resolvePublishCommand(["no-publish-ci"]), PUBLISH_COMMAND);
  });
});

describe("check-changeset CLI", () => {
  it("exits 0 for a no-publish PR with no diff", async () => {
    const { code } = await runScript(CHECK_CHANGESET, {
      env: { PR_LABELS: '["no-publish"]', PR_HEAD_REF: "chore/bump-pnpm", PR_ACTOR: "jaybeeuu" },
    });

    assert.equal(code, 0);
  });

  it("exits 1 and explains the no-publish escape hatch for a changeset-less PR", async () => {
    const { code, stderr } = await runScript(CHECK_CHANGESET, {
      stdin: "M\tpackage.json\n",
      env: { PR_LABELS: "[]", PR_HEAD_REF: "chore/bump-pnpm", PR_ACTOR: "jaybeeuu" },
    });

    assert.equal(code, 1);
    assert.match(stderr, /no-publish/);
  });
});

describe("resolve-publish-command CLI", () => {
  it("prints the noop command for a no-publish label set", async () => {
    const { code, stdout } = await runScript(RESOLVE_PUBLISH, {
      args: ['["no-publish"]'],
    });

    assert.equal(code, 0);
    assert.equal(stdout.trim(), NO_PUBLISH_COMMAND);
  });
});

// --- publish gate -----------------------------------------------------------
//
// Publishing must not start until typecheck and tests pass. The gate is the
// composition of package.json's `verify` script, run by the `prepublishOnly`
// lifecycle hook (directory publishes) and by `publish-package` itself — the
// pack-then-`npm publish <tarball>` path changesets/action execs, and the one
// path where npm runs no publish lifecycle hook at all.
//
// So the gate is tested where it lives: the script bodies are read from the
// manifest and executed by a real shell against a fake `pnpm`/`npm` pair. The
// fakes expand script-to-script calls and stub every leaf, which keeps real
// typecheck/test runs out of the test suite and keeps `npm publish` from ever
// reaching a registry.

const FAKE_PNPM = [
  "#!/usr/bin/env node",
  "// Fake `pnpm` for the publish-gate test: records every script call, expands",
  "// script-to-script calls (the gate's composition), stubs every leaf script.",
  "const fs = require('node:fs/promises');",
  "",
  "const TARBALL = 'stub-package-0.0.0.tgz';",
  "",
  "(async () => {",
  "  const { scripts } = JSON.parse(await fs.readFile(process.env.GATE_MANIFEST, 'utf8'));",
  "  const record = (name) => fs.appendFile(process.env.GATE_LOG, 'pnpm ' + name + '\\n');",
  "",
  "  const run = async (name) => {",
  "    await record(name);",
  "    if (name === 'pack') {",
  "      console.log(TARBALL);",
  "      return 0;",
  "    }",
  "    if (name === process.env.GATE_FAIL_AT) return 1;",
  "    const body = scripts[name];",
  "    if (body === undefined) {",
  "      console.error('ERR_PNPM_NO_SCRIPT  Missing script: ' + name);",
  "      return 1;",
  "    }",
  "    const steps = body.split('&&').map((step) => step.trim());",
  "    if (!steps.every((step) => /^pnpm [\\w:.-]+$/.test(step))) return 0;",
  "    for (const step of steps) {",
  "      const code = await run(step.slice('pnpm '.length));",
  "      if (code !== 0) return code;",
  "    }",
  "    return 0;",
  "  };",
  "",
  "  process.exit(await run(process.argv[2]));",
  "})().catch((error) => {",
  "  console.error(error);",
  "  process.exit(1);",
  "});",
].join("\n");

const FAKE_NPM = [
  "#!/usr/bin/env node",
  "// Fake `npm` for the publish-gate test: records the invocation, contacts nothing.",
  "const fs = require('node:fs/promises');",
  "",
  "(async () => {",
  "  await fs.appendFile(process.env.GATE_LOG, 'npm ' + process.argv.slice(2).join(' ') + '\\n');",
  "})().catch((error) => {",
  "  console.error(error);",
  "  process.exit(1);",
  "});",
].join("\n");

/** Create a fake `pnpm`/`npm` pair in a temp dir first on PATH, recording every
 * call to `calls.log`. `failAt` makes that one script name exit 1. */
async function createPackageManagerStub({ failAt = "" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "publish-gate-"));
  const calls = join(dir, "calls.log");
  await writeFile(calls, "");
  await writeFile(join(dir, "pnpm"), `${FAKE_PNPM}\n`, { mode: 0o755 });
  await writeFile(join(dir, "npm"), `${FAKE_NPM}\n`, { mode: 0o755 });
  return {
    dir,
    calls,
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GATE_LOG: calls,
      GATE_MANIFEST: MANIFEST,
      GATE_FAIL_AT: failAt,
    },
  };
}

/** Run a package.json script body the way npm runs a lifecycle hook: `sh -c`,
 * from the stub directory so nothing real is reachable if a stub is bypassed.
 * @param {{ dir: string, env: Record<string, string | undefined> }} stub
 * @param {string} name
 * @returns {Promise<{ code: number | null, stderr: string }>} */
async function runLifecycleScript(stub, name) {
  const { scripts } = JSON.parse(await readFile(MANIFEST, "utf8"));
  const body = scripts[name];
  if (body === undefined) throw new Error(`package.json defines no \`${name}\` script`);

  return await new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", body], {
      cwd: stub.dir,
      env: { ...process.env, ...stub.env },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

/** The non-empty lines of a fake call log.
 * @param {string} log
 * @returns {Promise<string[]>} */
async function readCalls(log) {
  const text = await readFile(log, "utf8");
  return text.split("\n").filter((line) => line !== "");
}

describe("publish gate", () => {
  it("runs typecheck and the tests before a directory publish proceeds", async (t) => {
    const stub = await createPackageManagerStub();
    t.after(() => rm(stub.dir, { recursive: true, force: true }));

    const { code } = await runLifecycleScript(stub, "prepublishOnly");

    assert.equal(code, 0);
    assert.deepEqual(await readCalls(stub.calls), [
      "pnpm verify",
      "pnpm typecheck",
      "pnpm test",
    ]);
  });

  it("rejects the publish when typecheck fails, without running the tests", async (t) => {
    const stub = await createPackageManagerStub({ failAt: "typecheck" });
    t.after(() => rm(stub.dir, { recursive: true, force: true }));

    const { code } = await runLifecycleScript(stub, "prepublishOnly");

    assert.notEqual(code, 0);
    assert.deepEqual(await readCalls(stub.calls), ["pnpm verify", "pnpm typecheck"]);
  });

  it("rejects the publish when the tests fail", async (t) => {
    const stub = await createPackageManagerStub({ failAt: "test" });
    t.after(() => rm(stub.dir, { recursive: true, force: true }));

    const { code } = await runLifecycleScript(stub, "prepublishOnly");

    assert.notEqual(code, 0);
    assert.deepEqual(await readCalls(stub.calls), [
      "pnpm verify",
      "pnpm typecheck",
      "pnpm test",
    ]);
  });

  it("gates the pack-tarball publish path before any tarball is packed", async (t) => {
    const stub = await createPackageManagerStub({ failAt: "test" });
    t.after(() => rm(stub.dir, { recursive: true, force: true }));

    const { code } = await runLifecycleScript(stub, "publish-package");

    assert.notEqual(code, 0);
    assert.deepEqual(await readCalls(stub.calls), [
      "pnpm verify",
      "pnpm typecheck",
      "pnpm test",
    ]);
  });

  it("packs and publishes the tarball once both gates pass", async (t) => {
    const stub = await createPackageManagerStub();
    t.after(() => rm(stub.dir, { recursive: true, force: true }));

    const { code } = await runLifecycleScript(stub, "publish-package");

    assert.equal(code, 0);
    assert.deepEqual(await readCalls(stub.calls), [
      "pnpm verify",
      "pnpm typecheck",
      "pnpm test",
      "pnpm pack",
      "npm publish stub-package-0.0.0.tgz --provenance --access public",
    ]);
  });
});
