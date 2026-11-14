import { formatTable } from "./format.js";
import {
  MAX_ROLLUP_FILE_BYTES,
  retentionDays,
  timeline,
  type RollupStore,
  type TimelineBucket,
} from "./rollup.js";

// ── Timeline rendering ───────────────────────────────────────────────────────
//
// Reads a rollup store and nothing else. Every number here comes from the
// per-day rollups, so the view works the same whether or not any session
// transcript still exists on disk.

/** How many buckets each section shows by default. */
export const DAY_BUCKETS = 14;
export const WEEK_BUCKETS = 8;
export const MONTH_BUCKETS = 12;

const TIMELINE_HEADER = ["Bucket", "Loaded", "Invoked", "Read", "Total", "Skills"];

function rows(buckets: TimelineBucket[]): string[][] {
  return buckets.map((b) => [
    b.bucket,
    String(b.loaded),
    String(b.invoked),
    String(b.read),
    String(b.total),
    String(b.skills),
  ]);
}

function section(title: string, buckets: TimelineBucket[]): string[] {
  return [title, formatTable(TIMELINE_HEADER, rows(buckets))];
}

/**
 * The line that tells the user a write gave up detail to stay under the size
 * ceiling. Rendered from the persisted record, so it survives reloads and is
 * shown where history is read, not only where it is written.
 */
function shedNotice(store: RollupStore): string | null {
  const shed = store.shed;
  if (!shed) return null;
  return (
    `Detail shed on ${shed.on}: ${shed.projectLists} project lists and ${shed.days} days ` +
    `dropped to stay under the ${MAX_ROLLUP_FILE_BYTES}-byte ceiling. ` +
    `The counts for the days that remain are complete.`
  );
}

/**
 * Render the timeline from the rollups alone. History that predates the first
 * recorded rollup is reported as unavailable: it is never zero-filled, and no
 * bucket appears for a period with no data.
 */
export function formatTimeline(store: RollupStore): string {
  const retention = retentionDays();
  const lines: string[] = ["Skill usage timeline (from daily rollups)", ""];

  if (store.since === null) {
    lines.push(
      "History unavailable: no rollup has been recorded yet.",
      "The timeline starts with the first skill event recorded after this version was installed.",
      "Older usage is not invented, and there is no backfill.",
      "",
    );
  } else {
    lines.push(
      `Rollups since ${store.since}. History before ${store.since} is unavailable (no rollup was recorded).`,
      `Retention: ${retention} days. Days older than that are pruned on every write.`,
      "",
    );
  }

  const notice = shedNotice(store);
  if (notice !== null) lines.push(notice, "");

  const days = timeline(store, "day", DAY_BUCKETS);
  const weeks = timeline(store, "week", WEEK_BUCKETS);
  const months = timeline(store, "month", MONTH_BUCKETS);

  if (days.length === 0) {
    return [...lines, "No rollup data to render."].join("\n");
  }

  lines.push(...section(`Per day (most recent ${DAY_BUCKETS}):`, days));
  lines.push("");
  lines.push(...section(`Per week (most recent ${WEEK_BUCKETS}, week starts Monday):`, weeks));
  lines.push("");
  lines.push(...section(`Per month (most recent ${MONTH_BUCKETS}):`, months));

  return lines.join("\n");
}

/** True when the `/skill-stats` argument asks for the timeline view. */
export function isTimelineRequest(args: string | undefined): boolean {
  const first = (args ?? "").trim().split(/\s+/)[0];
  return first === "timeline";
}
