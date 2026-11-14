import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTempRoot } from "../../test/helpers/temp-root.mjs";

import {
  DEFAULT_RETENTION_DAYS,
  MAX_PROJECT_PATH_CHARS,
  MAX_PROJECTS_PER_DAY,
  MAX_ROLLUP_FILE_BYTES,
  RETENTION_ENV,
  bucketKey,
  dayKey,
  loadRollups,
  oldestDay,
  pruneRollups,
  recordDailyUsage,
  retentionCutoff,
  retentionDays,
  saveRollups,
  shiftDay,
  timeline,
  type RollupStore,
} from "./index.ts";
import { formatTimeline, isTimelineRequest } from "./timeline.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const tempRoot = createTempRoot("skill-stats-rollup-");

function freshRollups(): RollupStore {
  return { version: 1, since: null, days: {} };
}

/** A moment inside a named UTC day. */
function at(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

/**
 * Five events across four days, two weeks and two months:
 *   2026-06-01 bd-tool loaded
 *   2026-06-02 bd-tool read, style-code invoked
 *   2026-06-08 bd-tool read
 *   2026-07-01 write-a-prd loaded
 */
function fixtureRollups(): RollupStore {
  const store = freshRollups();
  recordDailyUsage(store, "bd-tool", "loaded", "/proj/a", at("2026-06-01"));
  recordDailyUsage(store, "bd-tool", "read", "/proj/a", at("2026-06-02"));
  recordDailyUsage(store, "style-code", "invoked", "/proj/b", at("2026-06-02"));
  recordDailyUsage(store, "bd-tool", "read", "/proj/a", at("2026-06-08"));
  recordDailyUsage(store, "write-a-prd", "loaded", "/proj/a", at("2026-07-01"));
  return store;
}

async function withRetentionEnv<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env[RETENTION_ENV];
  if (value === undefined) delete process.env[RETENTION_ENV];
  else process.env[RETENTION_ENV] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[RETENTION_ENV];
    else process.env[RETENTION_ENV] = previous;
  }
}

// ─── Recording ───────────────────────────────────────────────────────────────

describe("recordDailyUsage", () => {
  it("keeps one record per skill per day", () => {
    const store = freshRollups();
    recordDailyUsage(store, "bd-tool", "loaded", "/proj/a", at("2026-06-01"));
    recordDailyUsage(store, "bd-tool", "loaded", "/proj/a", at("2026-06-01"));
    recordDailyUsage(store, "bd-tool", "read", "/proj/a", at("2026-06-01"));

    assert.deepEqual(Object.keys(store.days), ["2026-06-01"]);
    assert.deepEqual(Object.keys(store.days["2026-06-01"]!), ["bd-tool"]);
    assert.equal(store.days["2026-06-01"]!["bd-tool"]!.loaded, 2);
    assert.equal(store.days["2026-06-01"]!["bd-tool"]!.read, 1);
    assert.equal(store.days["2026-06-01"]!["bd-tool"]!.invoked, 0);
  });

  it("separates the same skill into one record per day", () => {
    const store = freshRollups();
    recordDailyUsage(store, "bd-tool", "read", "/proj/a", at("2026-06-01"));
    recordDailyUsage(store, "bd-tool", "read", "/proj/a", at("2026-06-02"));

    assert.equal(store.days["2026-06-01"]!["bd-tool"]!.read, 1);
    assert.equal(store.days["2026-06-02"]!["bd-tool"]!.read, 1);
  });

  it("counts each project once per skill-day", () => {
    const store = freshRollups();
    recordDailyUsage(store, "bd-tool", "read", "/proj/a", at("2026-06-01"));
    recordDailyUsage(store, "bd-tool", "read", "/proj/a", at("2026-06-01"));
    recordDailyUsage(store, "bd-tool", "read", "/proj/b", at("2026-06-01"));

    assert.deepEqual(store.days["2026-06-01"]!["bd-tool"]!.projects, ["/proj/a", "/proj/b"]);
  });

  it("caps the project list so one skill-day cannot grow", () => {
    const store = freshRollups();
    for (let i = 0; i < MAX_PROJECTS_PER_DAY + 20; i++) {
      recordDailyUsage(store, "bd-tool", "read", `/proj/${i}`, at("2026-06-01"));
    }

    const counts = store.days["2026-06-01"]!["bd-tool"]!;
    assert.equal(counts.projects.length, MAX_PROJECTS_PER_DAY);
    assert.equal(counts.read, MAX_PROJECTS_PER_DAY + 20);
  });

  it("truncates a project path, so one record has a fixed maximum size", () => {
    const store = freshRollups();
    const long = `/home/user/${"nested/".repeat(40)}project`;
    assert.ok(long.length > MAX_PROJECT_PATH_CHARS, "the fixture must be longer than the cap");

    recordDailyUsage(store, "bd-tool", "read", long, at("2026-06-01"));

    const projects = store.days["2026-06-01"]!["bd-tool"]!.projects;
    assert.equal(projects.length, 1);
    assert.equal(projects[0]!.length, MAX_PROJECT_PATH_CHARS);
    assert.ok(long.startsWith(projects[0]!), "the head of the path is kept");

    // A longer path that shares the truncated prefix is the same project, not a
    // second one: that collision is the cost of the fixed-size record.
    recordDailyUsage(store, "bd-tool", "read", `${long}-other`, at("2026-06-01"));
    assert.equal(store.days["2026-06-01"]!["bd-tool"]!.projects.length, 1);
  });

  it("records the first day as `since` and keeps the earliest", () => {
    const store = freshRollups();
    assert.equal(store.since, null);

    recordDailyUsage(store, "bd-tool", "read", "/proj/a", at("2026-06-02"));
    assert.equal(store.since, "2026-06-02");

    recordDailyUsage(store, "bd-tool", "read", "/proj/a", at("2026-06-01"));
    assert.equal(store.since, "2026-06-01");
  });
});

