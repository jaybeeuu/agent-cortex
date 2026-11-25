// Behaviour tests for the release gates: the inverted PR changeset gate and the
// no-publish release gate that keep `main` from re-publishing a version, and the
// publish gate that refuses to publish unless typecheck and tests pass.
// The decision logic is pure; the CLI adapters are exercised through their
// process boundary because that is the contract CI depends on.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLISH_COMMAND,
  NO_PUBLISH_COMMAND,
  changedChangesetPaths,
  evaluateChangesetGate,
  evaluateChangesetPackages,
  evaluateChangesetReleaseTypes,
  parseChangesetReleases,
  parseNameStatus,
  resolvePublishCommand,
} from "../scripts/lib/release-gates.mjs";
import { readWorkspacePackageNames } from "../scripts/lib/workspace-packages.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const CHECK_CHANGESET = fileURLToPath(new URL("../scripts/check-changeset.mjs", import.meta.url));
const RESOLVE_PUBLISH = fileURLToPath(
  new URL("../scripts/resolve-publish-command.mjs", import.meta.url),
);
const MANIFEST = fileURLToPath(new URL("../package.json", import.meta.url));

/** Run a script with the given argv/env, resolving with its exit code and streams.
 * @param {string} script
 * @param {{ args?: string[], env?: Record<string, string | undefined>, stdin?: string,
 *   cwd?: string }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>} */
