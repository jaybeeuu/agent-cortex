import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");

function loadYaml(relPath: string): Record<string, unknown> {
  const fullPath = join(ROOT, relPath);
  assert.ok(existsSync(fullPath), `${relPath} does not exist`);
  const content = readFileSync(fullPath, "utf-8");
  return parseYaml(content) as Record<string, unknown>;
}

function loadJson(relPath: string): Record<string, unknown> {
  const fullPath = join(ROOT, relPath);
  assert.ok(existsSync(fullPath), `${relPath} does not exist`);
  const content = readFileSync(fullPath, "utf-8");
  return JSON.parse(content) as Record<string, unknown>;
}

// ─── CI Workflow ─────────────────────────────────────────────────────────────

describe("CI workflow", () => {
  const ci = loadYaml(".github/workflows/ci.yml") as Record<string, unknown>;

  it("triggers on push to main and pull requests", () => {
    const on = ci.on as Record<string, unknown>;
    assert.ok(on.push, "has push trigger");
    assert.ok("pull_request" in on, "has pull_request trigger");

    const push = on.push as Record<string, unknown>;
    assert.deepStrictEqual(push.branches, ["main"]);
  });

  it("has a job that runs on ubuntu-latest", () => {
    const jobs = ci.jobs as Record<string, unknown>;
    const jobNames = Object.keys(jobs);
    assert.ok(jobNames.length > 0, "has at least one job");

    const firstJob = jobs[jobNames[0]] as Record<string, unknown>;
    assert.equal(firstJob["runs-on"], "ubuntu-latest");
  });

  it("checks out code", () => {
    const steps = getSteps(ci);
    const checkout = steps.find(
      (s: Record<string, unknown>) => s.name === "Checkout"
    );
    assert.ok(checkout, "has Checkout step");
    const uses = (checkout as Record<string, unknown>).uses as string;
    assert.ok(uses.startsWith("actions/checkout@"), "uses actions/checkout");
  });

  it("sets up Node.js", () => {
    const steps = getSteps(ci);
    const setupNode = steps.find(
      (s: Record<string, unknown>) => s.name === "Setup Node"
    );
    assert.ok(setupNode, "has Setup Node step");
  });

  it("sets up pnpm", () => {
    const steps = getSteps(ci);
    const setupPnpm = steps.find(
      (s: Record<string, unknown>) => s.name === "Setup pnpm"
    );
    assert.ok(setupPnpm, "has Setup pnpm step");
    const uses = (setupPnpm as Record<string, unknown>).uses as string;
    assert.ok(uses.startsWith("pnpm/action-setup@"), "uses pnpm/action-setup");
  });

  it("installs dependencies", () => {
    const steps = getSteps(ci);
    const install = steps.find(
      (s: Record<string, unknown>) => s.name === "Install dependencies"
    );
    assert.ok(install, "has Install dependencies step");
  });

  it("runs lint", () => {
    const steps = getSteps(ci);
    const lint = steps.find(
      (s: Record<string, unknown>) => s.name === "Lint"
    );
    assert.ok(lint, "has Lint step");
  });

  it("runs tests", () => {
    const steps = getSteps(ci);
    const test = steps.find(
      (s: Record<string, unknown>) => s.name === "Test"
    );
    assert.ok(test, "has Test step");
  });

  it("runs build", () => {
    const steps = getSteps(ci);
    const build = steps.find(
      (s: Record<string, unknown>) => s.name === "Build"
    );
    assert.ok(build, "has Build step");
  });
});

// ─── Publish Workflow ────────────────────────────────────────────────────────

describe("Publish workflow", () => {
  const publish = loadYaml(
    ".github/workflows/publish.yml"
  ) as Record<string, unknown>;

  it("triggers on release published", () => {
    const on = publish.on as Record<string, unknown>;
    assert.ok(on.release, "has release trigger");
    const release = on.release as Record<string, unknown>;
    assert.deepStrictEqual(release.types, ["published"]);
  });

  it("has a job that runs on ubuntu-latest", () => {
    const jobs = publish.jobs as Record<string, unknown>;
    const jobNames = Object.keys(jobs);
    assert.ok(jobNames.length > 0, "has at least one job");

    const firstJob = jobs[jobNames[0]] as Record<string, unknown>;
    assert.equal(firstJob["runs-on"], "ubuntu-latest");
  });

  it("sets up Node 24 with setup-node v6 for OIDC", () => {
    const steps = getSteps(publish);
    const setupNode = steps.find(
      (s: Record<string, unknown>) => s.name === "Setup Node"
    );
    assert.ok(setupNode, "has Setup Node step");
    const uses = (setupNode as Record<string, unknown>).uses as string;
    assert.ok(uses.startsWith("actions/setup-node@v6"), "uses setup-node v6");
    const with_ = (setupNode as Record<string, unknown>).with as Record<
      string,
      unknown
    >;
    assert.equal(with_["node-version"], 24);
    assert.equal(
      with_["registry-url"],
      undefined,
      "no registry-url — OIDC auth needs no registry config"
    );
  });

  it("packs the tarball then publishes with npm", () => {
    const steps = getSteps(publish);
    const publishStep = steps.find(
      (s: Record<string, unknown>) => s.name === "Publish to npm"
    );
    assert.ok(publishStep, "has Publish to npm step");
    const run = (publishStep as Record<string, unknown>).run as string;
    assert.ok(run.includes("pnpm pack"), "packs with pnpm");
    assert.ok(run.includes("npm publish"), "publishes with npm");
    assert.ok(!run.includes("pnpm publish"), "does not publish via pnpm");
  });

  it("grants contents: read and id-token: write permissions for OIDC", () => {
    const jobs = publish.jobs as Record<string, unknown>;
    const jobNames = Object.keys(jobs);
    const job = jobs[jobNames[0]] as Record<string, unknown>;
    const permissions = job.permissions as Record<string, unknown>;
    assert.equal(permissions["contents"], "read");
    assert.equal(permissions["id-token"], "write");
  });

  it("has no NPM_TOKEN secret or NODE_AUTH_TOKEN auth", () => {
    const content = readFileSync(
      join(ROOT, ".github/workflows/publish.yml"),
      "utf-8"
    );
    assert.ok(!content.includes("NPM_TOKEN"), "no NPM_TOKEN secret reference");
    assert.ok(
      !content.includes("NODE_AUTH_TOKEN"),
      "no NODE_AUTH_TOKEN auth env"
    );
  });
});

// ─── Package.json ────────────────────────────────────────────────────────────

describe("package.json", () => {
  const pkg = loadJson("package.json") as Record<string, unknown>;

  it("is not private (publishable to npm)", () => {
    assert.equal(pkg.private, undefined, "package is not private");
  });

  it("has a build script", () => {
    const scripts = pkg.scripts as Record<string, unknown>;
    assert.ok(scripts.build, "has build script");
  });

  it("has a lint script", () => {
    const scripts = pkg.scripts as Record<string, unknown>;
    assert.ok(scripts.lint, "has lint script");
  });

  it("has publishConfig with public access", () => {
    const publishConfig = pkg.publishConfig as Record<string, unknown>;
    assert.ok(publishConfig, "has publishConfig");
    assert.equal(publishConfig.access, "public");
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSteps(workflow: Record<string, unknown>): Record<string, unknown>[] {
  const jobs = workflow.jobs as Record<string, unknown>;
  const jobNames = Object.keys(jobs);
  const firstJob = jobs[jobNames[0]] as Record<string, unknown>;
  return firstJob.steps as Record<string, unknown>[];
}
