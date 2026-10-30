// Decision logic for the two release gates that stop `main` re-publishing an
// already-published version. Both gates are pure: the CLI adapters read git
// diffs, env vars, and the GitHub API, then delegate the decision here.
//
// Model: publishing is the default. The only path to "no publish" is an
// explicit `no-publish` label on the merged PR — skipping is never implicit.

export const NO_PUBLISH_LABEL = "no-publish";
export const PUBLISH_COMMAND = "pnpm publish-package";
export const NO_PUBLISH_COMMAND = "pnpm publish-noop";

// The changesets bot's Version Packages PR consumes changesets and adds none.
const VERSION_PACKAGES_HEAD_REF = "changeset-release/";
const GITHUB_ACTIONS_BOT = "github-actions[bot]";

const CHANGESET_PATH = /^\.changeset\/[^/]+\.md$/;
const CHANGESET_EXEMPT_PATHS = new Set([".changeset/README.md"]);

/**
 * Parse `git diff --name-status` output into `{ status, path }` entries, where
 * `status` is the single-letter change type and `path` is the new path.
 */
export function parseNameStatus(output) {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      return { status: status.charAt(0), path: paths.at(-1) };
    });
}

/**
 * Decide whether a pull request may skip adding a changeset. Exempt only the
 * Version Packages PR and PRs explicitly labelled `no-publish`; every other PR
 * must add its own changeset.
 */
export function evaluateChangesetGate({ changes, labels, headRef, actor }) {
  if (headRef.startsWith(VERSION_PACKAGES_HEAD_REF) || actor === GITHUB_ACTIONS_BOT) {
    return { ok: true, reason: "version-packages-pr" };
  }
  if (labels.includes(NO_PUBLISH_LABEL)) {
    return { ok: true, reason: "no-publish-label" };
  }
  if (changes.some((change) => change.status === "A" && isChangeset(change.path))) {
    return { ok: true, reason: "changeset-added" };
  }
  return { ok: false, reason: "missing-changeset" };
}

/**
 * Resolve the command changesets/action should exec for publishing, based on
 * the labels of the PR merged for the pushed commit.
 */
export function resolvePublishCommand(labels) {
  return labels.includes(NO_PUBLISH_LABEL) ? NO_PUBLISH_COMMAND : PUBLISH_COMMAND;
}

function isChangeset(path) {
  return CHANGESET_PATH.test(path) && !CHANGESET_EXEMPT_PATHS.has(path);
}
