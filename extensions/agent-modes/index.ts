/**
 * Agent Modes Extension
 *
 * Makes the agent-cortex agents (ralph, ralph-plan, plan, strategy) available as
 * switchable PI modes. Each mode:
 *   - Injects the agent's full system prompt into the running context
 *   - Restricts tools based on the agent's declared tool set
 *   - Shows a status indicator with the active agent name
 *
 * Modeled on Pi's built-in preset.ts example and R-Dson/pi-modes.
 *
 * Agents are discovered from the composable source format (`agents/<name>/` +
 * `agents/<name>/pi/frontmatter.json`) — see agents/README.md. Discovery and
 * PI-prompt composition live in discover.ts.
 *
 * Commands:
 *   /agent         — show mode selector
 *   /agent <name>  — switch to agent mode directly
 *   Ctrl+Shift+A   — cycle agents
 *   --agent <name> — start in a specific agent mode
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { discoverAgents, DEFAULT_TOOLS, type AgentDef } from "./discover.ts";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Agents dir is <extension-root>/../../agents/ — two levels up from extensions/agent-modes/
const AGENTS_DIR = join(__dirname, "..", "..", "agents");

interface OriginalState {
  tools: string[];
}

const PERSIST_KEY = "agent-modes-state";

// ─── Extension ───────────────────────────────────────────────────────────────

export default function agentModesExtension(pi: ExtensionAPI): void {
  const agents = discoverAgents(AGENTS_DIR);

  if (agents.length === 0) {
    console.warn("[agent-modes] No agents found. Extension disabled.");
    return;
  }

  let activeAgentIndex = agents.length; // default mode is beyond the last agent
  let originalState: OriginalState | undefined;
  let baselineTools: string[] = [];
  let registeredCommands = false;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getActiveModeLabel(): string {
    if (activeAgentIndex >= agents.length || activeAgentIndex < 0) return "default";
    return agents[activeAgentIndex].name;
  }

  function getActiveColor(): ThemeColor {
    if (activeAgentIndex >= agents.length || activeAgentIndex < 0) return "accent";
    return agents[activeAgentIndex].color;
  }

  function isDefaultMode(): boolean {
    return activeAgentIndex >= agents.length || activeAgentIndex < 0;
  }

  function getActiveAgent(): AgentDef | undefined {
    if (activeAgentIndex >= agents.length || activeAgentIndex < 0) return undefined;
    return agents[activeAgentIndex];
  }

  function setAgentMode(ctx: ExtensionContext, index: number): boolean {
    if (index < 0) index = agents.length; // default mode
    if (index > agents.length) return false;

    // Snapshot before first switch
    if (originalState === undefined) {
      originalState = { tools: [...baselineTools] };
    }

    if (index >= agents.length) {
      // Default mode: restore baseline tools
      activeAgentIndex = agents.length;
      try {
        if (originalState) {
          pi.setActiveTools(originalState.tools);
        } else if (baselineTools.length > 0) {
          pi.setActiveTools(baselineTools);
        }
      } catch (err) {
        console.warn(`[agent-modes] Failed to restore tools: ${err}`);
        return false;
      }
    } else {
      // Agent mode: set agent-specific tools
      const agent = agents[index];
      activeAgentIndex = index;
      try {
        pi.setActiveTools(agent.tools);
      } catch (err) {
        console.warn(`[agent-modes] Failed to set tools for ${agent.id}: ${err}`);
        return false;
      }
    }

    updateUI(ctx);
    return true;
  }

  function updateUI(ctx: ExtensionContext): void {
    const label = getActiveModeLabel();
    if (label === "default") {
      ctx.ui.setStatus("agent-mode", undefined);
    } else {
      ctx.ui.setStatus("agent-mode", ctx.ui.theme.fg(getActiveColor(), `agent:${label}`));
    }
  }

  function persistState(): void {
    try {
      pi.appendEntry(PERSIST_KEY, {
        agentIndex: activeAgentIndex,
        agentId: activeAgentIndex < agents.length ? agents[activeAgentIndex]?.id : undefined,
      });
    } catch {
      // Non-critical
    }
  }

  // ── Register commands & shortcuts (once) ────────────────────────────────

  function registerCommands(): void {
    if (registeredCommands) return;
    registeredCommands = true;

    // /agent command
    pi.registerCommand("agent", {
      description: `Switch agent mode (${agents.map((a) => a.id).join(", ")})`,
      handler: async (args, ctx) => {
        if (!args?.trim()) {
          await showAgentSelector(ctx);
          return;
        }

        const input = args.trim().toLowerCase();

        // "default" returns to default mode
        if (input === "default" || input === "none") {
          if (setAgentMode(ctx, agents.length)) {
            persistState();
            ctx.ui.notify("Switched to default mode (full access)", "info");
          }
          return;
        }

        const index = agents.findIndex((a) => a.id === input);
        if (index === -1) {
          ctx.ui.notify(
            `Unknown agent "${input}". Available: ${agents.map((a) => a.id).join(", ")}`,
            "error",
          );
          return;
        }

        if (setAgentMode(ctx, index)) {
          persistState();
          ctx.ui.notify(`Switched to agent: ${agents[index].name}`, "info");
        }
      },
    });

    // Ctrl+Shift+A to cycle agents (A = Agent)
    pi.registerShortcut(Key.ctrlShift("a"), {
      description: "Next agent mode",
      handler: async (ctx) => {
        const next = (activeAgentIndex + 1) % (agents.length + 1);
        if (setAgentMode(ctx, next)) {
          persistState();
          const label = getActiveModeLabel();
          ctx.ui.notify(`Mode: ${label}`, "info");
        }
      },
    });

    // --agent CLI flag
    pi.registerFlag("agent", {
      description: `Start in a specific agent mode (${agents.map((a) => a.id).join(", ")})`,
      type: "string",
    });

    // inject agent prompt before each agent start
    pi.on("before_agent_start", async (event) => {
      const agent = getActiveAgent();
      if (!agent || !agent.prompt) return;

      return {
        systemPrompt: `${event.systemPrompt}\n\n---\n${agent.prompt}`,
        message: {
          customType: "agent-mode-context",
          content: `[AGENT MODE: ${agent.name.toUpperCase()}]\n${agent.description || "No description"}`,
          display: false,
        },
      };
    });
  }

  // ── Agent selector UI ────────────────────────────────────────────────────

  async function showAgentSelector(ctx: ExtensionContext): Promise<void> {
    const choices: string[] = [
      "(default) — Full tool access, no agent prompt",
      ...agents.map((agent) => {
        const active = activeAgentIndex >= 0 && agents[activeAgentIndex]?.id === agent.id
          ? " (active)" : "";
        return `${agent.name}${active} — ${agent.description.slice(0, 60)}`;
      }),
    ];

    const result = await ctx.ui.select("Select agent mode:", choices);
    if (!result) return;

    if (result.startsWith("(default)")) {
      if (setAgentMode(ctx, agents.length)) {
        persistState();
        ctx.ui.notify("Switched to default mode (full access)", "info");
      }
      return;
    }

    // Match the agent name from the choice label
    const matchedAgent = agents.find((a) => result.startsWith(a.name));
    if (matchedAgent) {
      const index = agents.indexOf(matchedAgent);
      if (setAgentMode(ctx, index)) {
        persistState();
        ctx.ui.notify(`Switched to agent: ${matchedAgent.name}`, "info");
      }
    }
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // Capture baseline tools once all extensions are loaded
    try {
      baselineTools = pi.getActiveTools();
    } catch {
      baselineTools = [...DEFAULT_TOOLS];
    }

    registerCommands();

    // Restore persisted state
    const entries = ctx.sessionManager.getEntries();
    let restoredIndex: number | undefined;

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as { type: string; customType?: string; data?: { agentIndex?: number } };
      if (entry.type === "custom" && entry.customType === PERSIST_KEY) {
        if (typeof entry.data?.agentIndex === "number") {
          restoredIndex = entry.data.agentIndex;
          break;
        }
      }
    }

    // --agent CLI flag takes priority
    const agentFlag = pi.getFlag("agent");
    let targetIndex: number;

    if (typeof agentFlag === "string" && agentFlag) {
      const flagIdx = agents.findIndex((a) => a.id === agentFlag.toLowerCase());
      if (flagIdx !== -1) {
        targetIndex = flagIdx;
      } else {
        console.warn(`[agent-modes] Unknown --agent "${agentFlag}".`);
        targetIndex = restoredIndex ?? agents.length;
      }
    } else if (restoredIndex !== undefined) {
      targetIndex = restoredIndex;
    } else {
      targetIndex = agents.length; // default mode
    }

    if (setAgentMode(ctx, targetIndex)) {
      const label = getActiveModeLabel();
      if (label !== "default") {
        ctx.ui.notify(`Agent: ${label}`, "info");
      }
    }
  });
}