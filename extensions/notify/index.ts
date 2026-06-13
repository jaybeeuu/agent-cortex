import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";

/**
 * Get a human-readable label for the current context.
 *
 * - In tmux: session_name:window_index.pane_index (e.g. "work:3.1")
 * - Otherwise: last component of the working directory (e.g. "agent-cortex")
 */
function getContextLabel(cwd: string): string {
  if (process.env.TMUX) {
    try {
      return execSync(
        'tmux display-message -p "#{session_name}:#{window_index}.#{pane_index}"',
        { encoding: "utf-8", timeout: 2000 },
      ).trim();
    } catch {
      // fall through to path-based label
    }
  }
  const parts = cwd.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || "unknown";
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
  process.stdout.write(wrapForTmux(`\x1b]99;i=1:d=0;${title}\x1b\\`));
  process.stdout.write(wrapForTmux(`\x1b]99;i=1:p=body;${body}\x1b\\`));
}

function sendDesktopNotification(label: string): void {
  const isIterm2 =
    process.env.TERM_PROGRAM === "iTerm.app" ||
    Boolean(process.env.ITERM_SESSION_ID);
  const title = label;
  const body = "Task complete";

  if (process.env.KITTY_WINDOW_ID) {
    notifyOSC99(title, body);
  } else if (isIterm2) {
    notifyOSC9(`${title}: ${body}`);
  } else if (process.env.WT_SESSION) {
    // Windows Terminal — use PowerShell toast
    const { execFile } = require("node:child_process");
    const script = buildWindowsToastScript(title, body);
    execFile("powershell.exe", ["-NoProfile", "-Command", script]);
  } else {
    notifyOSC777(title, body);
  }
}

function buildWindowsToastScript(title: string, body: string): string {
  const type = "Windows.UI.Notifications";
  const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
  const template = `[${type}.ToastTemplateType]::ToastText01`;
  const toast = `[${type}.ToastNotification]::new($xml)`;
  return [
    `${mgr} > $null`,
    `$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
    `[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
  ].join("; ");
}

/* ── Bell (existing terminal-bell logic) ── */

function ringBell(): void {
  try {
    // Try /dev/tty first (bypasses stdout capture, reliable in tmux)
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

  pi.on("agent_start", async () => {
    agentStartTime = Date.now();
    turnCount = 0;
  });

  pi.on("turn_end", async () => {
    turnCount++;
  });

  pi.on("agent_end", async (_event, ctx) => {
    const elapsed = Date.now() - agentStartTime;

    // Only notify on multi-turn or long tasks — not on quick chat replies
    if (turnCount === 1 && elapsed < 30_000) return;

    const label = getContextLabel(ctx.cwd);

    // Desktop notification (replaces pi-notify)
    sendDesktopNotification(label);

    // Terminal bell (existing behaviour — tmux bell-on-window highlight)
    ringBell();
  });
}
