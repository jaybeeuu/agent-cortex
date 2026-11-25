/**
 * Idle-watch extension.
 *
 * A session works only when something prompts it. While ralph runs, its workers
 * can stall or vanish, and work that becomes ready sits there until a human
 * speaks. This extension supplies the missing clock: one tool, `idle_watch`,
 * which a caller starts when its session starts and leaves running until the
 * session closes.
 *
 * Arming returns at once. The tool schedules the first tick and ends the turn,
 * so the session stays interactive while the cadence runs; nothing here holds a
 * turn open waiting for an answer. Each tick runs one configured check as a
 * child process with a timeout, reduces its JSON to a digest of ids, and sends
 * one message carrying only what changed. A tick that changes nothing, fails or
 * times out sends nothing at all.
 *
 * The watch is session-scoped and has no tick budget: it runs until it is
 * stopped or the session shuts down, because the work it watches for can arrive
 * at any point in the session. A caller that finds it stopped re-arms it.
 *
 * The check owns what is worth saying — it is the caller's script, named by
 * configuration. This extension owns the cadence, the digest and the nudge, so
 * it holds no domain vocabulary and runs no tracker query of its own.
 */

import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { DEFAULT_INTERVAL_MS, IdleWatch, MAX_BACKOFF_MS } from "./watch.ts";
import type { CommandRunner, NudgeMessage, WatchStatus } from "./watch.ts";

/** The single tool this extension registers. */
export const TOOL_NAME = "idle_watch";

/**
 * Environment configuration for the check script, the counterpart of
 * `AGENT_CORTEX_POST_MERGE_CHECK`. A relative value resolves against the package
 * this extension was installed into, never against the caller's directory.
 */
export const CHECK_ENV = "AGENT_CORTEX_IDLE_WATCH_CHECK";

/** How long one check may run before pi kills it, and the tick counts as failed. */
export const CHECK_TIMEOUT_MS = 60_000;

/** The package root: `extensions/<name>/` sits two levels below it. */
const PACKAGE_ROOT = new URL("../../", import.meta.url);

/** Milliseconds as the seconds a message states. */
function seconds(ms: number): number {
  return ms / 1000;
}

/**
 * The check script to run: the caller's value first, else the environment's.
 *
 * A relative value resolves against the package root, so a staged install —
 * `extensions/` beside `skills/` — finds a package script by the same relative
 * path this checkout does, and the extension bakes in no absolute path of its
 * own. An absolute value is taken as given, which is how a test or a user points
 * at a script outside the package.
 */
export function resolveScript(spec: string | undefined): string | undefined {
  const value = spec?.trim();
  if (value === undefined || value === "") return undefined;
  if (isAbsolute(value)) return value;
  return fileURLToPath(new URL(value, PACKAGE_ROOT));
}

/**
 * Run the check as a child process with the session's own executor, so a tick
 * inherits pi's timeout, cancellation and output limits.
 */
export function execRunner(pi: Pick<ExtensionAPI, "exec">): CommandRunner {
  return async (invocation) => {
    const result = await pi.exec(process.execPath, [invocation.script], {
      cwd: invocation.cwd,
      timeout: CHECK_TIMEOUT_MS,
    });
    return {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      killed: result.killed,
    };
  };
}

/** What `status` prints: one line per question a caller asks about its watch. */
export function reportText(status: WatchStatus): string {
  return [
    `Idle watch: ${status.watching ? "watching" : "stopped"}`,
    `- Check: ${status.script} in ${status.project}`,
    `- Last check: ${status.lastCheck ?? "none yet"}`,
    `- Checks run: ${status.checksRun}`,
    `- Nudges sent: ${status.nudgesSent}`,
  ].join("\n");
}

