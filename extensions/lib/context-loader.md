# context-loader

Utility module for loading project context files at session start.

## Purpose

Reads context files (AGENTS.md, user-preferences.md) from the project root and
formats them for injection into the agent session. This gives the agent baseline
project context without requiring manual file reads.

## Usage

```typescript
import { loadSessionContext } from "./context-loader.js";

// Load default context files from project root
const context = loadSessionContext(cwd);

// Load custom file list
const context = loadSessionContext(cwd, ["AGENTS.md", "docs/custom.md"]);
```

## Default Context Files

- `AGENTS.md` — Project instructions for agents
- `docs/user-preferences.md` — User tooling preferences

## Testing

Tests are in `extensions/skill-stats/context-loader.test.ts`:

```bash
cd extensions/skill-stats
node --test --import tsx/esm context-loader.test.ts
```
