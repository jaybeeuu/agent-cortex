// Integration tests for skills/workflow/ralph/scripts/post-merge-check.mjs and the
// post-merge stage's place in the chore chain.
//
// The check reads GitHub, git, and beads, so each case runs the real script against a
// real repository and real fake binaries for the two external services. The run
// payloads are copied from real `gh run list --json` output for this repository's merged
// PRs — GitHub's shape, not the script's.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createTempRoot } from "./helpers/temp-root.mjs";
import { makeFakeBd } from "./helpers/fake-bd.mjs";
import { makeFakeGh } from "./helpers/fake-gh.mjs";
import { runCli } from "../skills/workflow/ralph/scripts/post-merge-check.mjs";

const tempRoot = createTempRoot("post-merge-check-");
const execFileAsync = promisify(execFile);

/**
 * The check's report, as the CLI printed it.
 * @typedef {object} Report
 * @property {string} outcome
 * @property {number} exitCode
 * @property {string} reason
 * @property {string} base
 * @property {string | null} repository
 * @property {string | null} commit
 * @property {Array<{ headBranch: string }>} runs
 * @property {string[]} ignoredBranches
 * @property {Array<{ name: string, url: string }>} failingJobs
 * @property {{ filed: boolean, beadId?: string, existing?: string, detail?: string }} escalation
 */

/** A bead the fake `bd` holds.
 * @typedef {object} FakeBead
 * @property {string} id
 * @property {string[]} labels
 * @property {number} priority
 * @property {string} description
 */

/** A dependency the fake `bd` holds.
 * @typedef {object} FakeDep
 * @property {string} issue_id
 * @property {string} depends_on_id
 * @property {string} type
 */

/** The fake `bd`'s state file.
 * @typedef {object} FakeBdState
 * @property {FakeBead[]} beads
 * @property {FakeDep[]} deps
 * @property {FakeDep[]} depAdds
 */

/** The outcome of one CLI run.
 * @typedef {object} RunOutcome
 * @property {number} exitCode
 * @property {Report} report
 */

const testDir = dirname(fileURLToPath(import.meta.url));
const CREATE_CHORES = join(
  testDir,
  "..",
  "skills",
  "planning",
  "create-task",
  "scripts",
  "create-chores.mjs",
);

/** Run a git command in `cwd` and return its stdout.
 * @param {string} cwd @param {string[]} args @returns {Promise<string>} */
async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf-8" });
  return stdout;
}

/** A repository checkout with an origin it can fetch from, so the check resolves a real
 * merge commit without a network. The origin is a local bare repository: `gh` is the
 * boundary the check asks about GitHub, and it is faked.
 * @param {{ defaultBranch: string }} options
 * @returns {Promise<{ workspace: string, repoRoot: string }>} */
async function createRepo({ defaultBranch }) {
  const workspace = await tempRoot.createWorkspace();
  const origin = join(workspace, "origin.git");
  await git(workspace, ["init", "--bare", "--quiet", origin]);

  const repoRoot = join(workspace, "repo");
  await git(workspace, ["init", "--quiet", repoRoot]);
  await git(repoRoot, ["config", "user.email", "test@example.com"]);
  await git(repoRoot, ["config", "user.name", "Test"]);
  // A developer's global config may enable commit signing; the fixture must not depend
  // on a secret key being present.
  await git(repoRoot, ["config", "commit.gpgsign", "false"]);
  await writeFile(join(repoRoot, "README.md"), "base\n");
  await git(repoRoot, ["add", "-A"]);
  await git(repoRoot, ["commit", "-m", "base"]);
  await git(repoRoot, ["remote", "add", "origin", origin]);
  await git(repoRoot, ["push", "--quiet", "origin", `HEAD:refs/heads/${defaultBranch}`]);
  await git(repoRoot, ["fetch", "--quiet", "origin"]);

  return { workspace, repoRoot };
}

