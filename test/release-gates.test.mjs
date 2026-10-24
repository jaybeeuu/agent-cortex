// Behaviour tests for the release gates that keep `main` from re-publishing a
// version: the inverted PR changeset gate and the no-publish release gate.
// The decision logic is pure; the two CLI adapters are exercised through their
// process boundary because that is the contract CI depends on.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
