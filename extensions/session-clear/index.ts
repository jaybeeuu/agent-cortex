/**
 * Session Clear extension.
 *
 * Registers `/clear`: replace the session with an empty one while keeping its
 * identity — display name, model, thinking level, and the active agent.
 *
 * PI already has `/new`, but the replacement starts from the defaults, so
 * clearing the context after a tangent costs three follow-up commands. `/clear`
 * carries the identity across the replacement instead.
 *
 * The identity is captured as plain data before teardown, because the captured
 * `pi` and command `ctx` are invalidated when the old session is disposed and
 * `withSession`'s context exposes no session mutator. PI re-evaluates every
 * extension module for the replacement runtime (`moduleCache: false`), so a
 * module-level variable cannot carry the data over; it crosses in one
 * process-global slot, and the replacement instance applies it at its own
 * `session_start`.
 *
 * The active agent needs no handling here: the replacement runtime is built from
 * the same launch configuration, so an agent selected with `--agent` re-applies
 * itself at `session_start` exactly as it did on startup.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/** Provenance entry written to the replacement session. Never sent to the model. */
export const PROVENANCE_ENTRY = "session-clear";

/** The model the session is using, as the extension context reports it. */
type SessionModel = NonNullable<ExtensionContext["model"]>;

/** The thinking level the session is using, as the extension API reports it. */
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

/** What `/clear` carries across the replacement. Plain data only. */
export interface Identity {
  /** Session file the identity came from; also the replacement's parent. */
  sourceSessionFile: string | undefined;
  name: string | undefined;
  model: SessionModel | undefined;
  thinkingLevel: ThinkingLevel;
}

/** The single process-global slot that carries an identity across replacement. */
const HANDOFF_KEY = "__agentCortexSessionClearIdentity";

interface HandoffSlot {
  __agentCortexSessionClearIdentity?: Identity;
}

function handoff(): HandoffSlot {
  return globalThis as unknown as HandoffSlot;
}

/** Capture the parts of the session identity that the replacement starts without. */
export function captureIdentity(pi: ExtensionAPI, ctx: ExtensionCommandContext): Identity {
  return {
    sourceSessionFile: ctx.sessionManager.getSessionFile(),
    name: pi.getSessionName(),
    model: ctx.model,
    thinkingLevel: pi.getThinkingLevel(),
  };
}

function rememberIdentity(identity: Identity): void {
  handoff()[HANDOFF_KEY] = identity;
}

function forgetIdentity(): void {
  delete handoff()[HANDOFF_KEY];
}

/**
 * Take the identity captured for this replacement, or undefined when this
 * session start was not a `/clear`.
 */
function takeIdentity(previousSessionFile: string | undefined): Identity | undefined {
  const slot = handoff();
  const identity = slot[HANDOFF_KEY];
  if (identity === undefined || identity.sourceSessionFile !== previousSessionFile) {
    return undefined;
  }
  delete slot[HANDOFF_KEY];
  return identity;
}

function sameModel(left: SessionModel | undefined, right: SessionModel | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.provider === right.provider && left.id === right.id;
}

/**
 * Re-apply the captured identity to the replacement session, then record where
 * the session came from and report the clear.
 *
 * The model and the thinking level are restored only when they differ from the
 * replacement's own values, so a default is never needlessly re-pinned.
 */
export async function reapplyIdentity(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  identity: Identity,
): Promise<void> {
  if (identity.name !== undefined) {
    pi.setSessionName(identity.name);
  }

  if (identity.model !== undefined && !sameModel(identity.model, ctx.model)) {
    await pi.setModel(identity.model);
  }

  // Read the level after the model restore: switching model re-derives it.
  if (pi.getThinkingLevel() !== identity.thinkingLevel) {
    pi.setThinkingLevel(identity.thinkingLevel);
  }

  pi.appendEntry(PROVENANCE_ENTRY, {
    clearedFrom: identity.sourceSessionFile,
    at: new Date().toISOString(),
  });

  ctx.ui.notify(
    `Context cleared. Previous session: ${identity.sourceSessionFile ?? "(unsaved)"}`,
    "info",
  );
}

export default function sessionClearExtension(pi: ExtensionAPI): void {
  pi.registerCommand("clear", {
    description: "Clear the context, keeping the session name, model and thinking level",
    handler: async (_args, ctx) => {
      const identity = captureIdentity(pi, ctx);
      rememberIdentity(identity);

      const result = await ctx.newSession({ parentSession: identity.sourceSessionFile });

      // A cancelled switch leaves this session active, so nothing is coming to
      // collect the identity.
      if (result.cancelled) {
        forgetIdentity();
      }
    },
  });

  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "new") return;

    const identity = takeIdentity(event.previousSessionFile);
    if (identity === undefined) return;

    await reapplyIdentity(pi, ctx, identity);
  });
}
