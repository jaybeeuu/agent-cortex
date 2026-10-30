// Regression guard for the failure-path temp leak: a test file that throws after
// creating its workspace must still leave nothing behind in the system temp dir.
//
// The guarantee lives in helpers/temp-root.mjs — a file-level `after()` hook, not
// per-test cleanup — so this guard drives a real, separate test file through
// `node --test` and inspects the filesystem afterwards. A happy-path assertion
// would pass against the leaky code and prove nothing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "helpers", "fixtures", "workspace-that-throws.mjs");
const WORKSPACE_ROOT_PREFIX = "agent-cortex-failing-workspace-";

/** Entries in the system temp dir that only the fixture's temp root can create.
 * Scoped to that prefix — other test files run concurrently in their own
 * processes, so a bare `agent-cortex-*` count would race with them.
 * @returns {Promise<string[]>} */
async function fixtureRoots() {
  return (await readdir(tmpdir())).filter((name) => name.startsWith(WORKSPACE_ROOT_PREFIX));
}

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

/** Run the fixture with node's test runner, pointing it at a report file.
 * @param {string} reportPath
 * @returns {Promise<{ exitCode: number, stderr: string }>} */
function runFixture(reportPath) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, WORKSPACE_REPORT: reportPath };
  // The outer runner marks its children; inheriting the mark makes the nested
  // `node --test` skip the fixture instead of running it.
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--test", FIXTURE],
      { env },
      (error, _stdout, stderr) => {
        resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0, stderr });
      },
    );
  });
}

describe("temp workspaces", () => {
  it("removes the workspace of a test file that throws after creating it", async () => {
    const reportDir = await mkdtemp(join(tmpdir(), "agent-cortex-guard-report-"));
    try {
      const reportPath = join(reportDir, "workspace");
      const { exitCode, stderr } = await runFixture(reportPath);
      assert.equal(exitCode, 1, `the fixture must fail, or this guard proves nothing:\n${stderr}`);

      // The fixture reported the workspace only after creating it, so this path
      // genuinely existed before the run ended.
      const workspace = (await readFile(reportPath, "utf-8")).trim();
      assert.equal(await pathExists(workspace), false, `the failed test left ${workspace} behind`);
      assert.deepEqual(await fixtureRoots(), [], "a failing test grew the agent-cortex-* set in tmpdir()");
    } finally {
      await rm(reportDir, { recursive: true, force: true });
    }
  });
});