// ─── Retention ───────────────────────────────────────────────────────────────

describe("retention", () => {
  it("defaults to one year and honours the environment override", async () => {
    await withRetentionEnv(undefined, async () => {
      assert.equal(retentionDays(), DEFAULT_RETENTION_DAYS);
      assert.equal(DEFAULT_RETENTION_DAYS, 365);
    });

    await withRetentionEnv("30", async () => {
      assert.equal(retentionDays(), 30);
    });

    for (const nonsense of ["", "0", "-5", "not-a-number", "2.5"]) {
      await withRetentionEnv(nonsense, async () => {
        assert.equal(retentionDays(), DEFAULT_RETENTION_DAYS, `${nonsense} is not a window`);
      });
    }
  });

  it("computes the cutoff as the start of the window", () => {
    const now = at("2026-06-30");
    assert.equal(retentionCutoff(now, 1), "2026-06-30");
    assert.equal(retentionCutoff(now, 30), "2026-06-01");
  });

  it("prunes days older than the window and reports how many went", () => {
    const store = freshRollups();
    for (const day of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"]) {
      recordDailyUsage(store, "bd-tool", "read", "/proj/a", at(day));
    }

    const removed = pruneRollups(store, at("2026-06-04"), 2);

    assert.equal(removed, 2);
    assert.deepEqual(Object.keys(store.days).sort(), ["2026-06-03", "2026-06-04"]);
  });

  it("enforces the window on write, so the file cannot grow past it", async () => {
    await withRetentionEnv("30", async () => {
      const workspace = await tempRoot.createWorkspace();
      const file = join(workspace, "skill-usage-daily.json");
      const today = dayKey();
      const store = freshRollups();

      for (let offset = 0; offset < 40; offset++) {
        recordDailyUsage(store, "bd-tool", "read", "/proj/a", at(shiftDay(today, -offset)));
      }
      assert.equal(Object.keys(store.days).length, 40, "fixture spans 40 days");

      saveRollups(store, file);
      const loaded = loadRollups(file);

      assert.equal(Object.keys(loaded.days).length, 30, "only the window is written");
      assert.equal(oldestDay(loaded), shiftDay(today, -29));
      assert.equal(loaded.since, shiftDay(today, -39), "the recorded start survives pruning");
    });
  });

  it("prunes against the injected moment, not the wall clock", async () => {
    const workspace = await tempRoot.createWorkspace();
    const anchored = join(workspace, "anchored.json");
    const drifted = join(workspace, "drifted.json");

    saveRollups(fixtureRollups(), anchored, at("2026-07-02"));
    saveRollups(fixtureRollups(), drifted, at("2027-07-02"));

    assert.equal(
      Object.keys(loadRollups(anchored).days).length,
      4,
      "the fixture is current when the save is anchored to it",
    );
    assert.equal(
      Object.keys(loadRollups(drifted).days).length,
      0,
      "a year later the same fixture is outside the window",
    );
  });

  it("keeps the file bounded: a full window for 40 skills stays under the ceiling and stops growing", async () => {
    await withRetentionEnv(undefined, async () => {
      const workspace = await tempRoot.createWorkspace();
      const file = join(workspace, "skill-usage-daily.json");
      const today = dayKey();
      const skills = Array.from({ length: 40 }, (_, i) => `skill-${i}`);
      const store = freshRollups();

      const fill = (from: number, to: number) => {
        for (let offset = from; offset < to; offset++) {
          const day = shiftDay(today, -offset);
          for (const skill of skills) {
            recordDailyUsage(store, skill, "loaded", "/proj/a", at(day));
            recordDailyUsage(store, skill, "read", "/proj/a", at(day));
          }
        }
      };

      fill(0, DEFAULT_RETENTION_DAYS);
      saveRollups(store, file);

      const size = statSync(file).size;
      assert.ok(
        size <= MAX_ROLLUP_FILE_BYTES,
        `${size} bytes exceeds the ${MAX_ROLLUP_FILE_BYTES}-byte ceiling`,
      );

      // Another full year, all older than the window: pruned as fast as it is
      // written, so the file does not grow at all. This is the bound that binds:
      // without pruning it doubles.
      fill(DEFAULT_RETENTION_DAYS, DEFAULT_RETENTION_DAYS * 2);
      saveRollups(store, file);

      const grown = statSync(file).size;
      assert.equal(grown, size, `file grew from ${size} to ${grown} bytes`);
      assert.equal(Object.keys(loadRollups(file).days).length, DEFAULT_RETENTION_DAYS);
    });
  });

  it("holds the ceiling when every skill-day carries the maximum project detail", async () => {
    await withRetentionEnv(undefined, async () => {
      const workspace = await tempRoot.createWorkspace();
      const file = join(workspace, "skill-usage-daily.json");
      const today = dayKey();
      const skills = Array.from({ length: 40 }, (_, i) => `skill-${i}`);
      // Realistic-length paths in every permitted project slot. This is the
      // dimension the other bounded test leaves empty, and the one that
      // dominates the file: it multiplies the raw size by `MAX_PROJECTS_PER_DAY`.
      const projects = Array.from({ length: MAX_PROJECTS_PER_DAY }, (_, i) =>
        `/home/user/projects/app-${String(i).padStart(2, "0")}`,
      );
      const store = freshRollups();

      for (let offset = 0; offset < DEFAULT_RETENTION_DAYS; offset++) {
        const day = shiftDay(today, -offset);
        for (const skill of skills) {
          for (const project of projects) {
            recordDailyUsage(store, skill, "read", project, at(day));
          }
        }
      }

      const raw = Buffer.byteLength(JSON.stringify(store), "utf-8");
      assert.ok(
        raw > MAX_ROLLUP_FILE_BYTES,
        `the fixture must exceed the ceiling to prove it binds: ${raw} bytes`,
      );

      const result = saveRollups(store, file, at(today));
      const size = statSync(file).size;

      assert.ok(
        size <= MAX_ROLLUP_FILE_BYTES,
        `raw ${raw} bytes was written as ${size}, over the ${MAX_ROLLUP_FILE_BYTES} ceiling`,
      );
      assert.equal(result.bytes, size);
      assert.ok(result.shedProjectLists > 0, "project detail was shed to hold the ceiling");
      assert.equal(result.droppedDays, 0, "the counts alone fit, so no day is dropped");

      const loaded = loadRollups(file);
      assert.equal(Object.keys(loaded.days).length, DEFAULT_RETENTION_DAYS, "every day survives");
      assert.deepEqual(loaded.days[today]!["skill-0"]!.projects, [], "the shed removed the lists");
      assert.equal(
        loaded.days[today]!["skill-0"]!.read,
        MAX_PROJECTS_PER_DAY,
        "counts survive the shed",
      );

      // The timeline reads counts only, so shedding changes no rendered number.
      const row = timeline(loaded, "day").find((r) => r.bucket === today);
      assert.equal(row?.total, 40 * MAX_PROJECTS_PER_DAY);
    });
  });

  it("drops the oldest days only when the counts alone exceed the ceiling", async () => {
    const workspace = await tempRoot.createWorkspace();
    const file = join(workspace, "skill-usage-daily.json");
    const today = dayKey();
    // No project paths at all, so shedding them frees nothing: 200 skills used
    // every day of the window is several times the ceiling in counts alone.
    const skills = Array.from({ length: 200 }, (_, i) => `skill-${i}`);
    const oldest = shiftDay(today, -(DEFAULT_RETENTION_DAYS - 1));
    const store = freshRollups();

    for (let offset = 0; offset < DEFAULT_RETENTION_DAYS; offset++) {
      const day = shiftDay(today, -offset);
      for (const skill of skills) recordDailyUsage(store, skill, "read", "", at(day));
    }

    const result = saveRollups(store, file, at(today));

    assert.ok(
      statSync(file).size <= MAX_ROLLUP_FILE_BYTES,
      `the counts alone must still fit the ${MAX_ROLLUP_FILE_BYTES}-byte ceiling`,
    );
    assert.equal(result.shedProjectLists, 0, "there was no project detail to shed");
    assert.ok(result.droppedDays > 0, "the oldest days were dropped");

    const loaded = loadRollups(file);
    assert.equal(Object.keys(loaded.days).length, DEFAULT_RETENTION_DAYS - result.droppedDays);
    assert.ok(loaded.days[today], "the newest day survives");
    assert.ok(!loaded.days[oldest], "the oldest day went first");
  });
});

