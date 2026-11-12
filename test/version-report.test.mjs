import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  collectVersionReport,
  formatVersionReport,
  serialiseVersionReport,
} from "../lib/harness-versions.mjs";

/** @typedef {import("../lib/harness-versions.mjs").VersionReport} VersionReport */
import { writeFingerprint } from "./helpers/harness-fingerprint.mjs";
import { createTempRoot } from "./helpers/temp-root.mjs";

const tempRoot = createTempRoot("agent-cortex-version-report-");

/** A fake home holding only the artifact roots the test asks for.
 * @param {string} workspace
 * @returns {Promise<string>}
 */
async function createHome(workspace) {
  const home = join(workspace, "home");
  await mkdir(home, { recursive: true });
  return home;
}

describe("collectVersionReport", () => {
  it("marks an installed harness older than the CLI as stale", async () => {
    const home = await createHome(await tempRoot.createWorkspace());
    await writeFingerprint(home, "pi", JSON.stringify({ version: "2.4.2" }));

    const report = await collectVersionReport({ cli: "2.5.1", home });

    assert.deepStrictEqual(report, {
      cli: "2.5.1",
      harnesses: [{ harness: "pi", installed: "2.4.2", cli: "2.5.1", staleness: "stale" }],
    });
  });

  it("marks an installed harness at the CLI version as current", async () => {
    const home = await createHome(await tempRoot.createWorkspace());
    await writeFingerprint(home, "claude", JSON.stringify({ version: "2.5.1" }));

    const report = await collectVersionReport({ cli: "2.5.1", home });

    assert.deepStrictEqual(report.harnesses, [
      { harness: "claude", installed: "2.5.1", cli: "2.5.1", staleness: "current" },
    ]);
  });

  it("marks an installed harness newer than the CLI as ahead", async () => {
    const home = await createHome(await tempRoot.createWorkspace());
    await writeFingerprint(home, "pi", JSON.stringify({ version: "2.6.0" }));

    const report = await collectVersionReport({ cli: "2.5.1", home });

    assert.deepStrictEqual(report.harnesses, [
      { harness: "pi", installed: "2.6.0", cli: "2.5.1", staleness: "ahead" },
    ]);
  });

  it("reports nothing for a harness whose artifact root does not exist", async () => {
    const home = await createHome(await tempRoot.createWorkspace());
    await writeFingerprint(home, "pi", JSON.stringify({ version: "2.5.1" }));

    const report = await collectVersionReport({ cli: "2.5.1", home });

    assert.deepStrictEqual(
      report.harnesses.map((entry) => entry.harness),
      ["pi"],
      "claude has no artifact root, so it produces no record",
    );
  });

  it("reports both installed harnesses, in the order the installers are listed", async () => {
    const home = await createHome(await tempRoot.createWorkspace());
    await writeFingerprint(home, "pi", JSON.stringify({ version: "2.4.2" }));
    await writeFingerprint(home, "claude", JSON.stringify({ version: "2.4.1" }));

    const report = await collectVersionReport({ cli: "2.5.1", home });

    assert.deepStrictEqual(report.harnesses, [
      { harness: "claude", installed: "2.4.1", cli: "2.5.1", staleness: "stale" },
      { harness: "pi", installed: "2.4.2", cli: "2.5.1", staleness: "stale" },
    ]);
  });

  it("reports unknown when the artifact root exists without a fingerprint", async () => {
    const home = await createHome(await tempRoot.createWorkspace());
    await mkdir(join(home, ".agent-cortex", "claude"), { recursive: true });

    const report = await collectVersionReport({ cli: "2.5.1", home });

    assert.deepStrictEqual(report.harnesses, [
      { harness: "claude", installed: "unknown", cli: "2.5.1", staleness: "unknown" },
    ]);
  });

  it("reports unknown when the fingerprint is not valid JSON", async () => {
    const home = await createHome(await tempRoot.createWorkspace());
    await writeFingerprint(home, "pi", "{ not json");

    const report = await collectVersionReport({ cli: "2.5.1", home });

    assert.deepStrictEqual(report.harnesses, [
      { harness: "pi", installed: "unknown", cli: "2.5.1", staleness: "unknown" },
    ]);
  });

  it("reports unknown when the fingerprint has no version string", async () => {
    const home = await createHome(await tempRoot.createWorkspace());
    await writeFingerprint(home, "pi", JSON.stringify({ name: "agent-cortex-pi" }));

    const report = await collectVersionReport({ cli: "2.5.1", home });

    assert.deepStrictEqual(report.harnesses, [
      { harness: "pi", installed: "unknown", cli: "2.5.1", staleness: "unknown" },
    ]);
  });

  it("reports unknown when the installed version is not a plain semver release", async () => {
    const home = await createHome(await tempRoot.createWorkspace());
    await writeFingerprint(home, "pi", JSON.stringify({ version: "2.4.2-rc.1" }));

    const report = await collectVersionReport({ cli: "2.5.1", home });

    assert.equal(
      report.harnesses[0].staleness,
      "unknown",
      "an uncomparable installed version is never reported as current",
    );
  });
});

describe("formatVersionReport", () => {
  it("prints the CLI version first, then one line per installed harness", async () => {
    /** @type {VersionReport} */
    const report = {
      cli: "2.5.1",
      harnesses: [
        { harness: "claude", installed: "unknown", cli: "2.5.1", staleness: "unknown" },
        { harness: "pi", installed: "2.4.2", cli: "2.5.1", staleness: "stale" },
      ],
    };

    const text = formatVersionReport(report);

    assert.equal(text, ["2.5.1", "claude unknown unknown", "pi 2.4.2 stale"].join("\n"));
  });

  it("prints only the CLI version when no harness is installed", async () => {
    assert.equal(formatVersionReport({ cli: "2.5.1", harnesses: [] }), "2.5.1");
  });
});

describe("serialiseVersionReport", () => {
  it("emits the same records as JSON", async () => {
    /** @type {VersionReport} */
    const report = {
      cli: "2.5.1",
      harnesses: [{ harness: "pi", installed: "2.4.2", cli: "2.5.1", staleness: "stale" }],
    };

    assert.deepStrictEqual(JSON.parse(serialiseVersionReport(report)), report);
  });
});
