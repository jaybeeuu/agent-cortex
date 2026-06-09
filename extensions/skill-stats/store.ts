import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Data model ──────────────────────────────────────────────────────────────

export interface ProjectCounts {
  loadedCount: number;
  invokedCount: number;
  readCount: number;
  lastUsed: string | null;
}

export interface SkillStats {
  /** Total across all projects */
  loadedCount: number;
  invokedCount: number;
  readCount: number;
  lastUsed: string | null;
  /** Per-project breakdown */
  byProject: Record<string, ProjectCounts>;
}

export interface RawEvent {
  timestamp: string;
  skill: string;
  source: "loaded" | "invoked" | "read";
  project: string;
}

export interface UsageStore {
  version: 1;
  skills: Record<string, SkillStats>;
  /** Cumulative total agent turns */
  totalTurns: number;
  lastUpdated: string;
  /** Debug log of recent events (capped) */
  recentEvents: RawEvent[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORE_FILE = path.join(os.homedir(), ".pi", "agent-cortex", "skill-usage.json");
const MAX_RECENT_EVENTS = 200;
const AGE_OUT_MS = 90 * 24 * 60 * 60 * 1000; // ~3 months in ms

// ── Age-out ──────────────────────────────────────────────────────────────────

/**
 * Remove skill entries and recent events older than ~3 months.
 * A skill with no `lastUsed` (null) is also removed.
 */
export function ageOutStore(store: UsageStore): void {
  const cutoff = Date.now() - AGE_OUT_MS;

  // Remove stale skill entries
  for (const [name, skill] of Object.entries(store.skills)) {
    if (!skill.lastUsed || new Date(skill.lastUsed).getTime() < cutoff) {
      delete store.skills[name];
    }
  }

  // Remove stale recent events
  store.recentEvents = store.recentEvents.filter(
    (e) => new Date(e.timestamp).getTime() >= cutoff,
  );
}

// ── Storage helpers ──────────────────────────────────────────────────────────

export function loadStore(filePath?: string): UsageStore {
  const target = filePath ?? STORE_FILE;
  try {
    const raw = fs.readFileSync(target, "utf-8");
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

export function saveStore(store: UsageStore, filePath?: string): void {
  const target = filePath ?? STORE_FILE;
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Age out entries older than 3 months before persisting
  ageOutStore(store);

  store.lastUpdated = new Date().toISOString();
  if (store.recentEvents.length > MAX_RECENT_EVENTS) {
    store.recentEvents = store.recentEvents.slice(-MAX_RECENT_EVENTS);
  }

  // Atomic write via tmpfile
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmp, target);
}
