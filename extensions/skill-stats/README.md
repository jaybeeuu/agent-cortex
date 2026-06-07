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

Usage data is stored in `~/.pi/agent-cortex/skill-usage.json` — a single file across all projects, with per-project breakdowns so you can slice by project.

## Installation

### Symlink (recommended for development)

```bash
# From the repo root
ln -sf $(pwd)/extensions/skill-stats ~/.pi/agent/extensions/skill-stats
```

Then `/reload` inside PI (or restart PI).

### Package install (future)

If this repo is published as a PI package, users can run:

```bash
pi install git:github.com/jaybeeuu/agent-cortex
pi config extensions skill-stats enable
```

## Commands

| Command | Description |
|---|---|
| `/skill-stats` | Show usage dashboard with per-project slicing |
| `/skill-stats --project ./relative/path` | Filter to a specific project |
| `/skill-usage-reset` | Wipe all recorded data |

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
