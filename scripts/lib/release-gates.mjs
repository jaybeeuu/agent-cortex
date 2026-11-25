// Decision logic for the two release gates that stop `main` re-publishing an
// already-published version. Both gates are pure: the CLI adapters read git
// diffs, env vars, and the GitHub API, then delegate the decision here.
//
// Model: publishing is the default. The only path to "no publish" is an
// explicit `no-publish` label on the merged PR — skipping is never implicit.
//
// The changeset gate has two halves. The first decides whether the PR added a
// changeset at all; the second resolves what the changesets the PR adds or
// modifies declare, because `changeset version` reads the whole directory and
// refuses a frontmatter it cannot parse, an empty or undeclared package name, or
// a release type it does not know — failing the Release job on `main`, where
// nothing can fix it forward.

import { unquoteScalar } from "./yaml-scalar.mjs";

export const NO_PUBLISH_LABEL = "no-publish";
export const PUBLISH_COMMAND = "pnpm publish-package";
export const NO_PUBLISH_COMMAND = "pnpm publish-noop";

// The release types `@changesets/parse` accepts, in its order. The gate mirrors
// the list instead of importing the parser because the Changeset check job runs
// on a bare checkout with no `pnpm install` (see yaml-scalar.mjs), so a hand-rolled
// subset is the only option — one list, checked against the grammar rather than
// against a shape the hand parser happens to read.
export const CHANGESET_RELEASE_TYPES = ["major", "minor", "patch", "none"];
const RELEASE_TYPES = new Set(CHANGESET_RELEASE_TYPES);

// The changesets bot's Version Packages PR consumes changesets and adds none.
const VERSION_PACKAGES_HEAD_REF = "changeset-release/";
const GITHUB_ACTIONS_BOT = "github-actions[bot]";

const CHANGESET_PATH = /^\.changeset\/[^/]+\.md$/;
const CHANGESET_EXEMPT_PATHS = new Set([".changeset/README.md"]);
const FRONTMATTER_DELIMITER = "---";

/** @typedef {{ status: string, path: string }} NameStatusEntry */

/** @typedef {{ file: string, releases: ChangesetRelease[] }} ChangesetDeclarations */

/** @typedef {{ packageName: string, releaseType: string }} ChangesetRelease */

/** @typedef {{ file: string, packageName: string }} UnknownChangesetPackage */

/** @typedef {{ file: string, packageName: string, releaseType: string }} InvalidChangesetRelease */

/**
 * @typedef {object} ChangesetGateInput
 * @property {NameStatusEntry[]} changes
 * @property {string[]} labels
 * @property {string} headRef
 * @property {string} actor
 */

/**
 * Parse `git diff --name-status` output into `{ status, path }` entries, where
 * `status` is the single-letter change type and `path` is the new path.
 * @param {string} output
 * @returns {NameStatusEntry[]}
 */
export function parseNameStatus(output) {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      return { status: status.charAt(0), path: /** @type {string} */ (paths.at(-1)) };
    });
}

/**
 * The changesets a diff leaves in the tree: every changeset path that exists
 * after the diff, which is every status but a deletion. `changeset version`
 * reads the whole `.changeset` directory, so a changeset the PR only modified
 * breaks the Release job on `main` exactly as a new one does.
 * @param {NameStatusEntry[]} changes
 * @returns {string[]}
 */
export function changedChangesetPaths(changes) {
  return changesetPaths(changes.filter((change) => change.status !== "D"));
}

/**
 * The changesets a diff adds — the files whose presence answers the "was one
 * added" verdict.
 * @param {NameStatusEntry[]} changes
 * @returns {string[]}
 */
export function addedChangesetPaths(changes) {
  return changesetPaths(changes.filter((change) => change.status === "A"));
}

/**
 * Decide whether a pull request may skip adding a changeset. Exempt only the
 * Version Packages PR and PRs explicitly labelled `no-publish`; every other PR
 * must add its own changeset.
 * @param {ChangesetGateInput} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateChangesetGate({ changes, labels, headRef, actor }) {
  if (headRef.startsWith(VERSION_PACKAGES_HEAD_REF) || actor === GITHUB_ACTIONS_BOT) {
    return { ok: true, reason: "version-packages-pr" };
  }
  if (labels.includes(NO_PUBLISH_LABEL)) {
    return { ok: true, reason: "no-publish-label" };
  }
  if (addedChangesetPaths(changes).length > 0) {
    return { ok: true, reason: "changeset-added" };
  }
  return { ok: false, reason: "missing-changeset" };
}

/**
 * Read the release pairs a changeset's frontmatter declares, keeping the release
 * type beside the package name so a caller can check both. Only the block between
 * the two `---` delimiters is read, so a body line containing a colon is never
 * mistaken for a release.
 *
 * The parse is strict: it reports why a frontmatter block could not be read
 * instead of reading no release from it. `changeset version` reads every file in
 * `.changeset` and throws on one it cannot parse, so a changeset the PR cannot
 * parse and the gate passes fails the Release job on `main`, where nothing can
 * fix it forward.
 *
 * Each release keeps the type beside the package name, so one parse answers both
 * questions the two checks ask of a changeset: which packages it bumps, and with
 * what release type.
 * @param {string} content
 * @returns {{ releases: ChangesetRelease[], error: string | null }} the releases
 *   the frontmatter declares, and the reason there are none when it could not be
 *   read
 */
