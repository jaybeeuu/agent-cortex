import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SkillRecord {
  name: string;
  skillMdPath: string;
}

// ── Globals ──────────────────────────────────────────────────────────────────

/** Resolve the home directory for global skill locations. */
const HOME = os.homedir();

// ── Directory discovery ─────────────────────────────────────────────────────

/** Known global skill base directories. */
export function globalSkillDirs(): string[] {
  return [
    path.join(HOME, ".pi", "agent", "skills"),
  ].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

// ── Scanning ─────────────────────────────────────────────────────────────────

/**
 * Scan a base directory for skill subdirectories containing SKILL.md.
 * Mutates `map` in place.
 */
export function scanSkills(baseDir: string, map: Map<string, SkillRecord>): void {
  let entries: string[];
  try { entries = fs.readdirSync(baseDir); } catch { return; }

  for (const entry of entries) {
    const full = path.join(baseDir, entry);
    let st: fs.Stats;
    try { st = fs.statSync(full); } catch { continue; }

    if (!st.isDirectory()) continue;

    const skillMd = path.join(full, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;

    const name = extractSkillName(skillMd) ?? entry;
    if (!map.has(name)) {
      map.set(name, { name, skillMdPath: skillMd });
    }
  }
}

/** Extract the `name` field from a skill's YAML frontmatter. */
export function extractSkillName(skillMdPath: string): string | null {
  try {
    const content = fs.readFileSync(skillMdPath, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      const fm = match[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      if (nameMatch) return nameMatch[1].trim();
    }
  } catch { /* unreadable file */ }
  return null;
}

/**
 * Lazily discover skills from the current project directory.
 * Called on startup and on `/reload`.
 */
export function discoverProjectSkills(cwd: string, map: Map<string, SkillRecord>): void {
  // Project-local skills directories
  const projectDirs = [
    path.join(cwd, "skills"),
    path.join(cwd, ".pi", "skills"),
  ].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });

  for (const d of projectDirs) scanSkills(d, map);
}

// ── Read-path resolution ─────────────────────────────────────────────────────

/**
 * Given a file path from a `read` tool call, determine whether it's
 * reading a skill's SKILL.md and return the skill name.
 *
 * Strategy:
 * 1. Exact match against pre-discovered skill SKILL.md paths
 * 2. Path heuristic: `<anything>/skills/<name>/SKILL.md` → `<name>`
 */
export function resolveSkillFromPath(
  filePath: string,
  knownSkills: Map<string, SkillRecord>,
): string | null {
  const abs = path.resolve(filePath);

  // 1. Exact match
  for (const [name, rec] of knownSkills) {
    if (abs === rec.skillMdPath) return name;
  }

  // 2. Path heuristic — includes both project-local and global skill dirs
  const normalized = abs.replace(/\\/g, "/");

  // Match .../skills/<name>/SKILL.md (project skills, nested skill dirs)
  let m = normalized.match(/\/skills\/([^/]+)\/SKILL\.md$/);
  if (m) return m[1];

  // Match .../<skill-dir>/<name>/SKILL.md for well-known dirs
  m = normalized.match(/\/(?:\.pi\/skills)\/([^/]+)\/SKILL\.md$/);
  if (m) return m[1];

  return null;
}
