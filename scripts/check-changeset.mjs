// PR gate: a pull request must add a changeset (.changeset/*.md) unless it is
// the changesets bot's Version Packages PR or carries the `no-publish` label —
// and every release a changeset the PR adds or modifies declares must name a
// package the workspace declares, with a release type changesets parses — and a
// changeset whose frontmatter cannot be read fails the PR instead. Reads
// `git diff --name-status <base>...HEAD` on stdin and the PR metadata from the
// environment (CI supplies all three).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CHANGESET_RELEASE_TYPES,
  addedChangesetPaths,
  changedChangesetPaths,
  evaluateChangesetGate,
  evaluateChangesetPackages,
  evaluateChangesetReleaseTypes,
  parseChangesetReleases,
  parseNameStatus,
} from "./lib/release-gates.mjs";
import { readWorkspacePackageNames } from "./lib/workspace-packages.mjs";

// The checkout the gate runs against: the working directory, which is the
// repository root in CI and for every documented invocation.
const ROOT = process.cwd();

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function readLabels(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    console.error("::error::PR_LABELS must be a JSON array of label names.");
    process.exit(1);
  }
}

/**
 * Read each changeset the PR adds or modifies, the releases its frontmatter
 * declares, and the reason any of them could not be read.
 * @param {string[]} paths
 * @returns {Promise<{ changesets: { file: string, releases: { packageName: string, releaseType: string }[] }[],
 *   unreadable: string[], unparseable: { file: string, reason: string }[] }>}
 */
async function readChangesets(paths) {
  const changesets = [];
  const unreadable = [];
  const unparseable = [];
  for (const path of paths) {
    try {
      const content = await readFile(join(ROOT, path), "utf8");
      const { releases, error } = parseChangesetReleases(content);
      if (error !== null) unparseable.push({ file: path, reason: error });
      changesets.push({ file: path, releases });
    } catch {
      unreadable.push(path);
    }
  }
  return { changesets, unreadable, unparseable };
}

/**
 * @param {{ unknown: { file: string, packageName: string }[],
 *   invalidReleases: { file: string, packageName: string, releaseType: string }[],
 *   unreadable: string[], unparseable: { file: string, reason: string }[] }} problems
 */
function reportChangesetProblems({ unknown, invalidReleases, unreadable, unparseable }) {
  for (const path of unreadable) {
    console.error(`::error::Cannot read the changeset ${path}, so its packages cannot be checked.`);
  }
  for (const { file, reason } of unparseable) {
    console.error(`::error::Cannot read the frontmatter of ${file}: ${reason}.`);
  }
  for (const { file, packageName, releaseType } of invalidReleases) {
    console.error(
      `::error::${file} gives package ${packageName} the release type ` +
        `${JSON.stringify(releaseType)}; a release type must be one of ` +
        `${CHANGESET_RELEASE_TYPES.join(", ")}.`,
    );
  }
  if (invalidReleases.length > 0) {
    console.error(
      [
        "A changeset declares one release type per package: major, minor, patch or none.",
        "`changeset version` refuses any other value, so an absent, empty or misspelled",
        "type fails the Release job on main where nothing can fix it forward.",
      ].join("\n"),
    );
  }
  for (const { file, packageName } of unknown) {
    console.error(`::error::${file} names package ${packageName}, which is not in the workspace.`);
  }
  console.error(
    [
      "Every changeset this PR adds or modifies needs a frontmatter block that reads",
      "as `package: bump` pairs with a bump of " + CHANGESET_RELEASE_TYPES.join(", ") + ",",
      "and every package it names must be a `name` in a workspace package.json.",
      "`changeset version` refuses all of these, so the Release job fails on main",
      "where nothing can fix it forward — use the exact name, scope included.",
    ].join("\n"),
  );
}

const labels = readLabels(process.env.PR_LABELS ?? "[]");
const changes = parseNameStatus(await readStdin());
const result = evaluateChangesetGate({
  changes,
  labels,
  headRef: process.env.PR_HEAD_REF ?? "",
  actor: process.env.PR_ACTOR ?? "",
});

const addedChangesets = addedChangesetPaths(changes);
const changedChangesets = changedChangesetPaths(changes);

if (!result.ok) {
  console.error(
    [
      "::error::This PR adds no changeset (.changeset/*.md).",
      "Publishing is the default: write a changeset file (see the style-versioning skill)",
      "and commit it, or label the PR 'no-publish' when it genuinely ships nothing.",
    ].join("\n"),
  );
  process.exitCode = 1;
} else if (changedChangesets.length > 0) {
  const { changesets, unreadable, unparseable } = await readChangesets(changedChangesets);
  const packages = evaluateChangesetPackages({
    changesets,
    workspacePackages: await readWorkspacePackageNames(ROOT),
  });
  const releaseTypes = evaluateChangesetReleaseTypes({ changesets });

  if (packages.ok && releaseTypes.ok && unreadable.length === 0 && unparseable.length === 0) {
    console.log(`✓ Changeset gate passed (${result.reason}).`);
  } else {
    reportChangesetProblems({
      unknown: packages.unknown,
      invalidReleases: releaseTypes.invalid,
      unreadable,
      unparseable,
    });
    process.exitCode = 1;
  }
} else {
  console.log(`✓ Changeset gate passed (${result.reason}).`);
}
