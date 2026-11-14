/**
 * Interrupt bookmark extension.
 *
 * An interruption mid-task — a meeting note, PR feedback to pass on, a Slack
 * todo — drags its turns into the context that the original task then has to
 * carry. PI can rewind a session tree and summarise the abandoned branch, but
 * nothing exposes that as a deliberate operation. This extension adds two tools:
 *
 *   - `interrupt_checkpoint` captures the current leaf id and returns it, so the
 *     caller holds a resume point;
 *   - `interrupt_resume` rewinds to that id, keeps the abandoned branch under a
 *     summary, and labels the summary entry `interrupt`.
 *
 * The summary comes from pi's own tree-navigation summariser
 * (`navigateTree(..., { summarize: true })`). This extension makes no model call
 * of its own. Nothing is deleted: the abandoned branch stays in the session
 * file, reachable from the session tree.
 *
 * ## Why the rewind runs in two steps
 *
 * PI exposes `waitForIdle()` and `navigateTree()` on `ExtensionCommandContext`
 * only, because they can deadlock when called from a handler that runs inside a
 * turn (`docs/extensions.md`, "ExtensionCommandContext"). A tool receives
 * `ExtensionToolContext`, and the session throws on navigation while it is
 * streaming — which it always is while a tool call is running. A tool therefore
 * cannot navigate the tree, and waiting for idle inside a tool call could never
 * finish.
 *
 * So the resume tool validates the request, records it, and ends the turn. An
 * `agent_settled` handler then dispatches the command that performs the rewind,
 * which is the pattern pi documents for a tool that must reach a command-only
 * API (`docs/extensions.md`, "ctx.reload()"). One consequence is worth stating:
 * the summary entry is reported to the human and written to the session as a
 * custom entry, not returned in the tool result — the tool result belongs to the
 * branch that the rewind summarises.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** The tool that captures a resume point. */
export const CHECKPOINT_TOOL = "interrupt_checkpoint";

/** The tool that asks for a rewind. */
export const RESUME_TOOL = "interrupt_resume";

/** The command that performs the rewind, dispatched once the turn settles. */
export const REWIND_COMMAND = "interrupt-rewind";

/** The label pi attaches to the branch-summary entry a rewind leaves behind. */
export const SUMMARY_LABEL = "interrupt";

/** Custom-entry type recording the outcome. Never part of the model's context. */
export const REWIND_ENTRY = "interrupt-rewind";

/**
 * How many times a rewind is attempted: the first try, then exactly one retry.
 * A second failure is reported, never retried again.
 */
export const REWIND_ATTEMPTS = 2;

/** A rewind waiting for the turn to settle. */
export interface RewindRequest {
  /** The entry id the caller wants to return to. */
  checkpointId: string;
  /** What the interruption was about, as summariser instructions. */
  summary: string;
}

/** What a rewind did, or why it did nothing. */
export interface RewindReport {
  ok: boolean;
  /** How many navigation attempts were made. */
  attempts: number;
  /** The `branch_summary` entry the rewind left behind, when there is one. */
  summaryEntryId?: string;
  /** True when pi cancelled the navigation (an extension or the user declined). */
  cancelled?: boolean;
  /** Why the last attempt failed. */
  reason?: string;
}

/** The parts of the command context a rewind uses. */
type RewindContext = Pick<
  ExtensionCommandContext,
  "waitForIdle" | "navigateTree" | "sessionManager"
>;

/** The parts of the tool context the two tools read. */
type BookmarkContext = Pick<ExtensionToolContext, "sessionManager">;

