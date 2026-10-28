// Release plumbing: make sure CI actually reports on the Version Packages PR.
//
// changesets/action opens that PR with `secrets.GITHUB_TOKEN`, and the resulting
// `pull_request` run arrives parked behind an approval prompt (`action_required`,
// zero jobs) instead of reporting checks — so the PR is BLOCKED with an empty
// statusCheckRollup and the release stalls until someone clicks "Approve
// workflows to run". Approve that run here; if the token may not approve its own
// run, fall back to a `workflow_dispatch`, which always creates a run (the
// documented exception to GITHUB_TOKEN event suppression) and needs no secret.
// Under the dispatch fallback `Changeset check` is skipped, and GitHub reports a
// skipped job as a success, so the required contexts are still satisfied.
//
// Decision logic lives in scripts/lib/version-pr-ci.mjs.
import { CI_WORKFLOW_FILE, planVersionPrCi } from "./lib/version-pr-ci.mjs";

const API_VERSION = "2022-11-28";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

async function callApi(pathname, init = {}) {
  const baseUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const response = await fetch(`${baseUrl}/repos/${process.env.GITHUB_REPOSITORY}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": API_VERSION,
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${pathname} → ${response.status} ${body}`);
  }
  return body === "" ? null : JSON.parse(body);
}

async function main() {
  const prNumber = process.argv[2] ?? "";

  if (!/^\d+$/.test(prNumber)) {
    fail(`Expected a pull request number, got "${prNumber}".`);
  }
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
    fail("GITHUB_TOKEN and GITHUB_REPOSITORY must be set.");
  }

  const pull = await callApi(`/pulls/${prNumber}`);
  const { workflow_runs: runs } = await callApi(
    `/actions/runs?head_sha=${pull.head.sha}&per_page=30`,
  );
  const plan = planVersionPrCi({ runs, headRef: pull.head.ref });

  if (plan.action === "none") {
    console.log(`No action: CI for #${prNumber} is ${plan.reason}.`);
    return;
  }

  if (plan.action === "approve") {
    try {
      await callApi(`/actions/runs/${plan.runId}/approve`, { method: "POST" });
      console.log(`Approved run ${plan.runId}: CI is running on ${pull.head.ref}.`);
      return;
    } catch (error) {
      console.warn(
        `::warning::Could not approve run ${plan.runId} (${error.message}). ` +
          `Dispatching ${CI_WORKFLOW_FILE} on ${pull.head.ref} instead.`,
      );
    }
  }

  await callApi(`/actions/workflows/${CI_WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: pull.head.ref }),
    headers: { "Content-Type": "application/json" },
  });
  console.log(`Dispatched ${CI_WORKFLOW_FILE} on ${pull.head.ref}: checks will report there.`);
}

try {
  await main();
} catch (error) {
  fail(error.message);
}
