/**
 * Session transition extension.
 *
 * A boundary hands the session one of two outcomes — a stay or a switch — and
 * each one has its own effect on the window:
 *
 *   - a **stay** compacts it: `request_compact` arms a compaction, so the next
 *     item on the theme starts with what the last one established and without
 *     its raw turns;
 *   - a **switch** flushes it: `request_flush` arms a replacement session that
 *     carries nothing, because a summary of the theme just left is the noise the
 *     flush exists to remove.
 *
 * ## Why each request is armed rather than performed
 *
 * Neither transition may run while the turn that asked for it is still going.
 * `ctx.compact()` and `ctx.newSession()` both act on a settled session, and a
 * session replacement tears down the very turn it would be called from, so a
 * tool cannot perform either one. Each tool therefore records the request,
 * returns a confirmation, and ends the turn with `terminate: true`; an
 * `agent_settled` handler acts on it.
 *
 * ## Why the flush dispatches a command
 *
 * `ctx.compact()` is on `ExtensionContext`, so the settle handler calls it
 * directly. `ctx.newSession()` is on `ExtensionCommandContext` only
 * (`docs/extensions.md`, "ExtensionCommandContext"), and event handlers receive
 * the narrower interface, so the handler cannot reach it at all. The flush is
 * therefore dispatched as this extension's own command through
 * `sendUserMessage(..., { expandPromptTemplates: true })`, which runs the command
 * instead of prompting the model — the pattern pi documents for a tool that must
 * reach a command-only API (`docs/extensions.md`, "ctx.reload()"), and the one
 * this package's `interrupt-bookmark` extension already uses.
 *
 * ## The request is single-use, and carries nothing
 *
 * The armed request is one in-memory slot. Taking it empties the slot before
 * anything is acted on, so a second settle cannot act twice on one arming, and a
 * second tool call arms again. Nothing is written to disk.
 *
 * The replacement session is seeded with nothing: no setup step, no summary, no
 * theme id. Its own session-start work re-establishes the rubric and the queue,
 * and the tracker restores any theme on demand.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** The tool that asks for a compaction: the transition a stay makes. */
export const COMPACT_TOOL = "request_compact";

/** The tool that asks for a flush: the transition a switch makes. */
export const FLUSH_TOOL = "request_flush";

/** The command that performs the flush, dispatched once the turn settles. */
export const FLUSH_COMMAND = "session-flush";

/** Which transition a request asks for. */
export type TransitionKind = "compact" | "flush";

/** A transition waiting for the turn to settle. Plain data only. */
export interface TransitionRequest {
  kind: TransitionKind;
  /** One line: what this item established, or why the theme is changing. */
  reason: string;
}

/** What a tool call did with the request. */
export interface ArmOutcome {
  /** True when the request is waiting for the turn to settle. */
  armed: boolean;
  kind: TransitionKind;
  /** The words that describe what the transition will do. */
  effect: string;
}

/** What a settle handler did. */
export interface SettleOutcome {
  /** The request the settle took, or undefined when nothing was armed. */
  acted: TransitionRequest | undefined;
}

/** What the flush command did. */
export interface FlushOutcome {
  /** True when a replacement session was created. */
  replaced: boolean;
  /** True when nothing was pending, so the command left the session alone. */
  idle?: boolean;
  /** True when pi or an extension cancelled the replacement. */
  cancelled?: boolean;
  /** The reason the flush was armed with. */
  reason?: string;
}

/**
 * Why this reason cannot arm a transition, or undefined when it can.
 *
 * An empty reason is refused here, before anything is armed, so the session is
 * untouched and the message says what the reason is for.
 */
export function refusal(reason: string): string | undefined {
  if (reason.trim() === "") {
    return (
      "A one-line reason is required: say what the item established for a compact, " +
      "or why the theme is changing for a flush. Nothing was armed."
    );
  }
  return undefined;
}

/** What a transition of this kind does to the window, in one line. */
export function effect(kind: TransitionKind): string {
  return kind === "compact"
    ? "summarises the window and keeps the recent tail"
    : "drops the window and carries nothing across";
}

