/**
 * Desktop notification + terminal bell on task completion.
 *
 * Fires after multi-turn or long-running tasks (>1 turn or >30s) with a
 * multiline notification showing:
 *   Line 1: working directory path
 *   Line 2: session name (if set)
 *   Line 3: LLM-generated summary of what the agent did
 *
 * The notification title is the tmux session:window.pane identifier (when
 * available) or "pi".
 *
 * Response summarization uses the tiny model configured in settings.json
 * under the `tinyModel` key.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

import {
  loadTinyModelConfig,
  parseModelString,
  summarizeResponseText,
} from "../lib/tiny-model.js";
import type { TinyModelConfig } from "../lib/tiny-model.js";

/* ── Context helpers ── */

/**
 * Get the tmux session:window.pane identifier, or undefined if not in tmux.
 */
function getTmuxLabel(): string | undefined {
  if (!process.env.TMUX) return undefined;
  try {
    return execSync(
      'tmux display-message -p "#{session_name}:#{window_index}.#{pane_index}"',
      { encoding: "utf-8", timeout: 2000 },
    ).trim();
  } catch {
    return undefined;
  }
}

/**
 * Format a working directory path for display.
 *
 * Replaces $HOME with ~ and truncates from the left to ~40 chars when the
 * path is too long, keeping the trailing directory name visible.
 */
function formatTruncatedPath(cwd: string): string {
  const home = homedir();
  let display = cwd;
  if (display.startsWith(home)) {
    display = "~" + display.slice(home.length);
  }

  const maxLen = 40;
  if (display.length <= maxLen) return display;

  const head = "~\u2026/";
  const tailLen = maxLen - head.length;
  if (tailLen <= 0) return display.slice(-maxLen);

  return head + display.slice(-tailLen);
}

/**
 * Extract plain text from the last assistant response for summarization.
 *
 * Returns the concatenated text content of the last assistant message,
 * or empty string if none found.
 */
function extractAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    const texts = msg.content
      .filter(
        (b): b is { type: "text"; text: string } => b.type === "text",
      )
      .map((b) => b.text)
      .filter(Boolean);

    if (texts.length === 0) continue;

    return texts.join(" ").trim();
  }
  return "";
}

/* ── Desktop notification helpers (OSC 777 / 99 / 9) ── */

function wrapForTmux(sequence: string): string {
  if (!process.env.TMUX) return sequence;
  const escaped = sequence.split("\x1b").join("\x1b\x1b");
  return `\x1bPtmux;${escaped}\x1b\\`;
}

function notifyOSC777(title: string, body: string): void {
  process.stdout.write(wrapForTmux(`\x1b]777;notify;${title};${body}\x07`));
}

function notifyOSC9(message: string): void {
  process.stdout.write(wrapForTmux(`\x1b]9;${message}\x07`));
}

function notifyOSC99(title: string, body: string): void {
  // d=1 = persistent notification (stays until dismissed)
  process.stdout.write(wrapForTmux(`\x1b]99;i=1:d=1;${title}\x1b\\`));
  process.stdout.write(wrapForTmux(`\x1b]99;i=1:p=body;${body}\x1b\\`));
}

function sendDesktopNotification(title: string, sections: string[]): void {
  const isIterm2 =
    process.env.TERM_PROGRAM === "iTerm.app" ||
    Boolean(process.env.ITERM_SESSION_ID);

  // Flatten sections into a single notification body for non-Windows paths
  const body = sections.join(" \u00b7 ");

  if (process.env.KITTY_WINDOW_ID) {
    notifyOSC99(title, body);
  } else if (isIterm2) {
    notifyOSC9(`${title}: ${body}`);
  } else if (process.env.WT_SESSION || process.platform === 'win32') {
    // Windows Terminal / Windows — PowerShell toast via execFileSync
    const { execFileSync } = require("node:child_process");
    const script = buildWindowsToastScript(title, sections);
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 5000 });
    } catch (e) {
      console.warn("[notify] toast failed:", e.message);
    }
  } else {
    notifyOSC777(title, body);
  }
}

