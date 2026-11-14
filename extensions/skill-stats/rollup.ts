import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import type { RawEvent } from "./store.js";

// ── Long-range rollups ───────────────────────────────────────────────────────
//
// `store.ts` keeps per-skill counters and a 200-event ring: enough detail for
// the last few minutes, no history at all. These per-day, per-skill rollups are
// the low-fidelity half of the picture: one small record per skill per day,
// pruned on write to a stated retention window, so the file is bounded by
// construction rather than by hope.
//
// The rollups live in their own file so the high-frequency store stays small:
// the store is re-read and re-written on every tracked event, while this file
// is machine-read only (written minified) and read by the timeline view.

/** Per-skill counts for one calendar day (UTC). */
export interface DaySkillCounts {
  loaded: number;
  invoked: number;
  read: number;
  /** Distinct project paths seen that day, capped at `MAX_PROJECTS_PER_DAY`. */
  projects: string[];
}

export interface RollupStore {
  version: 1;
  /**
   * The first day a rollup was recorded (`YYYY-MM-DD`, UTC), or null before the
   * first one. Everything before it is *unavailable* history, never zero usage.
   */
  since: string | null;
  /** Day key -> skill name -> counts. */
  days: Record<string, Record<string, DaySkillCounts>>;
}

/** How long daily records are kept: one year. A documented default, not a rule. */
export const DEFAULT_RETENTION_DAYS = 365;

/**
 * Environment override for the retention window, in days. A machine that wants
 * a shorter window can set it without editing shipped code.
 */
export const RETENTION_ENV = "AGENT_CORTEX_SKILL_STATS_RETENTION_DAYS";

/** Upper bound on stored project paths per skill-day, so one day stays small. */
export const MAX_PROJECTS_PER_DAY = 50;

/**
 * The size ceiling the retention window implies: 40 skills used every day for
 * the whole window with two events each (40 x 365 x 2 events) is about 1 MB.
 * The test suite asserts the file stays under this, so growth past it means
 * pruning is broken rather than that history was legitimately longer.
 */
export const MAX_ROLLUP_FILE_BYTES = DEFAULT_RETENTION_DAYS * 40 * 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The rollup file, beside the counters, in the global agent-cortex area. */
export function rollupFilePath(): string {
  return path.join(os.homedir(), ".pi", "agent-cortex", "skill-usage-daily.json");
}

// ── Day keys ─────────────────────────────────────────────────────────────────