export default function sessionTransitionExtension(pi: ExtensionAPI): void {
  /**
   * The transition the next settle must act on. One slot: arming replaces the
   * request, and taking it empties the slot, so a second settle acts on nothing.
   */
  let armed: TransitionRequest | undefined;

  /**
   * The reason waiting for the flush command. The command receives no argument,
   * so a reason with spaces or punctuation never has to survive a command line.
   */
  let flushReason: string | undefined;

  /** Arm a transition, replacing any request that has not been acted on. */
  function arm(request: TransitionRequest): ArmOutcome {
    armed = request;
    return { armed: true, kind: request.kind, effect: effect(request.kind) };
  }

  /** Take the armed request, leaving the slot empty so it cannot be acted on twice. */
  function take(): TransitionRequest | undefined {
    const request = armed;
    armed = undefined;
    return request;
  }

  /** Register one arming tool. Both tools differ only in which transition they ask for. */
  function registerArmingTool(
    kind: TransitionKind,
    name: string,
    label: string,
    description: string,
    promptSnippet: string,
  ): void {
    pi.registerTool({
      name,
      label,
      description,
      promptSnippet,
      parameters: Type.Object({
        reason: Type.String({
          description:
            kind === "compact"
              ? "One line: what this item established, so the summary keeps it."
              : "One line: why the theme is changing, so the next session knows what was left.",
        }),
      }),
      async execute(_toolCallId, params) {
        const reason = params.reason.trim();
        const problem = refusal(reason);
        if (problem !== undefined) {
          // A thrown message reaches the model as the tool's error result, and
          // nothing has been armed at this point.
          throw new Error(problem);
        }

        const outcome = arm({ kind, reason });

        return {
          content: [
            {
              type: "text" as const,
              text:
                `${label} armed: it ${outcome.effect} once this turn settles. ` +
                `Reason recorded: ${reason}`,
            },
          ],
          details: outcome,
          // The transition acts on a settled session, so end the turn rather
          // than letting the model keep working in a window about to change.
          terminate: true,
        };
      },
    });
  }

  registerArmingTool(
    "compact",
    COMPACT_TOOL,
    "Compact the window",
    "Summarise the window and keep its recent tail, so the next item on this theme continues from what this one established. Runs once the turn is over.",
    `${COMPACT_TOOL}: compact the window at a boundary where the decision is a stay`,
  );

  registerArmingTool(
    "flush",
    FLUSH_TOOL,
    "Flush the window",
    "Drop the window and carry nothing across, so a theme that has been left leaves no summary behind. Runs once the turn is over.",
    `${FLUSH_TOOL}: flush the window at a boundary where the decision is a switch`,
  );

  // Command handlers are the only place pi allows a session replacement. The
  // dispatch uses `expandPromptTemplates`, which runs the command instead of
  // prompting the model, so nothing is sent to a provider here.
  pi.registerCommand(FLUSH_COMMAND, {
    description: "Flush the window: replace the session, carrying nothing across",
    handler: async (_args, ctx) => {
      const reason = flushReason;
      flushReason = undefined;

      if (reason === undefined) {
        ctx.ui.notify("No flush was armed, so nothing was flushed.", "warning");
        return;
      }

      // The parent is recorded in the new session's header as lineage. It seeds
      // nothing: no setup step, no summary, no theme id.
      const parentSession = ctx.sessionManager.getSessionFile();

      ctx.ui.notify(`Flushing the window: ${reason}`, "info");

      const result = await ctx.newSession({ parentSession });

      if (result.cancelled) {
        // The session was left in place, so this context is still the live one.
        ctx.ui.notify("The flush was cancelled. The window is unchanged.", "warning");
      }
    },
  });

  pi.on("agent_settled", (_event, ctx) => {
    const request = take();
    if (request === undefined) return;

    if (request.kind === "compact") {
      // `compact()` is on the event context, and reports through its callbacks
      // rather than by resolving, so nothing here awaits it.
      ctx.compact({
        customInstructions: request.reason,
        onComplete: () => {
          ctx.ui.notify("Window compacted. The recent tail is kept.", "info");
        },
        onError: (error) => {
          ctx.ui.notify(
            `Compaction failed: ${error.message}. The window is unchanged; continue in it.`,
            "error",
          );
        },
      });
      return;
    }

    flushReason = request.reason;
    pi.sendUserMessage(`/${FLUSH_COMMAND}`, { expandPromptTemplates: true });
  });
}