function runScript(script, { args = [], env = {}, stdin = "", cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      cwd,
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

describe("changedChangesetPaths", () => {
  it("counts a changeset the PR adds, modifies or renames, and skips a deleted one", () => {
    const changes = parseNameStatus(
      [
        "A\t.changeset/added.md",
        "M\t.changeset/edited.md",
        "R087\t.changeset/old.md\t.changeset/renamed.md",
        "D\t.changeset/gone.md",
        "M\tpackage.json",
      ].join("\n"),
    );

    assert.deepEqual(changedChangesetPaths(changes), [
      ".changeset/added.md",
      ".changeset/edited.md",
      ".changeset/renamed.md",
    ]);
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

/** One temp root per file, removed by the helper's `after()` hook however the run ends. */
const tempRoot = createTempRoot("release-gates-");

/** Materialise a checkout the gate can run against: a pnpm workspace with a root
 * package, one member package, and the given changesets under `.changeset/`.
 * @param {Record<string, string>} changesets  file name (inside `.changeset/`) -> contents
 * @returns {Promise<string>} the workspace root, usable as the CLI's working directory
 */
async function createChangesetWorkspace(changesets) {
  const root = await tempRoot.createWorkspace();
  await mkdir(join(root, ".changeset"), { recursive: true });
  await mkdir(join(root, "packages", "app"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "."\n  - "packages/*"\n');
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "@jaybeeuu/agent-cortex" }),
  );
  await writeFile(
    join(root, "packages", "app", "package.json"),
    JSON.stringify({ name: "@jaybeeuu/agent-cortex-app" }),
  );
  for (const [file, content] of Object.entries(changesets)) {
    await writeFile(join(root, ".changeset", file), content);
  }
  return root;
}

/** Run the gate against a workspace, the way CI does: the diff for one pull request on stdin.
 * @param {string} workspace
 * @param {string} stdin
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
async function runChangesetCheck(workspace, stdin) {
  return await runScript(CHECK_CHANGESET, {
    cwd: workspace,
    stdin,
    env: { PR_LABELS: "[]", PR_HEAD_REF: "fix/changeset-gate", PR_ACTOR: "jaybeeuu" },
  });
}

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

describe("parseChangesetReleases", () => {
  it("reads a quoted scoped name with its bump type", () => {
    assert.deepEqual(parseChangesetReleases('---\n"@jaybeeuu/agent-cortex": minor\n---\n\nBody.\n'), {
      releases: [{ packageName: "@jaybeeuu/agent-cortex", releaseType: "minor" }],
      error: null,
    });
  });

  it("reads unquoted names and several releases from one changeset", () => {
    const content = "---\n@jaybeeuu/agent-cortex: patch\n'@jaybeeuu/plugin': major\n---\n\nBody.\n";

    assert.deepEqual(parseChangesetReleases(content), {
      releases: [
        { packageName: "@jaybeeuu/agent-cortex", releaseType: "patch" },
        { packageName: "@jaybeeuu/plugin", releaseType: "major" },
      ],
      error: null,
    });
  });

  it("ignores the body, including lines that contain a colon", () => {
    const content =
      '---\n"@jaybeeuu/agent-cortex": patch\n---\n\nRelease job: it fails on\nmain: see below.\n';

    assert.deepEqual(parseChangesetReleases(content), {
      releases: [{ packageName: "@jaybeeuu/agent-cortex", releaseType: "patch" }],
      error: null,
    });
  });

  it("keeps an absent release type as an empty value rather than dropping the release", () => {
    assert.deepEqual(parseChangesetReleases('---\n"@jaybeeuu/agent-cortex":\n---\n\nBody.\n'), {
      releases: [{ packageName: "@jaybeeuu/agent-cortex", releaseType: "" }],
      error: null,
    });
  });

  it("reports a changeset with no frontmatter block instead of reading no releases", () => {
    assert.deepEqual(parseChangesetReleases("Fix the gate, which passes on this file.\n"), {
      releases: [],
      error: "missing or invalid frontmatter",
    });
  });

  it("reports a frontmatter block that is never closed", () => {
    assert.deepEqual(parseChangesetReleases('---\n"@jaybeeuu/agent-cortex": patch\n\nBody.\n'), {
      releases: [],
      error: "missing or invalid frontmatter",
    });
  });

  it("reports a frontmatter line with no colon separator", () => {
    assert.deepEqual(parseChangesetReleases('---\n"@jaybeeuu/agent-cortex" patch\n---\n\nBody.\n'), {
      releases: [],
      error: `frontmatter must map package names to version types, but found: "@jaybeeuu/agent-cortex" patch`,
    });
  });

  it("reports an empty changeset file", () => {
    assert.deepEqual(parseChangesetReleases("\n\n"), {
      releases: [],
      error: "the changeset file is empty",
    });
  });
});

describe("evaluateChangesetReleaseTypes", () => {
  it("reports each release whose release type is absent, empty or unknown", () => {
    const result = evaluateChangesetReleaseTypes({
      changesets: [
        {
          file: ".changeset/no-type.md",
          releases: [
            { packageName: "@jaybeeuu/agent-cortex", releaseType: "" },
            { packageName: "@jaybeeuu/plugin", releaseType: "major2" },
          ],
        },
      ],
    });

    assert.deepEqual(result, {
      ok: false,
      invalid: [
        { file: ".changeset/no-type.md", packageName: "@jaybeeuu/agent-cortex", releaseType: "" },
        { file: ".changeset/no-type.md", packageName: "@jaybeeuu/plugin", releaseType: "major2" },
      ],
    });
  });

  it("accepts every release type changesets parses", () => {
    const releases = ["major", "minor", "patch", "none"].map((releaseType) => ({
      packageName: "@jaybeeuu/agent-cortex",
      releaseType,
    }));

    const result = evaluateChangesetReleaseTypes({
      changesets: [{ file: ".changeset/all-types.md", releases }],
    });

    assert.deepEqual(result, { ok: true, invalid: [] });
  });
});

describe("evaluateChangesetPackages", () => {
  it("reports the file and the package when a name is not in the workspace", () => {
    const result = evaluateChangesetPackages({
      changesets: [
        {
          file: ".changeset/typo.md",
          releases: [{ packageName: "@other/pkg", releaseType: "patch" }],
        },
      ],
      workspacePackages: ["@jaybeeuu/agent-cortex"],
    });

    assert.deepEqual(result, {
      ok: false,
      unknown: [{ file: ".changeset/typo.md", packageName: "@other/pkg" }],
    });
  });

  it("rejects a name that only shares a prefix with a workspace package", () => {
    const result = evaluateChangesetPackages({
      changesets: [
        {
          file: ".changeset/path.md",
          releases: [{ packageName: "@jaybeeuu/agent-cortex-app", releaseType: "patch" }],
        },
      ],
      workspacePackages: ["@jaybeeuu/agent-cortex"],
    });

    assert.equal(result.ok, false);
  });

  it("accepts every package a changeset names when all are in the workspace", () => {
    const result = evaluateChangesetPackages({
      changesets: [
        {
          file: ".changeset/one.md",
          releases: [{ packageName: "@jaybeeuu/agent-cortex", releaseType: "patch" }],
        },
        { file: ".changeset/two.md", releases: [] },
      ],
      workspacePackages: ["@jaybeeuu/agent-cortex"],
    });

    assert.deepEqual(result, { ok: true, unknown: [] });
  });
});

describe("readWorkspacePackageNames", () => {
  it("reads the root package plus every package a `dir/*` workspace entry covers", async () => {
    const workspace = await createChangesetWorkspace({});

    const names = await readWorkspacePackageNames(workspace);

    assert.deepEqual(names.slice().sort(), ["@jaybeeuu/agent-cortex", "@jaybeeuu/agent-cortex-app"]);
  });
});

describe("check-changeset CLI", () => {
  it("exits 1 naming the changeset file and the package it names when the package is not in the workspace", async () => {
    const workspace = await createChangesetWorkspace({
      "typo-scope.md": '---\n"@cryptolibertus/agent-cortex": patch\n---\n\nFix the gate.\n',
    });

    const { code, stderr } = await runChangesetCheck(workspace, "A\t.changeset/typo-scope.md\n");

    assert.equal(code, 1);
    assert.match(stderr, /\.changeset\/typo-scope\.md/);
    assert.match(stderr, /@cryptolibertus\/agent-cortex/);
  });

  it("exits 0 for a changeset naming a package declared in a workspace member", async () => {
    const workspace = await createChangesetWorkspace({
      "member-bump.md": '---\n"@jaybeeuu/agent-cortex-app": minor\n---\n\nMember change.\n',
    });

    const { code, stderr } = await runChangesetCheck(workspace, "A\t.changeset/member-bump.md\n");

    assert.equal(code, 0, stderr);
  });

  it("exits 1 when the PR modifies a changeset that names a package outside the workspace", async () => {
    const workspace = await createChangesetWorkspace({
      "added.md": '---\n"@jaybeeuu/agent-cortex": patch\n---\n\nNew change.\n',
      "edited.md": '---\n"@other/pkg": patch\n---\n\nRepaired change.\n',
    });

    const { code, stderr } = await runChangesetCheck(
      workspace,
      "A\t.changeset/added.md\nM\t.changeset/edited.md\n",
    );

    assert.equal(code, 1);
    assert.match(stderr, /\.changeset\/edited\.md/);
    assert.match(stderr, /@other\/pkg/);
  });

  it("exits 0 when the PR adds a changeset and deletes another", async () => {
    const workspace = await createChangesetWorkspace({
      "added.md": '---\n"@jaybeeuu/agent-cortex": patch\n---\n\nNew change.\n',
    });

    const { code, stderr } = await runChangesetCheck(
      workspace,
      "A\t.changeset/added.md\nD\t.changeset/gone.md\n",
    );

    assert.equal(code, 0, stderr);
  });

  it("exits 1 naming the changeset file when its frontmatter cannot be read", async (t) => {
    const shapes = {
      "no-frontmatter.md": "Fix the gate, which passes on this file.\n",
      "unclosed-block.md": '---\n"@jaybeeuu/agent-cortex": patch\n\nBody.\n',
      "no-colon.md": '---\n"@jaybeeuu/agent-cortex" patch\n---\n\nBody.\n',
      "empty.md": "",
    };
    const workspace = await createChangesetWorkspace(shapes);

    for (const file of Object.keys(shapes)) {
      await t.test(file, async () => {
        const { code, stderr } = await runChangesetCheck(workspace, `A\t.changeset/${file}\n`);

        assert.equal(code, 1, stderr);
        assert.ok(stderr.includes(`.changeset/${file}`), stderr);
      });
    }
  });

  it("exits 0 for a multi-package changeset whose packages are all in the workspace", async () => {
    const workspace = await createChangesetWorkspace({
      "two-packages.md":
        '---\n"@jaybeeuu/agent-cortex": minor\n"@jaybeeuu/agent-cortex-app": patch\n---\n\nChange both.\n',
    });

    const { code, stderr } = await runChangesetCheck(
      workspace,
      "A\t.changeset/two-packages.md\n",
    );

    assert.equal(code, 0, stderr);
  });

  it("exits 1 naming the changeset file and the package when the release type is missing", async () => {
    const workspace = await createChangesetWorkspace({
      "no-type.md": '---\n"@jaybeeuu/agent-cortex":\n---\n\nNo bump.\n',
    });

    const { code, stderr } = await runChangesetCheck(workspace, "A\t.changeset/no-type.md\n");

    assert.equal(code, 1);
    assert.match(stderr, /\.changeset\/no-type\.md/);
    assert.match(stderr, /@jaybeeuu\/agent-cortex/);
  });

  it("exits 1 naming the changeset file and the package when the release type is unknown", async () => {
    const workspace = await createChangesetWorkspace({
      "typo-type.md": '---\n"@jaybeeuu/agent-cortex": major2\n---\n\nA misspelled bump.\n',
    });

    const { code, stderr } = await runChangesetCheck(workspace, "A\t.changeset/typo-type.md\n");

    assert.equal(code, 1);
    assert.match(stderr, /\.changeset\/typo-type\.md/);
    assert.match(stderr, /@jaybeeuu\/agent-cortex/);
    assert.match(stderr, /major2/);
  });

  it("exits 1 naming the changeset file and the package when the release type is empty", async () => {
    const workspace = await createChangesetWorkspace({
      "empty-type.md": '---\n"@jaybeeuu/agent-cortex": ""\n---\n\nAn empty bump.\n',
    });

    const { code, stderr } = await runChangesetCheck(workspace, "A\t.changeset/empty-type.md\n");

    assert.equal(code, 1);
    assert.match(stderr, /\.changeset\/empty-type\.md/);
    assert.match(stderr, /@jaybeeuu\/agent-cortex/);
  });

  it("exits 0 for every release type changesets parses and a multi-line body", async (t) => {
    const shapes = {
      "patch-bump.md": '---\n"@jaybeeuu/agent-cortex": patch\n---\n\nA patch.\n',
      "minor-bump.md": '---\n"@jaybeeuu/agent-cortex": minor\n---\n\nA minor.\n',
      "major-bump.md": '---\n"@jaybeeuu/agent-cortex": major\n---\n\nA major.\n',
      "none-bump.md": '---\n"@jaybeeuu/agent-cortex": none\n---\n\nNo bump for this package.\n',
      "multi-line-body.md":
        '---\n"@jaybeeuu/agent-cortex": patch\n---\n\nA body over\nseveral lines: with a colon, and "quotes".\n',
    };
    const workspace = await createChangesetWorkspace(shapes);

    for (const file of Object.keys(shapes)) {
      await t.test(file, async () => {
        const { code, stderr } = await runChangesetCheck(workspace, `A\t.changeset/${file}\n`);

        assert.equal(code, 0, stderr);
      });
    }
  });

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
