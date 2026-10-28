// Integration tests for scripts/lib/verify-worker-tree.mjs. The module exists to
// tell a worker that delivered from one that only said it did, so each case runs
// a real git repository and asserts the verdict — no mocking of git, because git
// is the thing whose state the verdict is about.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { verifyWorkerTree } from "../scripts/lib/verify-worker-tree.mjs";

const execFileAsync = promisify(execFile);

/** Run a git command in `cwd`. */
async function git(cwd, args) {
  await execFileAsync("git", args, { cwd });
}

/** A repository with one base commit; returns its directory and that commit. */
async function createRepo() {
  const dir = await mkdtemp(join(tmpdir(), "verify-worker-tree-"));
  await git(dir, ["init", "--quiet"]);
  await git(dir, ["config", "user.email", "t@example.com"]);
  await git(dir, ["config", "user.name", "T"]);
  // A developer's global config may enable commit signing; the fixture must not
  // depend on a secret key being present.
  await git(dir, ["config", "commit.gpgsign", "false"]);
  await writeFile(join(dir, "README.md"), "base\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "base"]);
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir });
  return { dir, base: stdout.trim() };
}

/** Commit a file in the repo, as a delivering worker would. */
async function commitWork(dir) {
  await writeFile(join(dir, "worker-output.txt"), "delivered\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "worker: deliver"]);
}

describe("verifyWorkerTree", () => {
  it("passes a worker that committed and left a clean tree", async () => {
    const { dir, base } = await createRepo();
    try {
      await commitWork(dir);

      const verdict = await verifyWorkerTree({ worktree: dir, base });

      assert.deepEqual(verdict, { ok: true, reasons: [], commitsAhead: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails a worker that reported success but left its work uncommitted", async () => {
    const { dir, base } = await createRepo();
    try {
      await writeFile(join(dir, "left-behind.txt"), "uncommitted\n");

      const verdict = await verifyWorkerTree({ worktree: dir, base });

      assert.equal(verdict.ok, false);
      assert.equal(verdict.reasons[0], "worktree is dirty: 1 uncommitted path(s)");
      assert.equal(verdict.commitsAhead, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails a worker that left a clean tree with nothing committed", async () => {
    const { dir, base } = await createRepo();
    try {
      const verdict = await verifyWorkerTree({ worktree: dir, base });

      assert.equal(verdict.ok, false);
      assert.equal(verdict.reasons.length, 1);
      assert.match(verdict.reasons[0], /^no commit ahead of base [0-9a-f]{7}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a dirty tree and a missing commit together", async () => {
    const { dir, base } = await createRepo();
    try {
      await writeFile(join(dir, "partial.txt"), "half done\n");

      const verdict = await verifyWorkerTree({ worktree: dir, base });

      assert.equal(verdict.ok, false);
      assert.equal(verdict.reasons.length, 2);
      assert.equal(verdict.reasons[0], "worktree is dirty: 1 uncommitted path(s)");
      assert.match(verdict.reasons[1], /^no commit ahead of base [0-9a-f]{7}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("counts every commit the worker made, not just the last", async () => {
    const { dir, base } = await createRepo();
    try {
      await commitWork(dir);
      await writeFile(join(dir, "second.txt"), "more\n");
      await git(dir, ["add", "-A"]);
      await git(dir, ["commit", "-m", "worker: second"]);

      const verdict = await verifyWorkerTree({ worktree: dir, base });

      assert.equal(verdict.ok, true);
      assert.equal(verdict.commitsAhead, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
