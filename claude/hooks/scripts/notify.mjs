#!/usr/bin/env node
// Claude Code Notification hook — desktop notification on task completion/error.
//
// Reads the Notification hook JSON payload from stdin and prints a
// `{ "terminalSequence": "..." }` response for Claude Code to emit. Hooks run
// without a controlling terminal, so OSC sequences must go through Claude Code
// itself (it handles tmux/screen re-wrapping); writing /dev/tty directly fails.
//
// Mapped from the pi `notify` extension (extensions/notify/): pi notifies on
// agent_end for multi-turn or long tasks; Claude Code's Notification event fires
// `success`/`error` at the equivalent completion points and already carries a
// message + title in the payload, so no summarization LLM call is needed here.
//
// Zero dependencies; runs on the Node that ships with Claude Code.

let raw = "";
for await (const chunk of process.stdin) {
  raw += chunk;
}

let payload = {};
try {
  payload = raw.trim() ? JSON.parse(raw) : {};
} catch {
  process.exit(0); // never fail a session on an unparsable payload
}

const message = typeof payload.message === "string" ? payload.message.trim() : "";
if (!message) process.exit(0); // nothing worth notifying (e.g. autocompact events)

const title =
  typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "Claude Code";
const type = typeof payload.notification_type === "string" ? payload.notification_type : "";

process.stdout.write(JSON.stringify({ terminalSequence: pickSequence(title, message, type) }) + "\n");

/** Pick an OSC notification escape sequence for the detected terminal. */
function pickSequence(title, message, type) {
  const body = message.replace(/\u001b/g, "").replace(/\n/g, " ").trim();
  const label = type ? `${type}: ${title}` : title;

  if (process.env.KITTY_WINDOW_ID) {
    // Kitty: two-part persistent notification (title + body) — same form as the pi notify extension.
    return `\u001b]99;i=1:d=1;${title}\u001b\\\u001b]99;i=1:p=body;${body}\u001b\\`;
  }
  if (process.env.TERM_PROGRAM === "iTerm.app" || process.env.ITERM_SESSION_ID) {
    // iTerm2 / ConEmu / Windows Terminal / WezTerm: OSC 9.
    return `\u001b]9;${label}: ${body}\u0007`;
  }
  // urxvt / Ghostty / Warp, and default fallback: OSC 777.
  return `\u001b]777;notify;${label};${body}\u0007`;
}
