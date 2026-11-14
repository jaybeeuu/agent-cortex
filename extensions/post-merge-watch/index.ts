/**
 * Post-merge watch extension.
 *
 * A human merges the feature PR, and the CI run for the merge commit decides
 * what happens next. Nothing tells the agent when that run concludes: the merge
 * happens outside the session, and by the time the run settles the agent is idle.
 * This extension makes the session wake up with the verdict.
 *
 * It polls the deterministic check script
 * (`skills/workflow/ralph/scripts/post-merge-check.mjs`) on a timer and, when the
 * script reports a verdict, sends one follow-up message — `deliverAs:
 * "followUp"`, `triggerTurn: true` — so an idle session starts a turn with the
 * result. The script owns the verdict; this extension runs it and forwards the
 * exit code. It makes no model call.
 *
 * Opt-in per session through the `--post-merge-watch <bead>` flag. State lives
 * under `~/.pi/agent-cortex/post-merge-watch/`, one file per project and bead,
 * and is removed when the watch settles or the session shuts down.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { PostMergeWatch, DEFAULT_INTERVAL_MS, DEFAULT_MAX_ATTEMPTS } from "./watch.ts";
import type { CheckRun, CheckInvocation, WakeMessage } from "./watch.ts";

/** The CLI flag that starts a watch: `--post-merge-watch <bead>`. */
export const WATCH_FLAG = "post-merge-watch";

/**
 * Environment override for the check script path. The default resolves against
 * this module, so the staged pi package (`extensions/` beside `skills/`) and a
 * checkout of this repository both find the shipped script without a hardcoded
 * absolute path.
 */
export const CHECK_SCRIPT_ENV = "AGENT_CORTEX_POST_MERGE_CHECK";

/** The check script's location in a staged install and in this repository. */
const DEFAULT_CHECK_SCRIPT = new URL(
  "../../skills/workflow/ralph/scripts/post-merge-check.mjs",
  import.meta.url,
);

/** How long one check invocation may take before pi kills it. */
const CHECK_TIMEOUT_MS = 120_000;

/** The state directory, under the agent-cortex global area, never in the project. */
export function stateDir(): string {
  return join(homedir(), ".pi", "agent-cortex", "post-merge-watch");
}

/** The check script this extension polls. */
export function checkScript(): string {
  const override = process.env[CHECK_SCRIPT_ENV];
  return override !== undefined && override !== "" ? override : fileURLToPath(DEFAULT_CHECK_SCRIPT);
}

export default function postMergeWatchExtension(pi: ExtensionAPI): void {
  // Registered here, in the factory: pi matches parsed CLI flags against the
  // extensions loaded at startup, so a flag registered from `session_start` is
  // rejected as an unknown option.
  pi.registerFlag(WATCH_FLAG, {
    description: "Watch the post-merge check for a bead and wake the session with the verdict",
    type: "string",
  });

  /** One watch per bead, so a reloaded session does not start a second one. */
  const watches = new Map<string, PostMergeWatch>();

  const runCheck = async (invocation: CheckInvocation): Promise<CheckRun> => {
    const result = await pi.exec(process.execPath, [invocation.script, ...invocation.args], {
      cwd: invocation.cwd,
      timeout: CHECK_TIMEOUT_MS,
    });
    return { code: result.code, stdout: result.stdout, stderr: result.stderr, killed: result.killed };
  };

  /**
   * The verdict goes out as a follow-up message with `triggerTurn`, so a session
   * that is idle starts a turn and one that is busy reads it after the turn in
   * progress instead of interrupting it.
   */
  const deliver = (message: WakeMessage): void => {
    pi.sendMessage(message, { deliverAs: "followUp", triggerTurn: true });
  };

  const watchedBead = (): string | undefined => {
    const value = pi.getFlag(WATCH_FLAG);
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };

  pi.on("session_start", async (_event, ctx) => {
    for (const [bead, watch] of watches) {
      if (!watch.active) watches.delete(bead);
    }

    const bead = watchedBead();
    if (bead === undefined || watches.has(bead)) return;

    const watch = new PostMergeWatch({
      bead,
      project: ctx.cwd,
      script: checkScript(),
      stateDir: stateDir(),
      runCheck,
      deliver,
      intervalMs: DEFAULT_INTERVAL_MS,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      warn: (message) => ctx.ui.notify(message, "warning"),
    });

    watches.set(bead, watch);
    await watch.start();
  });

  pi.on("session_shutdown", async () => {
    const stopping = [...watches.values()].map((watch) => watch.stop());
    watches.clear();
    await Promise.all(stopping);
  });
}
