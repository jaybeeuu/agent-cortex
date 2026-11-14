# skill-stats

A PI extension that tracks skill usage across all sessions.

## What it tracks

| Signal | Source | What it tells you |
|---|---|---|
| **Loaded** | `before_agent_start` → `systemPromptOptions.skills` | Skill was injected into the system prompt (available to the LLM) |
| **Invoked** | `input` matching `/skill:name` | User explicitly invoked the skill |
| **Read** | `read` tool call to a SKILL.md | LLM actively loaded the skill's full instructions |

### Misuse detection

A skill that is *loaded* frequently but *never read* may be burning context budget without being consulted — a candidate for removal or tightening.

## Data

Usage data is stored in `~/.pi/agent-cortex/` — global, across all projects, with per-project
breakdowns so you can slice by project. There are two files, with different fidelity:

| File | Fidelity | Kept for |
|---|---|---|
| `skill-usage.json` | Per-skill counters, per-project breakdown, and a 200-event ring of recent events | Until a skill has been unused for ~3 months (existing age-out) |
| `skill-usage-daily.json` | One record per skill per day: loaded / invoked / read counts and the distinct projects seen that day | 365 days by default, pruned on every write |

The counters answer "what is my all-time shape, and what happened in the last few minutes". The
daily rollups answer "how has my usage changed over months" without scanning session transcripts.

### Retention and size policy

- **Retention window: 365 days by default.** Override it per machine with
  `AGENT_CORTEX_SKILL_STATS_RETENTION_DAYS` (a positive whole number of days). Invalid values fall
  back to the default.
- **Pruning happens on write, not on read.** Every save drops day records older than the window, so a
  long-lived install can never accumulate more than the window's worth of days. The `timeline` view
  only reads; it prunes nothing.
- **Each record is fixed-size.** Counts are numbers, the distinct-project list per skill-day is capped
  at 50 entries, and a stored project path is truncated to 120 characters, so one skill-day's record
  cannot grow with the number of events that day or with working-directory depth. Two long paths that
  share their first 120 characters count as one project.
- **The file has a hard ceiling of 2,920,000 bytes, enforced on every write.** That is 365 days x 40
  skills x 200 bytes per skill-day (the counts plus one realistic project path); the 40 sizes the
  budget and is not a limit on how many skills an install may have. A realistic file is far smaller:
  994,668 bytes for 40 skills used every day of the window, two events each and a short project path
  (`/proj/a`), and 1,272,068 bytes for the same usage with a 26-character project path. A retention
  window longer than 365 days does not raise the ceiling, so the detail it implies is shed by the
  rule below.
  When a write would exceed the ceiling, `saveRollups` drops the per-skill-day project lists first —
  the loaded / invoked / read counts and every day survive, and every number the timeline renders is
  unchanged. Only if the counts alone exceed the ceiling does it drop the oldest days, continuing the
  direction pruning already takes. `saveRollups` returns what the write gave up (`shedProjectLists`,
  `droppedDays`) and the size it wrote, and records the same figures in the file under `shed`, so
  `/skill-stats timeline` reports the loss after a reload instead of the user finding out never. The
  rendered line names the day of the write, how many project lists and how many days went, and the
  ceiling that forced it.
- **A ceiling shed moves the reported start; ordinary pruning does not.** When shedding drops whole
  days, those days were inside the retention window, so `since` moves to the oldest day the file
  still holds and the header can never claim a day that was deleted. Days that age out of the window
  are different: they were real history and the rendered retention line explains them, so `since`
  keeps the first-ever day.
- **The file is written minified** — it is read by the extension, not by a human. The suite fills
  every cap at once (40 skills x 365 days x 50 project paths), asserts the 22,033,268 raw bytes are
  written as at most 2,920,000, and asserts a second year of data leaves the file byte-for-byte
  unchanged.

### History before the rollups

Rollups start with the first skill event recorded after this version was installed. Anything earlier
is reported as **unavailable**, not as zero usage, and no data point is invented for it. A ceiling
shed that deletes days reports on the same screen, so a moved start is explained rather than silent.
Backfilling from old session transcripts is a possible follow-up, and deliberately not part of this
feature.

## Installation

This extension is bundled with the `agent-cortex` PI package. Install the package for
auto-discovery:

```bash
pi install git:https://github.com/jaybeeuu/agent-cortex
pi config enable extension:skill-stats
```

After install, `/reload` inside PI (or restart PI). The extension auto-registers.

### Development symlink (alternative)

```bash
ln -sf $(pwd)/extensions/skill-stats ~/.pi/agent/extensions/skill-stats
/reload
```

## Commands

| Command | Description |
|---|---|
| `/skill-stats` | Show usage dashboard with per-project slicing |
| `/skill-stats --project ./relative/path` | Filter to a specific project |
| `/skill-stats timeline` | Per-day, per-week and per-month counts and distinct skills, from the daily rollups |
| `/skill-usage-reset` | Wipe all recorded data, counters and rollups |

## Raw data

The JSON file at `~/.pi/agent-cortex/skill-usage.json` contains the full record:

```json
{
  "version": 1,
  "skills": {
    "bd-tool": {
      "loadedCount": 42,
      "invokedCount": 5,
      "readCount": 18,
      "lastUsed": "2026-06-07T...",
      "byProject": {
        "/home/user/projects/app": {
          "loadedCount": 40,
          "invokedCount": 3,
          "readCount": 16,
          "lastUsed": "2026-06-07T..."
        }
      }
    }
  },
  "totalTurns": 350,
  "lastUpdated": "2026-06-07T..."
}
```

The rollups in `~/.pi/agent-cortex/skill-usage-daily.json` are minified and keyed by day:

```json
{
  "version": 1,
  "since": "2026-06-01",
  "days": {
    "2026-06-07": {
      "bd-tool": { "loaded": 2, "invoked": 1, "read": 3, "projects": ["/home/user/projects/app"] }
    }
  },
  "shed": { "on": "2026-06-08", "projectLists": 14600, "days": 0 }
}
```

`since` is the first day a rollup is held for. It survives pruning, so the timeline can say where
the recorded history starts; it moves forward only when a ceiling shed deletes days, which nothing
else explains.

`shed` appears only after a write had to give up detail for the size ceiling, and holds the totals
dropped by shedding (`projectLists`, `days`) plus the day of the most recent such write. A file
written before this field existed has no `shed` key, and such a file loads and renders unchanged:
an absent record means nothing was shed.