/** The UTC day key (`YYYY-MM-DD`) of a moment. */
export function dayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Shift a day key by whole days. Day keys sort lexicographically. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The retention window in days: the environment override, else the default. */
export function retentionDays(): number {
  const raw = process.env[RETENTION_ENV];
  const parsed = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

// ── Recording ────────────────────────────────────────────────────────────────

/**
 * Add one usage event to the day's rollup for a skill. Counts stay fixed-size
 * per skill-day and the project list is capped, so a single day cannot grow.
 */
export function recordDailyUsage(
  store: RollupStore,
  skillName: string,
  source: RawEvent["source"],
  project: string,
  now: Date = new Date(),
): void {
  const day = dayKey(now);
  let bySkill = store.days[day];
  if (!bySkill) {
    bySkill = {};
    store.days[day] = bySkill;
  }

  let counts = bySkill[skillName];
  if (!counts) {
    counts = { loaded: 0, invoked: 0, read: 0, projects: [] };
    bySkill[skillName] = counts;
  }

  switch (source) {
    case "loaded": counts.loaded++; break;
    case "invoked": counts.invoked++; break;
    case "read": counts.read++; break;
  }

  if (
    project !== "" &&
    counts.projects.length < MAX_PROJECTS_PER_DAY &&
    !counts.projects.includes(project)
  ) {
    counts.projects.push(project);
  }

  if (store.since === null || day < store.since) store.since = day;
}

// ── Retention ────────────────────────────────────────────────────────────────

/** The oldest day a store may keep: the start of the retention window. */
export function retentionCutoff(now: Date = new Date(), retention = retentionDays()): string {
  return shiftDay(dayKey(now), -(retention - 1));
}

/**
 * Drop every day outside the retention window. Returns how many days were
 * removed, so a caller can tell that pruning happened.
 */
export function pruneRollups(
  store: RollupStore,
  now: Date = new Date(),
  retention = retentionDays(),
): number {
  const cutoff = retentionCutoff(now, retention);
  let removed = 0;
  for (const day of Object.keys(store.days)) {
    if (day < cutoff) {
      delete store.days[day];
      removed++;
    }
  }
  return removed;
}

// ── Storage ──────────────────────────────────────────────────────────────────

/** The earliest day still recorded, or null for an empty store. */
export function oldestDay(store: RollupStore): string | null {
  const days = Object.keys(store.days).sort();
  return days.length > 0 ? days[0]! : null;
}

export function loadRollups(filePath?: string): RollupStore {
  const target = filePath ?? rollupFilePath();
  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf-8")) as RollupStore;
    if (parsed.version === 1 && typeof parsed.days === "object" && parsed.days !== null) {
      // A store written before `since` existed reports its earliest real day
      // rather than inventing a start date.
      parsed.since = parsed.since ?? oldestDay(parsed);
      return parsed;
    }
  } catch { /* missing or corrupt — start fresh */ }
  return { version: 1, since: null, days: {} };
}

/**
 * Persist the rollups, pruning the retention window first. Pruning on write is
 * what keeps the file bounded: a long-lived install can never accumulate more
 * than the window's worth of days.
 */
export function saveRollups(store: RollupStore, filePath?: string): void {
  const target = filePath ?? rollupFilePath();
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  pruneRollups(store);
  store.since = store.since ?? oldestDay(store);

  // Minified: this file is read by the extension, not by a human. The README
  // documents the shape, and fewer bytes means a smaller write per event.
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store), "utf-8");
  fs.renameSync(tmp, target);
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export type Granularity = "day" | "week" | "month";

export interface TimelineBucket {
  /** Day key, week-start day key (Monday), or `YYYY-MM` for a month. */
  bucket: string;
  loaded: number;
  invoked: number;
  read: number;
  total: number;
  /** Distinct skills seen anywhere inside the bucket. */
  skills: number;
}

/** The bucket a day belongs to. Weeks start on Monday, so a bucket is one 7-day span. */
export function bucketKey(day: string, granularity: Granularity): string {
  if (granularity === "day") return day;
  if (granularity === "month") return day.slice(0, 7);
  const weekday = (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7; // Monday = 0
  return shiftDay(day, -weekday);
}

/**
 * Aggregate the rollups into buckets, oldest first. `limit` keeps the most
 * recent buckets only. Reads the rollup store and nothing else: no session
 * transcripts are involved.
 */
export function timeline(
  store: RollupStore,
  granularity: Granularity,
  limit?: number,
): TimelineBucket[] {
  const buckets = new Map<
    string,
    { loaded: number; invoked: number; read: number; skills: Set<string> }
  >();

  for (const [day, bySkill] of Object.entries(store.days)) {
    const key = bucketKey(day, granularity);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { loaded: 0, invoked: 0, read: 0, skills: new Set() };
      buckets.set(key, bucket);
    }
    for (const [skill, counts] of Object.entries(bySkill)) {
      bucket.loaded += counts.loaded;
      bucket.invoked += counts.invoked;
      bucket.read += counts.read;
      bucket.skills.add(skill);
    }
  }

  const rows = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, b]) => ({
      bucket: key,
      loaded: b.loaded,
      invoked: b.invoked,
      read: b.read,
      total: b.loaded + b.invoked + b.read,
      skills: b.skills.size,
    }));

  return limit === undefined ? rows : rows.slice(-limit);
}
