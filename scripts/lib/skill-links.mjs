// Flat-layout link rewriting for installed skills.
//
// Skills are authored in a grouped tree (skills/<group>/<name>/), so a handoff to
// a neighbouring skill is written against that tree — ../../style/style-code/SKILL.md.
// The pi installer preserves the grouping, so those paths resolve as written. The
// Claude Code plugin cannot: its scan expects skills/<name>/SKILL.md directly under
// skills/, so bin/installers/claude.mjs copies every skill flat and the authored path
// loses its group segment. Rewriting the link at copy time keeps one authored source
// that is correct in the repo and correct in both install layouts.
//
// Zero dependencies so it runs on the CI Node (20) and local Node alike.

const LINK_RE = /\]\(([^)\s]+)\)/g;
const NON_RELATIVE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;

/**
 * Rewrite relative markdown links that traverse a skill directory into flat sibling
 * references, so they resolve after the grouped tree is flattened.
 *
 * `../../style/style-code/SKILL.md` → `../style-code/SKILL.md`. Links that do not
 * traverse a skill directory (`./EXAMPLES.md`, `../tdd/tests.md`) are left alone, as
 * are schemes, absolute paths, and anchors.
 *
 * @param {string} content  Markdown file content
 * @param {Set<string> | string[]} skillNames  Every skill name in the install
 * @returns {string}
 */
export function flattenSkillLinks(content, skillNames) {
  const names = skillNames instanceof Set ? skillNames : new Set(skillNames);
  /** @param {string} match @param {string} target @returns {string} */
  return content.replace(LINK_RE, (match, target) => {
    if (NON_RELATIVE_RE.test(target)) return match;
    const segments = target.split("/");
    /** @param {string} segment @returns {boolean} */
    const isSkill = (segment) => names.has(segment);
    const skillAt = segments.findIndex(isSkill);
    // First path segment: a same-directory link, already correct when flattened.
    if (skillAt <= 0) return match;
    const rest = segments.slice(skillAt + 1);
    return `](../${[segments[skillAt], ...rest].join("/")})`;
  });
}