// ─── Bucketing ───────────────────────────────────────────────────────────────

describe("bucketKey", () => {
  it("uses the day itself for days", () => {
    assert.equal(bucketKey("2026-06-02", "day"), "2026-06-02");
  });

  it("buckets a week from its Monday", () => {
    // 2026-06-01 is a Monday; the rest of that week shares its key.
    assert.equal(bucketKey("2026-06-01", "week"), "2026-06-01");
    assert.equal(bucketKey("2026-06-02", "week"), "2026-06-01");
    assert.equal(bucketKey("2026-06-07", "week"), "2026-06-01");
    assert.equal(bucketKey("2026-06-08", "week"), "2026-06-08");
  });

  it("buckets a month from its year and month", () => {
    assert.equal(bucketKey("2026-06-30", "month"), "2026-06");
    assert.equal(bucketKey("2026-07-01", "month"), "2026-07");
  });
});

describe("timeline", () => {
  it("aggregates per day, including distinct skills per day", () => {
    const rows = timeline(fixtureRollups(), "day");

    assert.deepEqual(
      rows.map((r) => [r.bucket, r.total, r.skills]),
      [
        ["2026-06-01", 1, 1],
        ["2026-06-02", 2, 2],
        ["2026-06-08", 1, 1],
        ["2026-07-01", 1, 1],
      ],
    );
  });

  it("aggregates per week, counting a skill once per bucket", () => {
    const rows = timeline(fixtureRollups(), "week");

    assert.deepEqual(
      rows.map((r) => [r.bucket, r.total, r.skills]),
      [
        ["2026-06-01", 3, 2],
        ["2026-06-08", 1, 1],
        ["2026-06-29", 1, 1],
      ],
    );
  });

  it("aggregates per month", () => {
    const rows = timeline(fixtureRollups(), "month");

    assert.deepEqual(
      rows.map((r) => [r.bucket, r.loaded, r.invoked, r.read, r.total, r.skills]),
      [
        ["2026-06", 1, 1, 2, 4, 2],
        ["2026-07", 1, 0, 0, 1, 1],
      ],
    );
  });

  it("keeps only the most recent buckets when limited", () => {
    const rows = timeline(fixtureRollups(), "day", 2);
    assert.deepEqual(rows.map((r) => r.bucket), ["2026-06-08", "2026-07-01"]);
  });

  it("returns nothing for an empty store rather than zero-filled buckets", () => {
    assert.deepEqual(timeline(freshRollups(), "day"), []);
    assert.deepEqual(timeline(freshRollups(), "week"), []);
    assert.deepEqual(timeline(freshRollups(), "month"), []);
  });
});

