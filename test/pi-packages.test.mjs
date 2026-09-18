import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadRequiredPackages,
  npmSourceName,
  planPackageInstalls,
  provisionPiPackages,
} from "../lib/pi-packages.mjs";

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function makePiRoot({ declared = [], installed = [], settingsRaw } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-packages-"));
  if (settingsRaw !== undefined) {
    await writeFile(join(root, "settings.json"), settingsRaw);
  } else if (declared.length > 0) {
    await writeFile(join(root, "settings.json"), JSON.stringify({ packages: declared }));
  }
  for (const name of installed) {
    await mkdir(join(root, "npm", "node_modules", name), { recursive: true });
  }
  return { root, cleanup: async () => rm(root, { recursive: true, force: true }) };
}

/** A runner that records every source it is asked to install. */
function recordingRunner({ results = {} } = {}) {
  const calls = [];
  const runner = async (source) => {
    calls.push(source);
    return results[source] ?? { ok: true, error: null };
  };
  return { runner, calls };
}

// ─── Manifest ────────────────────────────────────────────────────────────────

describe("loadRequiredPackages", () => {
  it("reads the declared pi packages from the package manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-packages-manifest-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "x", pi: { extensions: ["./extensions"], packages: ["npm:pi-questions"] } }),
      );
      assert.deepEqual(await loadRequiredPackages(root), ["npm:pi-questions"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns no packages when the manifest does not declare any", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-packages-manifest-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ name: "x", pi: { skills: ["./skills"] } }));
      assert.deepEqual(await loadRequiredPackages(root), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ─── Source parsing ──────────────────────────────────────────────────────────

describe("npmSourceName", () => {
  it("extracts the package name from npm sources, including scoped and pinned specs", () => {
    assert.equal(npmSourceName("npm:pi-questions"), "pi-questions");
    assert.equal(npmSourceName("npm:pi-web-access@0.10.7"), "pi-web-access");
    assert.equal(npmSourceName("npm:@scope/pkg@1.2.3"), "@scope/pkg");
  });

  it("returns null for non-npm sources it cannot verify locally", () => {
    assert.equal(npmSourceName("git:github.com/user/repo"), null);
    assert.equal(npmSourceName("./local/path"), null);
  });
});

// ─── Install plan ────────────────────────────────────────────────────────────

describe("planPackageInstalls", () => {
  it("plans nothing when every required package is declared and installed", () => {
    assert.deepEqual(
      planPackageInstalls(["npm:pi-questions"], {
        declaredSources: ["npm:pi-questions"],
        installedNames: ["pi-questions"],
      }),
      [],
    );
  });

  it("plans a package that is declared but not installed", () => {
    assert.deepEqual(
      planPackageInstalls(["npm:pi-web-access@0.10.7"], {
        declaredSources: ["npm:pi-web-access@0.10.7"],
        installedNames: [],
      }),
      ["npm:pi-web-access@0.10.7"],
    );
  });

  it("plans a package that is installed but not declared, so pi will load it", () => {
    assert.deepEqual(
      planPackageInstalls(["npm:pi-questions"], {
        declaredSources: [],
        installedNames: ["pi-questions"],
      }),
      ["npm:pi-questions"],
    );
  });
});

// ─── Provisioning ────────────────────────────────────────────────────────────

describe("provisionPiPackages", () => {
  it("installs missing packages and skips the ones already present", async () => {
    const fx = await makePiRoot({ declared: ["npm:pi-questions"], installed: ["pi-questions"] });
    try {
      const { runner, calls } = await recordingRunner();

      const result = await provisionPiPackages({
        required: ["npm:pi-questions", "npm:pi-web-access@0.10.7"],
        piRoot: fx.root,
        runInstall: runner,
      });

      assert.deepEqual(calls, ["npm:pi-web-access@0.10.7"], "only the missing package is installed");
      assert.deepEqual(result.installed, ["npm:pi-web-access@0.10.7"]);
      assert.deepEqual(result.failed, []);
    } finally {
      await fx.cleanup();
    }
  });

  it("is idempotent — a second run with everything present installs nothing", async () => {
    const fx = await makePiRoot({
      declared: ["npm:pi-questions", "npm:pi-web-access@0.10.7"],
      installed: ["pi-questions", "pi-web-access"],
    });
    try {
      const { runner, calls } = await recordingRunner();
      const result = await provisionPiPackages({
        required: ["npm:pi-questions", "npm:pi-web-access@0.10.7"],
        piRoot: fx.root,
        runInstall: runner,
      });
      assert.deepEqual(calls, []);
      assert.deepEqual(result.installed, []);
    } finally {
      await fx.cleanup();
    }
  });

  it("reports a failed install and continues with the rest", async () => {
    const fx = await makePiRoot();
    try {
      const warnings = [];
      const { runner, calls } = await recordingRunner({
        results: { "npm:pi-questions": { ok: false, error: "offline" } },
      });

      const result = await provisionPiPackages({
        required: ["npm:pi-questions", "npm:pi-web-access@0.10.7"],
        piRoot: fx.root,
        runInstall: runner,
        warn: (msg) => warnings.push(msg),
      });

      assert.deepEqual(calls, ["npm:pi-questions", "npm:pi-web-access@0.10.7"], "failure does not abort the rest");
      assert.deepEqual(result.installed, ["npm:pi-web-access@0.10.7"]);
      assert.deepEqual(result.failed, [{ source: "npm:pi-questions", error: "offline" }]);
      assert.ok(warnings.some((w) => w.includes("npm:pi-questions")), "failure is surfaced as a warning");
    } finally {
      await fx.cleanup();
    }
  });

  it("dry-run reports the plan without installing anything", async () => {
    const fx = await makePiRoot();
    try {
      const { runner, calls } = await recordingRunner();
      const result = await provisionPiPackages({
        required: ["npm:pi-questions"],
        piRoot: fx.root,
        runInstall: runner,
        dryRun: true,
      });
      assert.deepEqual(calls, []);
      assert.deepEqual(result.planned, ["npm:pi-questions"]);
      assert.deepEqual(result.installed, []);
    } finally {
      await fx.cleanup();
    }
  });

  it("treats an unreadable settings file as no declarations rather than failing the install", async () => {
    const fx = await makePiRoot({ settingsRaw: "{ not json" });
    try {
      const { runner, calls } = await recordingRunner();
      const result = await provisionPiPackages({
        required: ["npm:pi-questions"],
        piRoot: fx.root,
        runInstall: runner,
      });
      assert.deepEqual(calls, ["npm:pi-questions"], "still attempts the install");
      assert.deepEqual(result.installed, ["npm:pi-questions"]);
    } finally {
      await fx.cleanup();
    }
  });
});