/** Instructions for pi's summariser: what the interruption was, and why it is summarised. */
export function summariserInstructions(summary: string): string {
  return [
    "The task was interrupted. Record what the interruption was about, and what the abandoned turns",
    "were doing, so the task can resume without them.",
    `The interruption: ${summary}`,
  ].join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The branch-summary entry a navigation from `previousLeaf` appended, if any.
 *
 * `navigateTree()` returns this entry, but `ExtensionCommandContext` declares
 * only `cancelled` in its result type, and after the call the leaf is the label
 * entry pi appends on top of the summary. The entry is therefore found by the
 * `fromId` pi records on it — no cast, and no assumption about the leaf.
 */
function summaryAfter(
  sessionManager: RewindContext["sessionManager"],
  previousLeaf: string | null,
): string | undefined {
  const entries = sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === "branch_summary" && entry.fromId === previousLeaf) return entry.id;
  }
  return undefined;
}

/**
 * Rewind to `checkpointId`, summarising the abandoned branch.
 *
 * Navigation rejects while a response, a compaction or another navigation is
 * active, so each attempt waits for idle first. Waits and attempts are
 * deliberately paired: an attempt that skips the wait fails for the reason the
 * wait exists.
 */
export async function rewind(ctx: RewindContext, request: RewindRequest): Promise<RewindReport> {
  let reason = "";

  for (let attempt = 1; attempt <= REWIND_ATTEMPTS; attempt += 1) {
    await ctx.waitForIdle();

    // Captured before the navigation, so the summary it writes can be found by
    // the branch it abandoned.
    const previousLeaf = ctx.sessionManager.getLeafId();

    try {
      const result = await ctx.navigateTree(request.checkpointId, {
        summarize: true,
        customInstructions: summariserInstructions(request.summary),
        label: SUMMARY_LABEL,
      });

      return {
        ok: true,
        attempts: attempt,
        cancelled: result.cancelled,
        summaryEntryId: summaryAfter(ctx.sessionManager, previousLeaf),
      };
    } catch (error) {
      reason = errorMessage(error);
    }
  }

  return { ok: false, attempts: REWIND_ATTEMPTS, reason };
}

/**
 * Why this request cannot be rewound, or undefined when it can.
 *
 * An unknown id is refused here, before anything is queued or written, so the
 * session is untouched and the message names the id that failed.
 */
export function refusal(ctx: BookmarkContext, request: RewindRequest): string | undefined {
  if (ctx.sessionManager.getEntry(request.checkpointId) === undefined) {
    return `Unknown checkpoint id: ${request.checkpointId}. Call ${CHECKPOINT_TOOL} to record a resume point.`;
  }

  if (ctx.sessionManager.getLeafId() === request.checkpointId) {
    return `Checkpoint ${request.checkpointId} is the current position, so there are no interrupt turns to summarise. Nothing was rewound.`;
  }

  return undefined;
}