// ─── Rendering ───────────────────────────────────────────────────────────────

describe("formatTimeline", () => {
  it("renders per-day, per-week and per-month sections from the rollups", () => {
    const output = formatTimeline(fixtureRollups());

    assert.match(output, /Per day/);
    assert.match(output, /Per week/);
    assert.match(output, /Per month/);
    assert.match(output, /2026-06-02/);
    assert.match(output, /2026-06-29/);
    assert.match(output, /2026-07/);
  });

  it("states the retention window and where the history starts", () => {
    const output = formatTimeline(fixtureRollups());

    assert.match(output, /Rollups since 2026-06-01/);
    assert.match(output, /History before 2026-06-01 is unavailable/);
    assert.match(output, new RegExp(`Retention: ${DEFAULT_RETENTION_DAYS} days`));
  });

  it("reports missing history as unavailable and renders no rows for it", () => {
    const output = formatTimeline(freshRollups());

    assert.match(output, /History unavailable/);
    assert.match(output, /no backfill/);
    assert.match(output, /No rollup data to render/);
    assert.ok(!output.includes("Bucket"), "an empty store renders no table at all");
  });

  it("renders no rows when the window has pruned everything", () => {
    const store = fixtureRollups();
    pruneRollups(store, at("2027-06-01"), 30);

    const output = formatTimeline(store);
    assert.match(output, /No rollup data to render/);
    assert.ok(!output.includes("Bucket"), "no table without rows");
  });

  it("is requested only by the `timeline` subcommand", () => {
    assert.equal(isTimelineRequest("timeline"), true);
    assert.equal(isTimelineRequest("  timeline  "), true);
    assert.equal(isTimelineRequest("timeline --project /p"), true);
    assert.equal(isTimelineRequest(""), false);
    assert.equal(isTimelineRequest(undefined), false);
    assert.equal(isTimelineRequest("--project timeline"), false);
  });
});

