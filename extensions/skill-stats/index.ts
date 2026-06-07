import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Data model ──────────────────────────────────────────────────────────────

interface ProjectCounts {
  loadedCount: number;
  invokedCount: number;
  readCount: number;
  lastUsed: string | null;
}

interface SkillStats {
  /** Total across all projects */
  loadedCount: number;
  invokedCount: number;
  readCount: number;
  lastUsed: string | null;
  /** Per-project breakdown */
  byProject: Record<string, ProjectCounts>;
}

interface UsageStore {
  version: 1;
  skills: Record<string, SkillStats>;
  /** Cumulative total agent turns */
  totalTurns: number;
  lastUpdated: string;
  /** Debug log of recent events (capped) */
  recentEvents: RawEvent[];
}

interface RawEvent {
  timestamp: string;
  skill: string;
  source: "loaded" | "invoked" | "read";
  project: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORE_FILE = path.join(os.homedir(), ".pi", "agent-cortex", "skill-usage.json");
const MAX_RECENT_EVENTS = 200;

// ── Storage helpers ──────────────────────────────────────────────────────────

function loadStore(): UsageStore {
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as UsageStore;
    if (parsed.version === 1) return parsed;
  } catch { /* corrupt or missing — start fresh */ }
  return {
    version: 1,
    skills: {},
    totalTurns: 0,
    lastUpdated: new Date().toISOString(),
    recentEvents: [],
  };
}

function saveStore(store: UsageStore): void {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  store.lastUpdated = new Date().toISOString();
  if (store.recentEvents.length > MAX_RECENT_EVENTS) {
    store.recentEvents = store.recentEvents.slice(-MAX_RECENT_EVENTS);
  }

  // Atomic write via tmpfile
  const tmp = STORE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmp, STORE_FILE);
}

// ── Event recording ──────────────────────────────────────────────────────────

function recordUsage(
  store: UsageStore,
  skillName: string,
  source: RawEvent["source"],
  project: string,
): void {
  let skill = store.skills[skillName];
  if (!skill) {
    skill = {
      loadedCount: 0,
      invokedCount: 0,
      readCount: 0,
      lastUsed: null,
      byProject: {},
    };
    store.skills[skillName] = skill;
  }

  const now = new Date().toISOString();

  // Global counters
  switch (source) {
    case "loaded": skill.loadedCount++; break;
    case "invoked": skill.invokedCount++; break;
    case "read": skill.readCount++; break;
  }
  skill.lastUsed = now;

  // Per-project counters
  let proj = skill.byProject[project];
  if (!proj) {
    proj = { loadedCount: 0, invokedCount: 0, readCount: 0, lastUsed: null };
    skill.byProject[project] = proj;
  }
  switch (source) {
    case "loaded": proj.loadedCount++; break;
    case "invoked": proj.invokedCount++; break;
    case "read": proj.readCount++; break;
  }
  proj.lastUsed = now;

  // Event log
  store.recentEvents.push({ timestamp: now, skill: skillName, source, project });
}

// ── Skill discovery ──────────────────────────────────────────────────────────

interface SkillRecord {
  name: string;
  skillMdPath: string;
}

/** Resolve the home directory for global skill locations. */
const HOME = os.homedir();

