// Shared manifest helpers for the install-time generators.
//
// Both installs declare where this package came from, in their own manifest: the pi package's
// `package.json` (`repository`, npm's field) and the Claude plugin's `.claude-plugin/plugin.json`
// (`repository`, which Claude accepts only as a string). Both read the same value out of this
// checkout's `package.json`, so one normaliser decides it in both places rather than two copies
// drifting apart.
//
// A generated manifest is also what the shipped `review-report` skill reads to find its feedback
// repository, so the field is behaviour, not decoration: dropping it makes `--file` fail on every
// install of the artefact.

/**
 * Normalise this package's `repository` field into the string a generated manifest declares.
 *
 * npm permits a string or an object (`{ type, url, directory }`); a value that is neither is
 * dropped rather than emitted as junk, and the installer's caller keeps walking.
 * @param {unknown} repository  parsed package.json `repository` value
 * @returns {string | undefined}
 */
export function normaliseRepository(repository) {
  if (typeof repository === "string") return repository.trim() === "" ? undefined : repository;
  if (repository === null || typeof repository !== "object") return undefined;
  const { url, directory } = /** @type {{ url?: unknown, directory?: unknown }} */ (repository);
  for (const candidate of [url, directory]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return undefined;
}