// ─── No transcript scan ──────────────────────────────────────────────────────

describe("the timeline path", () => {
  it("renders from the store it is given, reading no file or directory", () => {
    const calls: string[] = [];
    const originalRead = fs.readFileSync;
    const originalReaddir = fs.readdirSync;

    // A transcript scan would have to open a file or walk a directory. Neither
    // happens on the render path: every number comes from the rollup store.
    fs.readFileSync = ((file: fs.PathOrFileDescriptor) => {
      calls.push(String(file));
      return "";
    }) as typeof fs.readFileSync;
    fs.readdirSync = ((target: fs.PathLike) => {
      calls.push(String(target));
      return [];
    }) as typeof fs.readdirSync;

    try {
      assert.match(formatTimeline(fixtureRollups()), /Per day/);
    } finally {
      fs.readFileSync = originalRead;
      fs.readdirSync = originalReaddir;
    }

    assert.deepEqual(calls, []);
  });

  it("never names a transcript file", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));

    for (const name of ["rollup.ts", "timeline.ts", "index.ts"]) {
      const source = readFileSync(join(here, name), "utf-8");
      assert.ok(!/\.jsonl/i.test(source), `${name} must not read a .jsonl transcript`);
    }
  });

  it("renders from a rollup file alone", async () => {
    const workspace = await tempRoot.createWorkspace();
    const file = join(workspace, "skill-usage-daily.json");
    // Anchored to the fixture's own window: the save prunes against this moment,
    // so the 2026 fixture never falls out of the window as wall time advances.
    saveRollups(fixtureRollups(), file, at("2026-07-02"));

    const output = formatTimeline(loadRollups(file));

    assert.match(output, /Per day/);
    assert.match(output, /2026-06-02/);
  });
});
