// PR gate: a pull request must add a changeset (.changeset/*.md) unless it is
// the changesets bot's Version Packages PR or carries the `no-publish` label —
// and every package that a changeset the PR adds or modifies names must exist in
// the workspace. Reads `git diff --name-status <base>...HEAD` on stdin and the PR
// metadata from the environment (CI supplies all three).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  addedChangesetPaths,
  changedChangesetPaths,
  evaluateChangesetGate,
  evaluateChangesetPackages,
  parseChangesetPackages,
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
 * Read each changeset the PR adds or modifies, and the package names its
 * frontmatter bumps.
 * @param {string[]} paths
 * @returns {Promise<{ changesets: { file: string, packageNames: string[] }[], unreadable: string[] }>}
 */
async function readChangesets(paths) {
  const changesets = [];
  const unreadable = [];
  for (const path of paths) {
    try {
      const content = await readFile(join(ROOT, path), "utf8");
      changesets.push({ file: path, packageNames: parseChangesetPackages(content) });
    } catch {
      unreadable.push(path);
    }
  }
  return { changesets, unreadable };
}

/**
 * @param {{ file: string, packageName: string }[]} unknown
 * @param {string[]} unreadable
 */
function reportUnknownPackages(unknown, unreadable) {
  for (const path of unreadable) {
    console.error(`::error::Cannot read the changeset ${path}, so its packages cannot be checked.`);
  }
  for (const { file, packageName } of unknown) {
    console.error(`::error::${file} names package ${packageName}, which is not in the workspace.`);
  }
  console.error(
    [
      "Every package a changeset names must be a `name` in a workspace package.json.",
      "`changeset version` refuses an unknown package, so the Release job fails on main",
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
  const { changesets, unreadable } = await readChangesets(changedChangesets);
  const packages = evaluateChangesetPackages({
    changesets,
    workspacePackages: await readWorkspacePackageNames(ROOT),
  });

  if (packages.ok && unreadable.length === 0) {
    console.log(`✓ Changeset gate passed (${result.reason}).`);
  } else {
    reportUnknownPackages(packages.unknown, unreadable);
    process.exitCode = 1;
  }
} else {
  console.log(`✓ Changeset gate passed (${result.reason}).`);
}
