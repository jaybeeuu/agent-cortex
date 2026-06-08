import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";

// Re-export public API for tests and consumers
export { type ProjectCounts, type SkillStats, type UsageStore, type RawEvent, loadStore, saveStore, ageOutStore } from "./store.js";
export { recordUsage } from "./record.js";
export { type SkillRecord, globalSkillDirs, scanSkills, extractSkillName, discoverProjectSkills, resolveSkillFromPath } from "./discover.js";
export { formatTable } from "./format.js";

import { loadStore, saveStore } from "./store.js";
import { recordUsage } from "./record.js";
import { resolveSkillFromPath, globalSkillDirs, scanSkills, discoverProjectSkills } from "./discover.js";
import { formatTable } from "./format.js";

// ── Extension entry point ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── Lazy skill map, refreshed on startup and reload ─────────────────────
  let knownSkills = new Map<string, import("./discover.js").SkillRecord>();

  function refreshSkills(cwd: string): void {
    knownSkills = new Map();
    for (const d of globalSkillDirs()) scanSkills(d, knownSkills);
    discoverProjectSkills(cwd, knownSkills);
  }

  refreshSkills(process.cwd());

  // ── 1. Track skills loaded into system prompt ─────────────────────────
  pi.on("before_agent_start", async (event, ctx) => {
    const skills = event.systemPromptOptions?.skills;
    if (!skills?.length) return;

    const store = loadStore();
    const project = ctx.cwd;
    for (const skill of skills) {
      const name = typeof skill === "string" ? skill : skill.name;
      if (name) recordUsage(store, name, "loaded", project);
    }
    saveStore(store);
  });

  // ── 2. Track /skill:name invocations ──────────────────────────────────
  pi.on("input", async (event, ctx) => {
    const m = event.text.match(/^\/skill:(\S+)/);
    if (!m) return;

    const store = loadStore();
    recordUsage(store, m[1], "invoked", ctx.cwd);
    saveStore(store);
  });

  // ── 3. Track SKILL.md reads by the LLM ────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "read") return;

    const input = event.input as { path?: string } | undefined;
    const filePath = input?.path;
    if (!filePath) return;

    const skillName = resolveSkillFromPath(filePath, knownSkills);
    if (!skillName) return;

    const store = loadStore();
    recordUsage(store, skillName, "read", ctx.cwd);
    saveStore(store);
  });

  // ── 4. Track turns ────────────────────────────────────────────────────
  // Only count unique turns (not reloads). We use a simple in-memory flag
  // per reload cycle; a `/reload` resets the flag, avoiding double-counts.
  let countedTurnThisCycle = false;

  pi.on("turn_end", async (_event, _ctx) => {
    if (countedTurnThisCycle) return;
    countedTurnThisCycle = true;

    const store = loadStore();
    store.totalTurns++;
    saveStore(store);
  });

  // Reset the flag after reload so the next turn is counted
  pi.on("session_start", async () => {
    countedTurnThisCycle = false;
  });

  // ── 5. /skill-stats command ───────────────────────────────────────────
  pi.registerCommand("skill-stats", {
    description:
      "Show skill usage stats. Filter by project: /skill-stats --project <path>",
    handler: async (args, ctx) => {
      const store = loadStore();

      let projectFilter: string | null = null;
      if (args) {
        const m = args.match(/--project\s+(\S+)/);
        if (m) projectFilter = path.resolve(ctx.cwd, m[1]);
      }

      const skillNames = Object.keys(store.skills).sort();
      if (skillNames.length === 0) {
        ctx.ui.notify("No skill usage recorded yet.", "info");
        return;
      }

      // Build rows — each row is [skill, loaded, invoked, read, total, lastUsed]
      const rows: string[][] = [];
      for (const name of skillNames) {
        const s = store.skills[name];

        let loaded: number, invoked: number, read: number, lastUsed: string;
        if (projectFilter) {
          const p = s.byProject[projectFilter];
          if (!p) continue;
          loaded = p.loadedCount;
          invoked = p.invokedCount;
          read = p.readCount;
          lastUsed = p.lastUsed ? new Date(p.lastUsed).toLocaleDateString() : "-";
        } else {
          loaded = s.loadedCount;
          invoked = s.invokedCount;
          read = s.readCount;
          lastUsed = s.lastUsed ? new Date(s.lastUsed).toLocaleDateString() : "-";
        }

        const total = loaded + invoked + read;
        if (total === 0) continue; // hide zero-usage rows in filtered view

        rows.push([
          name,
          String(loaded),
          String(invoked),
          String(read),
          String(total),
          lastUsed,
        ]);
      }

      rows.sort((a, b) => Number(b[4]) - Number(a[4]));

      // ── Assemble output ──────────────────────────────────────────
      const lines: string[] = [];

      if (projectFilter) {
        lines.push(`Skill usage for project: ${projectFilter}`);
        lines.push("");
      }

      lines.push(`Total skills tracked: ${rows.length}`);
      lines.push(`Total agent turns recorded: ${store.totalTurns}`);
      lines.push("");

      if (rows.length > 0) {
        const top = rows.slice(0, 3);
        lines.push("Top 3:");
        lines.push(...top.map((r, i) => `  ${i + 1}. ${r[0]} (${r[4]} total)`));
      }

      if (rows.length > 3) {
        lines.push("");
        const bottom = rows.slice(-3);
        lines.push("Bottom 3:");
        lines.push(...bottom.map((r, i) => `  ${i + 1}. ${r[0]} (${r[4]} total)`));
      }

      lines.push("");
      lines.push(formatTable(
        ["Skill", "Loaded", "Invoked", "Read", "Total", "Last Used"],
        rows,
      ));
      lines.push("");

      // Show all projects if not filtering
      if (!projectFilter) {
        const allProjects = new Set<string>();
        for (const name of skillNames) {
          for (const proj of Object.keys(store.skills[name].byProject)) {
            allProjects.add(proj);
          }
        }
        if (allProjects.size > 1) {
          lines.push(`Projects with activity (${allProjects.size}):`);
          for (const proj of [...allProjects].sort()) {
            lines.push(`  ${proj}`);
          }
          lines.push("");
          lines.push("Filter: /skill-stats --project <path>");
        }
      }

      const output = lines.join("\n");
      ctx.ui.notify(
        `Skill stats: ${rows.length} skills. Top: ${rows[0]?.[0] ?? "-"}.`,
        "info",
      );
      console.log(output);
    },
  });

  // ── 6. /skill-usage-reset command ─────────────────────────────────────
  pi.registerCommand("skill-usage-reset", {
    description: "Delete all recorded skill usage data",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const ok = await ctx.ui.confirm(
        "Reset all skill stats?",
        "This deletes ALL recorded usage data across all projects.",
      );
      if (!ok) return;

      saveStore({
        version: 1,
        skills: {},
        totalTurns: 0,
        lastUpdated: new Date().toISOString(),
        recentEvents: [],
      });
      ctx.ui.notify("Skill usage statistics reset.", "info");
    },
  });
}
