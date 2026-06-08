import type { UsageStore, RawEvent } from "./store.js";

// ── Event recording ──────────────────────────────────────────────────────────

export function recordUsage(
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