/** A run as `gh run list --json` reports it. The default values are a real capture of
 * run 43530963969, the CI run on the merge commit of PR #238.
 * @param {object} [overrides] @returns {Record<string, unknown>} */
function createRun(overrides = {}) {
  return {
    databaseId: 43530963969,
    url: "https://github.com/jaybeeuu/agent-cortex/actions/runs/43530963969",
    workflowName: "CI",
    headBranch: "main",
    headSha: "892501976860865cb7b19116d40393588a0f776c",
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

/**
 * A check wired to a fresh repository, a fake `gh`, and a fake `bd`.
 * @typedef {object} CheckHarness
 * @property {(argv?: string[]) => Promise<RunOutcome>} run          One CLI invocation.
 * @property {() => Promise<FakeBead[]>} created                     Beads the check created.
 * @property {() => Promise<string[]>} ghCalls                       Every `gh` invocation.
 * @property {() => Promise<string[]>} bdCalls                       Every `bd` invocation.
 */

/** Build the harness. `runLists` models successive `gh run list` payloads (polling).
 * @param {object} [options]
 * @param {object[][]} [options.runLists]
 * @param {Record<string, unknown>} [options.runViews]
 * @param {string} [options.repositoryError]
 * @param {string} [options.defaultBranch]
 * @returns {Promise<CheckHarness>} */
async function createCheck({ runLists = [[]], runViews = {}, repositoryError, defaultBranch = "main" } = {}) {
  const { workspace, repoRoot } = await createRepo({ defaultBranch });
  const gh = await makeFakeGh(workspace, {
    repository: { nameWithOwner: "example/consumer", defaultBranchRef: { name: defaultBranch } },
    repositoryError,
    runLists,
    runViews,
  });
  const bd = await makeFakeBd(workspace, { beads: [] });

  const deps = {
    gh: async (/** @type {string[]} */ args) =>
      (await execFileAsync(gh.bin, args, { encoding: "utf-8", env: { ...process.env, FAKE_GH_STATE: gh.state } })).stdout,
    bd: async (/** @type {string[]} */ args) =>
      (await execFileAsync(bd.bin, args, { encoding: "utf-8", env: { ...process.env, FAKE_BD_STATE: bd.state } })).stdout,
    git: async (/** @type {string[]} */ args) => (await execFileAsync("git", args, { cwd: repoRoot, encoding: "utf-8" })).stdout,
  };

  /** @type {() => Promise<{ beads: FakeBead[], calls: string[] }>} */
  const readBd = async () => JSON.parse(await readFile(bd.state, "utf8"));
  /** @type {() => Promise<{ calls: string[] }>} */
  const readGh = async () => JSON.parse(await readFile(gh.state, "utf8"));

  return {
    run: async (argv = []) => {
      let out = "";
      const exitCode = await runCli({
        argv,
        cwd: repoRoot,
        write: (chunk) => {
          out += chunk;
        },
        deps,
      });
      return { exitCode, report: JSON.parse(out) };
    },
    created: async () => (await readBd()).beads,
    ghCalls: async () => (await readGh()).calls,
    bdCalls: async () => (await readBd()).calls,
  };
}

/** The jobs of run 41246985176, the real CI run that failed on `Test` — the shape
 * `gh run view <id> --json jobs` prints, trimmed to the fields the check reads. */
function failedRunJobs() {
  const runUrl = "https://github.com/jaybeeuu/agent-cortex/actions/runs/41246985176";
  return {
    jobs: [
      { name: "Setup", status: "completed", conclusion: "success", url: `${runUrl}/job/124672347004` },
      { name: "Lint", status: "completed", conclusion: "success", url: `${runUrl}/job/124672422883` },
      { name: "Test", status: "completed", conclusion: "failure", url: `${runUrl}/job/124672422956` },
      { name: "Release", status: "completed", conclusion: "skipped", url: `${runUrl}/job/124672552383` },
    ],
  };
}

/** The failing run, with its branch set to the base branch: a post-merge check reads the
 * merge commit on the base branch, and the real failure was captured on a feature branch.
 * @param {object} [overrides] @returns {Record<string, unknown>} */
function createFailingRun(overrides = {}) {
  return createRun({
    databaseId: 41246985176,
    url: "https://github.com/jaybeeuu/agent-cortex/actions/runs/41246985176",
    headBranch: "main",
    headSha: "92a74ddfc79bff10185e717bb53550ae44a65f81",
    conclusion: "failure",
    ...overrides,
  });
}

describe("post-merge-check", () => {
  it("exits 0 when the run for the merged commit passed", async () => {
    const check = await createCheck({ runLists: [[createRun()]] });

    const { exitCode, report } = await check.run();

    assert.equal(exitCode, 0);
    assert.equal(report.outcome, "passed");
    assert.equal(report.repository, "example/consumer");
    assert.deepEqual(await check.created(), []);
  });

  it("reads the base branch from the repository, never a hardcoded main", async () => {
    const check = await createCheck({
      defaultBranch: "trunk",
      runLists: [[createRun({ headBranch: "trunk" })]],
    });

    const { exitCode, report } = await check.run();

    assert.equal(exitCode, 0);
    assert.equal(report.base, "trunk");
  });

  it("exits 1 and files one P1 escalation carrying the run URL and failing job", async () => {
    const check = await createCheck({
      runLists: [[createFailingRun()]],
      runViews: { "41246985176": failedRunJobs() },
    });

    const { exitCode, report } = await check.run();

    assert.equal(exitCode, 1);
    assert.equal(report.outcome, "failed");
    assert.deepEqual(report.failingJobs, [
      {
        name: "Test",
        url: "https://github.com/jaybeeuu/agent-cortex/actions/runs/41246985176/job/124672422956",
      },
    ]);

    const created = await check.created();
    assert.equal(created.length, 1);
    assert.equal(created[0].priority, 1);
    assert.deepEqual([...created[0].labels].sort(), ["execution:hitl", "lifecycle:post-merge-escalation"]);
    assert.match(created[0].description, /https:\/\/github\.com\/jaybeeuu\/agent-cortex\/actions\/runs\/41246985176/);
    assert.match(created[0].description, /Failing job: Test/);
    assert.deepEqual(report.escalation, { filed: true, beadId: created[0].id });
  });

  it("files no second escalation when the check runs again", async () => {
    const check = await createCheck({
      runLists: [[createFailingRun()]],
      runViews: { "41246985176": failedRunJobs() },
    });

    await check.run();
    const { exitCode, report } = await check.run();

    assert.equal(exitCode, 1);
    assert.equal((await check.created()).length, 1);
    assert.deepEqual(report.escalation, { filed: false, existing: "bd-1" });
  });

  it("never re-runs the workflow and never writes to another bead", async () => {
    const check = await createCheck({
      runLists: [[createFailingRun()]],
      runViews: { "41246985176": failedRunJobs() },
    });

    await check.run();

    assert.ok(
      (await check.ghCalls()).every((call) => /^(repo view|run list|run view) /.test(call)),
      "the check re-ran a workflow or ran a gh command it does not need",
    );
    assert.deepEqual(
      (await check.bdCalls()).map((call) => call.split(" ")[0]),
      ["list", "create"],
    );
  });

  it("exits 2 and files nothing when no run exists for the commit", async () => {
    const check = await createCheck({ runLists: [[]] });

    const { exitCode, report } = await check.run(["--wait", "0"]);

    assert.equal(exitCode, 2);
    assert.equal(report.reason, "no-run");
    assert.deepEqual(await check.created(), []);
  });

  it("exits 2 and files nothing when the run is still in flight past the wait window", async () => {
    const check = await createCheck({
      runLists: [[createRun({ status: "in_progress", conclusion: null })]],
    });

    const { exitCode, report } = await check.run(["--wait", "0"]);

    assert.equal(exitCode, 2);
    assert.equal(report.reason, "still-running");
    assert.deepEqual(await check.created(), []);
  });

  it("exits 2 and files nothing in a repository gh cannot see as GitHub", async () => {
    const check = await createCheck({
      repositoryError:
        "none of the git remotes configured for this repository point to a known GitHub host.",
      runLists: [[createRun()]],
    });

    const { exitCode, report } = await check.run();

    assert.equal(exitCode, 2);
    assert.equal(report.reason, "no-github-repository");
    assert.deepEqual(await check.created(), []);
  });

  it("ignores runs on other branches, so release-branch noise cannot fail the merge", async () => {
    const check = await createCheck({
      runLists: [
        [
          // A real capture: these runs sit on `changeset-release/main` and finish
          // `action_required` on every release PR.
          createRun({
            headBranch: "changeset-release/main",
            conclusion: "action_required",
            databaseId: 43531106114,
          }),
          createRun(),
        ],
      ],
    });

    const { exitCode, report } = await check.run();

    assert.equal(exitCode, 0);
    assert.deepEqual(report.ignoredBranches, ["changeset-release/main"]);
  });

  it("exits 2 when a run reports no verdict, such as a cancelled run", async () => {
    const check = await createCheck({ runLists: [[createRun({ conclusion: "cancelled" })]] });

    const { exitCode, report } = await check.run();

    assert.equal(exitCode, 2);
    assert.equal(report.reason, "unrecognised-conclusion");
    assert.deepEqual(await check.created(), []);
  });
});

describe("post-merge stage wiring", () => {
  /** Expand a feature bead twice against a checkout that is not agent-cortex and whose
   * origin is not GitHub — the expansion reads no repository, so a consuming repo gets
   * the same chain.
   * @returns {Promise<{ mapping: Record<string, string>, expanded: FakeBdState, rerun: FakeBdState }>} */
  async function expandTwice() {
    const workspace = await tempRoot.createWorkspace();
    const cwd = join(workspace, "consumer");
    await git(workspace, ["init", "--quiet", cwd]);
    await git(cwd, ["remote", "add", "origin", "https://gitlab.com/example/consumer.git"]);

    const { bin, state } = await makeFakeBd(workspace, {
      beads: [{ id: "parent-1", title: "Feature", labels: ["execution:afk"] }],
    });

    /** @type {() => Promise<FakeBdState>} */
    const readState = async () => JSON.parse(await readFile(state, "utf8"));

    /** @type {(args: string[]) => Promise<{ exitCode: number, stdout: string }>} */
    const run = (args) =>
      new Promise((resolve) => {
        execFile(
          process.execPath,
          [CREATE_CHORES, ...args],
          { cwd, env: { ...process.env, BD_PATH: bin, FAKE_BD_STATE: state } },
          (error, stdout) => {
            resolve({ exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout });
          },
        );
      });

    const first = await run(["--parent", "parent-1"]);
    assert.equal(first.exitCode, 0);
    const expanded = await readState();

    const second = await run(["--parent", "parent-1"]);
    assert.equal(second.exitCode, 0);

    return { mapping: JSON.parse(first.stdout), expanded, rerun: await readState() };
  }

  it("emits post-merge blocked by the PR gate bead in a repository that is not agent-cortex", async () => {
    const { mapping, expanded, rerun } = await expandTwice();

    const postMerge = expanded.beads.find((bead) => bead.id === mapping["post-merge"]);
    assert.ok(postMerge, "the expansion created no post-merge chore");
    assert.deepEqual(
      [...postMerge.labels].sort(),
      ["execution:afk", "lifecycle:post-merge", "stage:post-merge"],
    );
    assert.deepEqual(
      expanded.deps
        .filter((dep) => dep.issue_id === mapping["post-merge"])
        .map((dep) => [dep.depends_on_id, dep.type]),
      [[mapping.featurePrReview, "blocks"]],
    );

    assert.deepEqual(rerun.depAdds, expanded.depAdds, "a second run wired no dependency");
    assert.equal(rerun.beads.length, expanded.beads.length, "a second run created no bead");
  });
});
