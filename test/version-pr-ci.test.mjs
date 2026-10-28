// Behaviour tests for the decision that gets CI reporting on the Version
// Packages PR: approve a run parked behind the approval prompt, leave a run that
// is already running or done alone, and dispatch when no run was created at all.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planVersionPrCi } from "../scripts/lib/version-pr-ci.mjs";

function createRun(overrides = {}) {
  return {
    id: 1,
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

describe("planVersionPrCi", () => {
  it("approves a run parked behind the approval prompt", () => {
    const plan = planVersionPrCi({
      runs: [createRun({ id: 42, conclusion: "action_required" })],
      headRef: "changeset-release/main",
    });

    assert.deepEqual(plan, { action: "approve", runId: 42 });
  });

  it("leaves a run that already reported alone", () => {
    const plan = planVersionPrCi({
      runs: [createRun({ conclusion: "success" })],
      headRef: "changeset-release/main",
    });

    assert.deepEqual(plan, { action: "none", reason: "ci-already-reported" });
  });

  it("leaves a run that is still in flight alone", () => {
    const plan = planVersionPrCi({
      runs: [createRun({ status: "in_progress", conclusion: null })],
      headRef: "changeset-release/main",
    });

    assert.deepEqual(plan, { action: "none", reason: "ci-in-flight" });
  });

  it("dispatches on the head branch when the head commit has no CI run", () => {
    const plan = planVersionPrCi({ runs: [], headRef: "changeset-release/main" });

    assert.deepEqual(plan, { action: "dispatch", ref: "changeset-release/main" });
  });

  it("ignores runs from other workflows", () => {
    const plan = planVersionPrCi({
      runs: [createRun({ path: ".github/workflows/other.yml", conclusion: "action_required" })],
      headRef: "changeset-release/main",
    });

    assert.deepEqual(plan, { action: "dispatch", ref: "changeset-release/main" });
  });
});