export function parseChangesetReleases(content) {
  if (content.trim() === "") {
    return { releases: [], error: "the changeset file is empty" };
  }
  const frontmatter = readFrontmatter(content);
  if (frontmatter === null) {
    return { releases: [], error: "missing or invalid frontmatter" };
  }

  const releases = [];
  for (const line of frontmatter) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      return {
        releases: [],
        error: `frontmatter must map package names to version types, but found: ${line.trim()}`,
      };
    }
    // An absent value stays an empty release type, so the grammar check reports
    // it instead of the parse dropping the release.
    releases.push({
      packageName: unquoteScalar(line.slice(0, separator)),
      releaseType: unquoteScalar(line.slice(separator + 1)),
    });
  }
  return { releases, error: null };
}

/**
 * Reject every release changesets would refuse before it reads a bump. A release
 * is a pair, so both halves are checked here: an empty package name reaches
 * `changeset version` as "invalid package name in frontmatter", and a
 * frontmatter pair with no value, a misspelled type or a quoted empty string
 * reaches it as "invalid release type". Each fails the pull request instead.
 * @param {{ changesets: ChangesetDeclarations[] }} input
 * @returns {{ ok: boolean, invalid: InvalidChangesetRelease[] }}
 */
export function evaluateChangesetReleases({ changesets }) {
  const invalid = [];
  for (const { file, releases } of changesets) {
    for (const { packageName, releaseType } of releases) {
      if (packageName === "" || !RELEASE_TYPES.has(releaseType)) {
        invalid.push({ file, packageName, releaseType });
      }
    }
  }
  return { ok: invalid.length === 0, invalid };
}

/**
 * Resolve each changeset's package names against the workspace, so a name the
 * workspace does not declare is rejected at the pull request, naming the file
 * and the package, instead of failing `changeset version` on `main`.
 * @param {{ changesets: ChangesetDeclarations[], workspacePackages: string[] }} input
 * @returns {{ ok: boolean, unknown: UnknownChangesetPackage[] }}
 */
export function evaluateChangesetPackages({ changesets, workspacePackages }) {
  const known = new Set(workspacePackages);
  const unknown = [];
  for (const { file, releases } of changesets) {
    for (const { packageName } of releases) {
      // An empty name is already reported as an invalid release, so resolving it
      // against the workspace would report the same release twice.
      if (packageName === "" || known.has(packageName)) continue;
      unknown.push({ file, packageName });
    }
  }
  return { ok: unknown.length === 0, unknown };
}

/**
 * Resolve the command changesets/action should exec for publishing, based on
 * the labels of the PR merged for the pushed commit.
 * @param {string[]} labels
 * @returns {string}
 */
export function resolvePublishCommand(labels) {
  return labels.includes(NO_PUBLISH_LABEL) ? NO_PUBLISH_COMMAND : PUBLISH_COMMAND;
}

/**
 * The lines between the opening and closing frontmatter delimiters, with blank
 * lines and comments dropped, or `null` when the block is missing or unclosed.
 * @param {string} content
 * @returns {string[] | null}
 */
function readFrontmatter(content) {
  const lines = content.split("\n");
  const opening = lines.findIndex((line) => line.trim() === FRONTMATTER_DELIMITER);
  if (opening === -1) return null;
  const closing = lines.findIndex(
    (line, index) => index > opening && line.trim() === FRONTMATTER_DELIMITER,
  );
  if (closing === -1) return null;
  return lines
    .slice(opening + 1, closing)
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
}

/**
 * The paths among `changes` that count as changesets. One predicate answers
 * "what is a changeset" for the added verdict and the package check, so the two
 * cannot drift.
 * @param {NameStatusEntry[]} changes
 * @returns {string[]}
 */
function changesetPaths(changes) {
  return changes.filter((change) => isChangeset(change.path)).map((change) => change.path);
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isChangeset(path) {
  return CHANGESET_PATH.test(path) && !CHANGESET_EXEMPT_PATHS.has(path);
}
