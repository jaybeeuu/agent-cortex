// Repo convention: every SKILL.md frontmatter must parse and declare a name and
// description, because PI silently drops a skill whose frontmatter throws. Runs
// via `pnpm lint` (CI) and locally. Scans the repository root, so both skills/
// and repo-local .agents/skills/ are covered.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSkills } from "./lib/skill-frontmatter.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const { checked, failures } = await checkSkills({ root: ROOT });

if (failures.length > 0) {
  console.error("✗ Invalid SKILL.md frontmatter — PI would silently drop these skills:");
  for (const { file, errors } of failures) {
    for (const error of errors) console.error(`  ${file}: ${error}`);
  }
  process.exit(1);
}

console.log(`✓ SKILL.md frontmatter valid (${checked} files)`);
