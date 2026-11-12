// The read side of the installers' fingerprints: `ctx version` reports which
// harnesses are installed and how their version compares with the running CLI.
//
// Read-only by construction — the module only stats and reads, so the command
// path never writes, installs, or reaches the network. A harness with no
// installer gets no entry in the table, so it can never appear in the report.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDirectory } from "../scripts/lib/fs.mjs";

/**
 * Where one harness records the version it was installed at: an artifact root
 * under the home install directory, and the version file inside it.
 * @typedef {object} HarnessFingerprint
 * @property {"claude" | "pi"} harness
 * @property {string[]} root Path segments of the artifact root, relative to home
 * @property {string[]} file Path segments of the version file, relative to the root
 */

// Ordered as the installers are listed; the report keeps this order.
/** @type {HarnessFingerprint[]} */
const HARNESS_FINGERPRINTS = [
  { harness: "claude", root: [".agent-cortex", "claude"], file: [".claude-plugin", "plugin.json"] },
  { harness: "pi", root: [".agent-cortex", "pi"], file: ["package.json"] },
];

/**
 * How an installed copy relates to the running CLI. `unknown` covers both a
 * fingerprint that cannot be read and a version that is not a plain release —
 * an unreadable install is never reported as `current`. `missing` means the
 * harness has no artifact root at all: it was never installed.
 * @typedef {"current" | "stale" | "ahead" | "unknown" | "missing"} Staleness
 */

/**
 * One installed harness in the report.
 * @typedef {object} HarnessVersion
 * @property {string} harness
 * @property {string} installed The installed version, or "unknown"
 * @property {string} cli The running CLI version
 * @property {Staleness} staleness
 */

/**
 * Everything the `version` command reports.
 * @typedef {object} VersionReport
 * @property {string} cli The running CLI version
 * @property {HarnessVersion[]} harnesses One entry per installed harness
 */

const UNKNOWN = "unknown";

// Only plain releases are compared. A prerelease or a range is not "current"
// just because its numeric core matches, so it reports unknown instead.
const PLAIN_RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Compare two plain semver releases.
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1 | null} The order, or null when either side is not a plain release
 */
function compareReleases(a, b) {
  const left = PLAIN_RELEASE.exec(a);
  const right = PLAIN_RELEASE.exec(b);
  if (left === null || right === null) return null;
  for (let segment = 1; segment <= 3; segment++) {
    const l = Number(left[segment]);
    const r = Number(right[segment]);
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/**
 * @param {string | null} installed null when the fingerprint is unreadable
 * @param {string} cli
 * @returns {Staleness}
 */
function stalenessOf(installed, cli) {
  if (installed === null) return "unknown";
  const order = compareReleases(installed, cli);
  if (order === null) return "unknown";
  if (order < 0) return "stale";
  return order > 0 ? "ahead" : "current";
}

/**
 * Read the version one harness recorded at install time.
 * @param {string} home
 * @param {HarnessFingerprint} fingerprint
 * @returns {Promise<{ installed: boolean, version: string | null }>} `installed`
 *   is false when the artifact root is absent; `version` is null when the
 *   fingerprint is missing, malformed, or carries no version string
 */
async function readInstalledVersion(home, fingerprint) {
  const root = join(home, ...fingerprint.root);
  if (!(await isDirectory(root))) return { installed: false, version: null };
  try {
    /** @type {{ version?: unknown }} */
    const manifest = JSON.parse(await readFile(join(root, ...fingerprint.file), "utf-8"));
    const version = manifest?.version;
    return { installed: true, version: typeof version === "string" && version !== "" ? version : null };
  } catch {
    return { installed: true, version: null };
  }
}

/**
 * One harness in the update table: unlike a report entry, every supported
 * harness appears, so an absent install shows as `installed: null` / `missing`.
 * @typedef {object} HarnessStatus
 * @property {string} harness
 * @property {string | null} installed The installed version, or null when the harness is not installed
 * @property {string} cli The running CLI version
 * @property {Staleness} staleness
 */

/**
 * Report the running CLI version and the installed version of every harness
 * whose artifact root exists.
 * @param {{ cli: string, home?: string }} options `home` defaults to the real
 *   home directory; tests pass a fixture directory
 * @returns {Promise<VersionReport>}
 */
export async function collectVersionReport({ cli, home = homedir() }) {
  /** @type {HarnessVersion[]} */
  const harnesses = [];
  for (const fingerprint of HARNESS_FINGERPRINTS) {
    const { installed, version } = await readInstalledVersion(home, fingerprint);
    if (!installed) continue;
    harnesses.push({
      harness: fingerprint.harness,
      installed: version ?? UNKNOWN,
      cli,
      staleness: stalenessOf(version, cli),
    });
  }
  return { cli, harnesses };
}

/**
 * Read the status of every harness, including the ones that are not installed:
 * `ctx update` selects from this full list, so a harness with no artifact root
 * is reported as missing rather than omitted.
 * @param {{ cli: string, home?: string }} options `home` defaults to the real
 *   home directory; tests pass a fixture directory
 * @returns {Promise<HarnessStatus[]>}
 */
export async function collectHarnessStatus({ cli, home = homedir() }) {
  /** @type {HarnessStatus[]} */
  const statuses = [];
  for (const fingerprint of HARNESS_FINGERPRINTS) {
    const { installed, version } = await readInstalledVersion(home, fingerprint);
    statuses.push({
      harness: fingerprint.harness,
      installed: version,
      cli,
      staleness: installed ? stalenessOf(version, cli) : "missing",
    });
  }
  return statuses;
}

/**
 * Render the report as the default, human-readable output: the CLI version on
 * the first line, then one line per installed harness. A harness whose version
 * could not be read prints `unknown` twice — once for the version and once for
 * the marker, because neither is known.
 * @param {VersionReport} report
 * @returns {string} Text without a trailing newline
 */
export function formatVersionReport(report) {
  const lines = [report.cli];
  for (const entry of report.harnesses) {
    lines.push(`${entry.harness} ${entry.installed} ${entry.staleness}`);
  }
  return lines.join("\n");
}

/**
 * Render the report as JSON, one record per installed harness.
 * @param {VersionReport} report
 * @returns {string} JSON without a trailing newline
 */
export function serialiseVersionReport(report) {
  return JSON.stringify(report, null, 2);
}