function buildWindowsToastScript(title: string, sections: string[]): string {
  // Escape single quotes for PowerShell single-quoted strings: double them up
  const esc = (s: string) => s.replace(/'/g, "''").replace(/\r/g, '');
  const psTitle = esc(title);

  // Use ToastText04 for up to 4 text elements (title + 3 body sections)
  const template = [
    `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null`,
    `$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText04)`,
    `$null = $t.SelectSingleNode('/toast').SetAttribute('scenario', 'persistent')`,
    // Title goes to text[0], body sections to text[1-3]
    `$null = $t.SelectSingleNode('//text[@id=1]').AppendChild($t.CreateTextNode('${psTitle}'))`,
  ];

  for (let i = 0; i < Math.min(sections.length, 3); i++) {
    const escaped = esc(sections[i]);
    template.push(`$null = $t.SelectSingleNode('//text[@id=${i + 2}]').AppendChild($t.CreateTextNode('${escaped}'))`);
  }

  template.push(`$toast = [Windows.UI.Notifications.ToastNotification]::new($t)`);
  template.push(`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('pi').Show($toast) > $null`);

  return template.join("; ");
}

/* ── Bell ── */

function ringBell(): void {
  try {
    const { openSync, writeSync, closeSync } = require("node:fs");
    const fd = openSync("/dev/tty", "w");
    writeSync(fd, "\x07");
    closeSync(fd);
  } catch {
    process.stdout.write("\x07");
  }
}

export default function (pi: ExtensionAPI) {
  let agentStartTime = 0;
  let turnCount = 0;
  let config: TinyModelConfig;

  pi.on("session_start", async (_event, ctx) => {
    config = loadTinyModelConfig(ctx.cwd);
  });

  pi.on("agent_start", async () => {
    agentStartTime = Date.now();
    turnCount = 0;
  });

  pi.on("turn_end", async () => {
    turnCount++;
  });

  pi.on("agent_end", async (event, ctx) => {
    const elapsed = Date.now() - agentStartTime;

    // Only notify on multi-turn or long tasks — not on quick chat replies
    if (turnCount === 1 && elapsed < 30_000) return;

    // ── Title: path · tmux identifier (prominent notification header) ──
    const tmuxLabel = getTmuxLabel();
    const truncatedPath = formatTruncatedPath(ctx.cwd);
    const title = tmuxLabel
      ? `${truncatedPath}  \u00b7  ${tmuxLabel}`
      : truncatedPath;

    // ── Body: sections separated by a blank line ──
    const sections: string[] = [];

    // Section 1: session name (if set)
    const sessionName = pi.getSessionName();
    if (sessionName) sections.push(sessionName);

    // Section 2: LLM-generated summary of the assistant's response
    const responseText = extractAssistantText(event.messages);
    if (responseText) {
      try {
        const summary = await summarizeResponseWithFallback(
          ctx,
          responseText,
          config,
        );
        sections.push(summary);
      } catch {
        // If summary fails (e.g. config not loaded), just show raw text
        sections.push(responseText.slice(0, config?.maxSummaryLength ?? 100).replace(/\s+/g, ' ').trim());
      }
    }

    // Desktop notification
    sendDesktopNotification(title, sections);

    // Terminal bell (tmux catches this via monitor-bell + visual-bell)
    ringBell();
  });
}

/**
 * Summarize response text using the configured tiny model, falling back
 * to simple truncation if the LLM call fails or is disabled.
 */
async function summarizeResponseWithFallback(
  ctx: any,
  responseText: string,
  config: TinyModelConfig,
): Promise<string> {
  if (!config.enabled) {
    return truncateToOneLine(responseText, config.maxSummaryLength);
  }

  try {
    const { provider, id } = parseModelString(config.model);
    const model = ctx.modelRegistry.find(provider, id);
    if (!model) {
      return truncateToOneLine(responseText, config.maxSummaryLength);
    }

    const { apiKey, headers } =
      await ctx.modelRegistry.getApiKeyAndHeaders(model);

    const summary = await summarizeResponseText(
      model,
      apiKey,
      headers,
      responseText,
      config.maxSummaryLength,
    );

    if (summary) return summary;
  } catch (err) {
    console.warn("[notify] LLM summary failed, falling back:", err);
  }

  return truncateToOneLine(responseText, config.maxSummaryLength);
}

/**
 * Truncate text to roughly `maxLen` characters on a single line,
 * breaking at a word boundary.
 */
function truncateToOneLine(text: string, maxLen: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLen) return singleLine;

  const breakPoint = singleLine.lastIndexOf(" ", maxLen - 1);
  const truncated =
    breakPoint > 0 ? singleLine.slice(0, breakPoint) : singleLine.slice(0, maxLen);
  return truncated + " \u2026";
}