export default function interruptBookmarkExtension(pi: ExtensionAPI): void {
  /**
   * The rewind the next settle must dispatch. At most one: a second would
   * navigate from a position the first has already replaced.
   */
  let pending: RewindRequest | undefined;

  /**
   * The summary waiting for its dispatch, keyed by checkpoint id. The command
   * receives the id in its argument text and the summary from here, so a summary
   * with spaces or newlines never has to survive a command line. One entry at a
   * time: a new request replaces the previous one.
   */
  const handoff = new Map<string, string>();

  pi.registerTool({
    name: CHECKPOINT_TOOL,
    label: "Interrupt Checkpoint",
    description:
      "Record the current session position and return its id, so an interruption can be rewound later.",
    promptSnippet: `${CHECKPOINT_TOOL}: record a resume point before handling an interruption`,
    promptGuidelines: [
      `Use ${CHECKPOINT_TOOL} before an interruption is handled, and ${RESUME_TOOL} to return to it afterwards.`,
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const leafId = ctx.sessionManager.getLeafId();

      if (leafId === null) {
        return {
          content: [
            {
              type: "text" as const,
              text: "The session has no entries yet, so there is no position to record.",
            },
          ],
          details: { checkpointId: null },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Checkpoint ${leafId}. Pass this id to ${RESUME_TOOL} to rewind here.`,
          },
        ],
        details: { checkpointId: leafId },
      };
    },
  });

  pi.registerTool({
    name: RESUME_TOOL,
    label: "Interrupt Resume",
    description:
      "Rewind to a checkpoint, keep the abandoned branch under a summary, then continue from the checkpoint. Runs after the current turn ends.",
    promptSnippet: `${RESUME_TOOL}: rewind to a checkpoint and summarise the interruption away`,
    parameters: Type.Object({
      checkpointId: Type.String({
        description: `The id ${CHECKPOINT_TOOL} returned.`,
      }),
      summary: Type.String({
        description: "What the interruption was about, so the summariser records it.",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (pending !== undefined) {
        throw new Error(
          `A rewind to ${pending.checkpointId} is already scheduled. Nothing was changed.`,
        );
      }

      const problem = refusal(ctx, params);
      if (problem !== undefined) {
        // A thrown message reaches the model as the tool's error result, and
        // nothing has been written or queued at this point.
        throw new Error(problem);
      }

      pending = { checkpointId: params.checkpointId, summary: params.summary };

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Rewind to ${params.checkpointId} scheduled. The abandoned branch is kept under a ` +
              `summary labelled "${SUMMARY_LABEL}" once this turn ends; this tool call is part of it.`,
          },
        ],
        details: { checkpointId: params.checkpointId, scheduled: true },
        // The rewind needs the turn over, so end it rather than letting the model
        // keep working in a context that is about to be rewound.
        terminate: true,
      };
    },
  });

  // Command handlers are the only place pi allows tree navigation. The dispatch
  // uses `expandPromptTemplates`, which runs the command instead of prompting the
  // model, so nothing is sent to a provider here.
  pi.registerCommand(REWIND_COMMAND, {
    description: "Rewind to a scheduled interrupt checkpoint and summarise the abandoned branch",
    handler: async (args, ctx) => {
      const checkpointId = args.trim();

      if (checkpointId === "") {
        ctx.ui.notify("No checkpoint was named, so nothing was rewound.", "warning");
        return;
      }

      const summary = handoff.get(checkpointId);
      if (summary === undefined) {
        ctx.ui.notify(
          `No interrupt rewind is pending for ${checkpointId}, so nothing was rewound.`,
          "warning",
        );
        return;
      }
      handoff.delete(checkpointId);

      const report = await rewind(ctx, { checkpointId, summary });
      pi.appendEntry(REWIND_ENTRY, {
        checkpointId,
        attempts: report.attempts,
        ok: report.ok,
        cancelled: report.cancelled ?? false,
        summaryEntryId: report.summaryEntryId,
        reason: report.reason,
      });

      if (!report.ok) {
        ctx.ui.notify(
          `Interrupt rewind to ${checkpointId} failed after ${report.attempts} attempts: ${report.reason}. The conversation is unchanged; continue in the current context and say the rewind failed.`,
          "error",
        );
        return;
      }

      if (report.cancelled === true) {
        ctx.ui.notify(
          `Interrupt rewind to ${checkpointId} was cancelled. The conversation is unchanged.`,
          "warning",
        );
        return;
      }

      const summaryEntry =
        report.summaryEntryId === undefined ? "" : ` (summary entry ${report.summaryEntryId})`;
      ctx.ui.notify(
        `Rewound to ${checkpointId}${summaryEntry}. The abandoned branch is kept, labelled "${SUMMARY_LABEL}".`,
        "info",
      );
    },
  });

  pi.on("agent_settled", () => {
    const request = pending;
    if (request === undefined) return;

    // Taken here, so a second settle cannot dispatch the same rewind twice. A
    // dispatch that never runs leaves no pending request behind.
    pending = undefined;
    handoff.clear();
    handoff.set(request.checkpointId, request.summary);
    pi.sendUserMessage(`/${REWIND_COMMAND} ${request.checkpointId}`, { expandPromptTemplates: true });
  });
}