export default function idleWatchExtension(pi: ExtensionAPI): void {
  /**
   * The session's one watch. A stopped watch is kept rather than dropped, so
   * `status` still reports what it did: a watch that never fired is a
   * measurement, not an absence.
   */
  let watch: IdleWatch | undefined;

  const deliver = (message: NudgeMessage): void => {
    // A change has to reach a session that is idle, so the nudge starts a turn.
    // A session in the middle of a turn reads it once that turn is over.
    pi.sendMessage(message, { deliverAs: "followUp", triggerTurn: true });
  };

  const base = seconds(DEFAULT_INTERVAL_MS);
  const cap = seconds(MAX_BACKOFF_MS);

  pi.registerTool({
    name: TOOL_NAME,
    label: "Idle watch",
    description: [
      "Arm a watch that polls one configured check on a backing-off cadence and sends one message",
      "when the check's result changes. Start it when the session starts and leave it running until",
      "the session closes: it returns at once, so this turn ends and the session stays interactive.",
      "A tick that changes nothing, fails or times out sends nothing. `status` reports whether it is",
      "still running without polling; `stop` ends it.",
    ].join(" "),
    promptSnippet: `${TOOL_NAME}: start the session's watch once; re-arm it whenever status says it stopped`,
    parameters: Type.Object({
      action: Type.Optional(
        Type.Union([Type.Literal("start"), Type.Literal("stop"), Type.Literal("status")], {
          description:
            "start (re-)arms a watch and ends this turn; stop ends it; status reports it. Default: start.",
        }),
      ),
      command: Type.Optional(
        Type.String({
          description:
            `Check script to poll, overriding ${CHECK_ENV}. A relative path resolves against the ` +
            "installed package; leave it out when the environment already names the check.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const action = params.action ?? "start";

      if (action === "stop") {
        if (watch === undefined || !watch.active) {
          return {
            content: [{ type: "text" as const, text: "No idle watch is running, so nothing was stopped." }],
            details: watch?.status ?? stoppedStatus(),
          };
        }

        watch.stop();
        return {
          content: [
            {
              type: "text" as const,
              text: `The idle watch is stopped. Nothing is polling.\n\n${reportText(watch.status)}`,
            },
          ],
          details: watch.status,
        };
      }

      if (action === "status") {
        if (watch === undefined) {
          return {
            content: [{ type: "text" as const, text: "No idle watch has been armed in this session." }],
            details: stoppedStatus(),
          };
        }

        return {
          content: [{ type: "text" as const, text: reportText(watch.status) }],
          details: watch.status,
        };
      }

      const configured = params.command?.trim() || process.env[CHECK_ENV];
      const script = resolveScript(configured);
      if (script === undefined) {
        // Nothing has been armed at this point, so the message is the whole
        // effect of the call and the session is untouched.
        throw new Error(
          `No idle check is configured. Pass \`command\` or set ${CHECK_ENV}; a relative path ` +
            "resolves against the installed package. Nothing was started.",
        );
      }

      watch?.stop();
      watch = new IdleWatch({
        project: ctx.cwd,
        script,
        runCommand: execRunner(pi),
        deliver,
        warn: (message) => ctx.ui.notify(message, "warning"),
      });
      watch.start();

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Idle watch armed. This turn ends now, so the session stays interactive.",
              `- Check: ${script}`,
              `- Cadence: one tick every ${base}s, backing off to ${cap}s while nothing changes`,
              "- Scope: this session. It runs until you stop it or the session ends, with no tick limit.",
              "A tick sends one message only when the digest changes; a failed or timed-out tick sends nothing.",
            ].join("\n"),
          },
        ],
        details: watch.status,
        // The caller armed the watch because it has nothing to do. Ending the
        // turn is the point: the session goes idle and the watch wakes it.
        terminate: true,
      };
    },
  });

  // The watch's handle is this extension's own state, so a session that shuts
  // down leaves no timer behind and no handle for anyone to track on disk.
  pi.on("session_shutdown", () => {
    watch?.stop();
  });
}

/** The report for a session that has never armed a watch. */
function stoppedStatus(): WatchStatus {
  return {
    watching: false,
    script: "",
    project: "",
    lastCheck: null,
    checksRun: 0,
    nudgesSent: 0,
  };
}
