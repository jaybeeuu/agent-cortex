// Decision logic for getting CI onto the Version Packages PR.
//
// changesets/action pushes and opens that PR with `secrets.GITHUB_TOKEN`. GitHub
// does not skip the `pull_request` run that follows — it creates the run parked
// in an `action_required` state with zero jobs, waiting for a user with write
// access to approve it. Until that happens no check reports at all, so the PR
// sits BLOCKED with an empty statusCheckRollup and every release stalls on a
// manual click. The CLI adapter reads the PR and its runs from the API, then
// delegates the decision here.

export const CI_WORKFLOW_FILE = "ci.yml";

// Runs parked behind "Approve workflows to run". A parked run is `completed`
// with this conclusion and no jobs, so it reports nothing to the PR.
const PARKED_CONCLUSION = "action_required";

/**
 * Choose how to start CI for a pull request whose head is `headRef`, given the
 * workflow runs already recorded against its head commit.
 *
 * - `approve` — a parked run is waiting; approving it runs the canonical
 *   `pull_request` path, so every gate including `Changeset check` reports.
 * - `none` — CI is already running or has already reported.
 * - `dispatch` — no run was created at all; dispatch the workflow on
 *   `headRef`. `workflow_dispatch` is the documented exception to the
 *   GITHUB_TOKEN event-suppression rule, so it always creates a run.
 *
 * @returns {{ action: "approve", runId: number }
 *   | { action: "none", reason: string }
 *   | { action: "dispatch", ref: string }}
 */
export function planVersionPrCi({ runs, headRef }) {
  const ciRuns = runs.filter((run) => run.path === `.github/workflows/${CI_WORKFLOW_FILE}`);

  const parked = ciRuns.find((run) => run.conclusion === PARKED_CONCLUSION);
  if (parked) {
    return { action: "approve", runId: parked.id };
  }

  const reported = ciRuns.find((run) => run.conclusion !== PARKED_CONCLUSION);
  if (reported) {
    return {
      action: "none",
      reason: reported.status === "completed" ? "ci-already-reported" : "ci-in-flight",
    };
  }

  return { action: "dispatch", ref: headRef };
}
