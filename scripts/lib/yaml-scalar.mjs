// Quote handling for the two YAML-shaped files the release gate reads without a
// YAML parser: `.changeset/*.md` frontmatter and `pnpm-workspace.yaml`.
//
// Neither file can be read with the `yaml` devDependency: the CI `Changeset
// check` job runs the gate on a bare checkout with no `pnpm install`, so the
// parsers have to be dependency-free hand-rolled subsets. Both dialects allow a
// scalar to be bare, single-quoted or double-quoted, so both need the same
// dequoting rule — one implementation, so the two parsers cannot disagree about
// what `'@scope/pkg'` means.

/**
 * Strip one matching pair of single or double quotes from a YAML scalar, and trim
 * the surrounding space. A value with no matching pair is returned trimmed only.
 * @param {string} value
 * @returns {string}
 */
export function unquoteScalar(value) {
  const trimmed = value.trim();
  for (const quote of ['"', "'"]) {
    if (trimmed.length >= 2 && trimmed.startsWith(quote) && trimmed.endsWith(quote)) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}
