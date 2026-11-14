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
- **Each record is fixed-size.** Counts are numbers, and the distinct-project list per skill-day is
  capped at 50 entries, so one day's data cannot grow with the number of events that day.
- **The file is written minified** — it is read by the extension, not by a human. Worst case measured
  in the test suite (40 skills used every day of the window, two events each, one project path) is
  994,668 bytes; a realistic year (12 skills a day) is 387,308 bytes. The suite asserts the file
  stays under a 100-bytes-per-skill-day ceiling (1,460,000 bytes) and that a second year of data
  leaves it byte-for-byte unchanged.

### History before the rollups

Rollups start with the first skill event recorded after this version was installed. Anything earlier
is reported as **unavailable**, not as zero usage, and no data point is invented for it. Backfilling
from old session transcripts is a possible follow-up, and deliberately not part of this feature.

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
        "/home/jaybeeuu/src/agent-cortex": {
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
      "bd-tool": { "loaded": 2, "invoked": 1, "read": 3, "projects": ["/home/jaybeeuu/src/agent-cortex"] }
    }
  }
}
```

`since` is the first day a rollup was recorded. It survives pruning, so the timeline can say where
the recorded history starts.