/** Known global skill base directories. */
function globalSkillDirs(): string[] {
  return [
    path.join(HOME, ".pi", "agent", "skills"),
    path.join(HOME, ".agents", "skills"),
  ].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

/**
 * Scan a base directory for skill subdirectories containing SKILL.md.
 * Mutates `map` in place.
 */
function scanSkills(baseDir: string, map: Map<string, SkillRecord>): void {
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
function extractSkillName(skillMdPath: string): string | null {
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
function discoverProjectSkills(cwd: string, map: Map<string, SkillRecord>): void {
  // Project-local skills directories
  const projectDirs = [
    path.join(cwd, "skills"),
    path.join(cwd, ".pi", "skills"),
    path.join(cwd, ".agents", "skills"),
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
function resolveSkillFromPath(
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
  m = normalized.match(/\/(?:\.pi\/skills|\.agents\/skills)\/([^/]+)\/SKILL\.md$/);
  if (m) return m[1];

  return null;
}

// ── Rendering helpers ────────────────────────────────────────────────────────

function formatTable(header: string[], rows: string[][]): string {
  const colWidths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const sep = "─".repeat(Math.max(1, colWidths.reduce((a, b) => a + b + 3, 1) - 1));

  const fmtRow = (cells: string[]) =>
    " " + cells.map((c, i) => c.padEnd(colWidths[i])).join(" │ ");

  return [fmtRow(header), sep, ...rows.map(fmtRow)].join("\n");
}

// ── Extension entry point ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Lazy skill map, refreshed on startup and reload ─────────────────────
  let knownSkills = new Map<string, SkillRecord>();

  function refreshSkills(cwd: string): void {
    knownSkills = new Map();
    for (const d of globalSkillDirs()) scanSkills(d, knownSkills);
    discoverProjectSkills(cwd, knownSkills);
  }

  refreshSkills(process.cwd());

  // ── 1. Track skills loaded into system prompt ─────────────────────────
  pi.on("before_agent_start", async (event, ctx) => {
    const skills = event.systemPromptOptions?.skills;
    if (!skills?.length) return;

    const store = loadStore();
    const project = ctx.cwd;
    for (const skill of skills) {
      const name = typeof skill === "string" ? skill : skill.name;
      if (name) recordUsage(store, name, "loaded", project);
    }
    saveStore(store);
  });

  // ── 2. Track /skill:name invocations ──────────────────────────────────
  pi.on("input", async (event, ctx) => {
    const m = event.text.match(/^\/skill:(\S+)/);
    if (!m) return;

    const store = loadStore();
    recordUsage(store, m[1], "invoked", ctx.cwd);
    saveStore(store);
  });

  // ── 3. Track SKILL.md reads by the LLM ────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "read") return;

    const input = event.input as { path?: string } | undefined;
    const filePath = input?.path;
    if (!filePath) return;

    const skillName = resolveSkillFromPath(filePath, knownSkills);
    if (!skillName) return;

    const store = loadStore();
    recordUsage(store, skillName, "read", ctx.cwd);
    saveStore(store);
  });

  // ── 4. Track turns ────────────────────────────────────────────────────
  // Only count unique turns (not reloads). We use a simple in-memory flag
  // per reload cycle; a `/reload` resets the flag, avoiding double-counts.
  let countedTurnThisCycle = false;

  pi.on("turn_end", async (_event, _ctx) => {
    if (countedTurnThisCycle) return;
    countedTurnThisCycle = true;

    const store = loadStore();
    store.totalTurns++;
    saveStore(store);
  });

  // Reset the flag after reload so the next turn is counted
  pi.on("session_start", async () => {
    countedTurnThisCycle = false;
  });

  // ── 5. /skill-stats command ───────────────────────────────────────────
  pi.registerCommand("skill-stats", {
    description:
      "Show skill usage stats. Filter by project: /skill-stats --project <path>",
    handler: async (args, ctx) => {
      const store = loadStore();

      let projectFilter: string | null = null;
      if (args) {
        const m = args.match(/--project\s+(\S+)/);
        if (m) projectFilter = path.resolve(ctx.cwd, m[1]);
      }

      const skillNames = Object.keys(store.skills).sort();
      if (skillNames.length === 0) {
        ctx.ui.notify("No skill usage recorded yet.", "info");
        return;
      }

      // Build rows — each row is [skill, loaded, invoked, read, total, lastUsed]
      const rows: string[][] = [];
      for (const name of skillNames) {
        const s = store.skills[name];

        let loaded: number, invoked: number, read: number, lastUsed: string;
        if (projectFilter) {
          const p = s.byProject[projectFilter];
          if (!p) continue;
          loaded = p.loadedCount;
          invoked = p.invokedCount;
          read = p.readCount;
          lastUsed = p.lastUsed ? new Date(p.lastUsed).toLocaleDateString() : "-";
        } else {
          loaded = s.loadedCount;
          invoked = s.invokedCount;
          read = s.readCount;
          lastUsed = s.lastUsed ? new Date(s.lastUsed).toLocaleDateString() : "-";
        }

        const total = loaded + invoked + read;
        if (total === 0) continue; // hide zero-usage rows in filtered view

        rows.push([
          name,
          String(loaded),
          String(invoked),
          String(read),
          String(total),
          lastUsed,
        ]);
      }

      rows.sort((a, b) => Number(b[4]) - Number(a[4]));

      // ── Assemble output ──────────────────────────────────────────
      const lines: string[] = [];

      if (projectFilter) {
        lines.push(`Skill usage for project: ${projectFilter}`);
        lines.push("");
      }

      lines.push(`Total skills tracked: ${rows.length}`);
      lines.push(`Total agent turns recorded: ${store.totalTurns}`);
      lines.push("");

      if (rows.length > 0) {
        const top = rows.slice(0, 3);
        lines.push("Top 3:");
        lines.push(...top.map((r, i) => `  ${i + 1}. ${r[0]} (${r[4]} total)`));
      }

      if (rows.length > 3) {
        lines.push("");
        const bottom = rows.slice(-3);
        lines.push("Bottom 3:");
        lines.push(...bottom.map((r, i) => `  ${i + 1}. ${r[0]} (${r[4]} total)`));
      }

      lines.push("");
      lines.push(formatTable(
        ["Skill", "Loaded", "Invoked", "Read", "Total", "Last Used"],
        rows,
      ));
      lines.push("");

      // Show all projects if not filtering
      if (!projectFilter) {
        const allProjects = new Set<string>();
        for (const name of skillNames) {
          for (const proj of Object.keys(store.skills[name].byProject)) {
            allProjects.add(proj);
          }
        }
        if (allProjects.size > 1) {
          lines.push(`Projects with activity (${allProjects.size}):`);
          for (const proj of [...allProjects].sort()) {
            lines.push(`  ${proj}`);
          }
          lines.push("");
          lines.push("Filter: /skill-stats --project <path>");
        }
      }

      const output = lines.join("\n");
      ctx.ui.notify(
        `Skill stats: ${rows.length} skills. Top: ${rows[0]?.[0] ?? "-"}.`,
        "info",
      );
      console.log(output);
    },
  });

  // ── 6. /skill-usage-reset command ─────────────────────────────────────
  pi.registerCommand("skill-usage-reset", {
    description: "Delete all recorded skill usage data",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const ok = await ctx.ui.confirm(
        "Reset all skill stats?",
        "This deletes ALL recorded usage data across all projects.",
      );
      if (!ok) return;

      saveStore({
        version: 1,
        skills: {},
        totalTurns: 0,
        lastUpdated: new Date().toISOString(),
        recentEvents: [],
      });
      ctx.ui.notify("Skill usage statistics reset.", "info");
    },
  });
}
