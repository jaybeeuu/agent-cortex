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

/**
 * The last write that had to give up detail to stay under
 * `MAX_ROLLUP_FILE_BYTES`, accumulated across writes.
 *
 * Shedding is permanent: the dropped project lists and days are gone from the
 * file, so this record is kept for the life of the store and rendered by the
 * timeline. Without it the user loses detail and is never told.
 */
export interface ShedRecord {
  /** The most recent day a write had to shed (`YYYY-MM-DD`, UTC). */
  on: string;
  /** Total skill-day project lists dropped by shedding, across writes. */
  projectLists: number;
  /** Total whole days dropped by shedding, across writes. */
  days: number;
}

export interface RollupStore {
  version: 1;
  /**
   * The first day a rollup is held for (`YYYY-MM-DD`, UTC), or null before the
   * first one. Everything before it is *unavailable* history, never zero usage.
   *
   * It survives ordinary retention pruning on purpose: the day that aged out of
   * the window was real history, and the rendered retention line explains the
   * window. It does NOT survive a ceiling shed that drops days, because those
   * days were inside the window and nothing explains their absence.
   */
  since: string | null;
  /** Day key -> skill name -> counts. */
  days: Record<string, Record<string, DaySkillCounts>>;
  /**
   * Present only after a write had to shed detail for the size ceiling. Absent
   * from every file written before this field existed, which readers must
   * tolerate: an absent record means "nothing was shed".
   */
  shed?: ShedRecord;
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
 * Upper bound on one stored project path, measured in `String.length` units. A
 * longer path is truncated with `truncateProject`, so a skill-day's record has a
 * fixed maximum size whatever the working-directory depth of the machine that
 * reports it. Two paths that share the truncated prefix count as one project.
 */
export const MAX_PROJECT_PATH_CHARS = 120;

/** Bytes a single skill-day is allowed when the budget is sized: the three
 * counts plus one realistic project path. */
const SIZE_MODEL_SKILL_DAY_BYTES = 200;

/** Skills per day assumed when the budget is sized. A sizing input, not a limit. */
const SIZE_MODEL_SKILLS = 40;

/**
 * The hard ceiling on the rollup file: 365 days x 40 skills x 200 bytes per
 * skill-day = 2,920,000 bytes. The 40 is how the budget was sized, not a bound
 * on an install: `saveRollups` enforces this byte budget on every write, so an
 * install with more skills, or with the maximum project detail on every day,
 * loses detail rather than growing past it. Growth past the ceiling is
 * impossible, not merely unexpected.
 */
export const MAX_ROLLUP_FILE_BYTES =
  DEFAULT_RETENTION_DAYS * SIZE_MODEL_SKILLS * SIZE_MODEL_SKILL_DAY_BYTES;

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

/** Truncate a project path to `MAX_PROJECT_PATH_CHARS` so one record is fixed-size. */
function truncateProject(project: string): string {
  return project.length > MAX_PROJECT_PATH_CHARS
    ? project.slice(0, MAX_PROJECT_PATH_CHARS)
    : project;
}

/**
 * Add one usage event to the day's rollup for a skill. Counts stay fixed-size
 * per skill-day, the project list is capped, and each stored path is truncated,
 * so a single day cannot grow.
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

  const stored = truncateProject(project);
  if (
    stored !== "" &&
    counts.projects.length < MAX_PROJECTS_PER_DAY &&
    !counts.projects.includes(stored)
  ) {
    counts.projects.push(stored);
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

/** What a write had to give up to stay under `MAX_ROLLUP_FILE_BYTES`. */
export interface SaveRollupsResult {
  /** Size of the file written, in bytes. Never above `MAX_ROLLUP_FILE_BYTES`. */
  bytes: number;
  /** Skill-days whose project list was dropped to stay under the ceiling. */
  shedProjectLists: number;
  /** Whole days dropped to stay under the ceiling, beyond the retention window. */
  droppedDays: number;
}

/**
 * Serialise the store, shedding detail until it fits `MAX_ROLLUP_FILE_BYTES`.
 *
 * The order is chosen so the least useful detail goes first:
 *   1. the per-skill-day project lists, which the timeline never reads — the
 *      loaded / invoked / read counts and every day survive;
 *   2. the oldest whole days, which continues the direction pruning already
 *      takes, if the counts alone exceed the budget.
 * Step 1 is the only one a realistic install can reach.
 *
 * Every shed is recorded in `store.shed` and, when whole days go, `since` moves
 * to the oldest day still held. Both are part of the bytes counted here, so the
 * record cannot push the file past the ceiling.
 */
function serialiseToBudget(
  store: RollupStore,
  on: string,
): {
  json: string;
  shedProjectLists: number;
  droppedDays: number;
} {
  let json = JSON.stringify(store);
  if (Buffer.byteLength(json, "utf-8") <= MAX_ROLLUP_FILE_BYTES) {
    return { json, shedProjectLists: 0, droppedDays: 0 };
  }

  // Written from a snapshot of the counters below, so re-applying it after each
  // pass replaces this write's contribution instead of counting it twice.
  const previousShed = store.shed;
  let shedProjectLists = 0;
  let droppedDays = 0;
  const recordShed = (): void => {
    store.shed = {
      on,
      projectLists: (previousShed?.projectLists ?? 0) + shedProjectLists,
      days: (previousShed?.days ?? 0) + droppedDays,
    };
  };

  for (const bySkill of Object.values(store.days)) {
    for (const counts of Object.values(bySkill)) {
      if (counts.projects.length > 0) {
        counts.projects = [];
        shedProjectLists++;
      }
    }
  }
  if (shedProjectLists > 0) recordShed();
  json = JSON.stringify(store);

  while (Buffer.byteLength(json, "utf-8") > MAX_ROLLUP_FILE_BYTES) {
    const dayKeys = Object.keys(store.days).sort();
    if (dayKeys.length === 0) break;
    const bytes = Buffer.byteLength(json, "utf-8");
    // Drop roughly the excess, by average day size, so a pathological store
    // converges in a few passes instead of one pass per day.
    const excess = bytes - MAX_ROLLUP_FILE_BYTES;
    const drop = Math.max(1, Math.ceil((excess / bytes) * dayKeys.length));
    for (const day of dayKeys.slice(0, drop)) {
      delete store.days[day];
      droppedDays++;
    }
    // These days were inside the retention window, so `since` must not keep
    // claiming them: move the retained start to the oldest day still held.
    store.since = oldestDay(store);
    recordShed();
    json = JSON.stringify(store);
  }

  return { json, shedProjectLists, droppedDays };
}

/**
 * Persist the rollups, pruning the retention window first. Pruning on write is
 * what keeps the file bounded: a long-lived install can never accumulate more
 * than the window's worth of days. The byte ceiling is enforced on the same
 * write, by shedding detail (see `serialiseToBudget`), so the file can never
 * grow past `MAX_ROLLUP_FILE_BYTES` even when every cap is filled.
 *
 * `now` is injectable so a caller (a test) can pin which day counts as today for
 * the prune, instead of racing the wall clock.
 */
export function saveRollups(
  store: RollupStore,
  filePath?: string,
  now: Date = new Date(),
): SaveRollupsResult {
  const target = filePath ?? rollupFilePath();
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  pruneRollups(store, now);
  store.since = store.since ?? oldestDay(store);

  const { json, shedProjectLists, droppedDays } = serialiseToBudget(store, dayKey(now));

  // Minified: this file is read by the extension, not by a human. The README
  // documents the shape, and fewer bytes means a smaller write per event.
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, json, "utf-8");
  fs.renameSync(tmp, target);

  return { bytes: Buffer.byteLength(json, "utf-8"), shedProjectLists, droppedDays };
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
