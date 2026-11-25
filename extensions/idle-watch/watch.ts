/**
 * The idle watch: poll one configured check on a backing-off cadence, and nudge
 * the session only when the digest of the check's result changes.
 *
 * The check owns the judgement — what is worth saying, and in what shape. This
 * module owns four things: when to run the check again, when to stop, whether
 * the result changed, and what to say when it did. It holds no domain
 * vocabulary: an id is any non-empty string `id` field the check's JSON
 * mentions, tagged with the property that carried it. Nothing here knows what a
 * bead, a tracker, or a queue query is, and nothing here runs `bd`.
 *
 * The watch is session-scoped and bounded by nothing else: it ticks for as long
 * as it is started, and ends only when its caller stops it or the session shuts
 * down. No tick count, no clock and no wall-clock deadline ends it, because work
 * that becomes ready an hour into a quiet session is exactly what it is for.
 *
 * The watch never holds a turn open. It is started with `start()`, which
 * schedules the first tick and returns at once, so the caller's turn ends and
 * the session stays interactive while the cadence runs.
 *
 * Every collaborator is injected, so a test drives the whole lifecycle with a
 * scheduler it steps by hand. Nothing here imports pi, and nothing here sleeps.
 */

import { createHash } from "node:crypto";

/** Provenance of the nudge, and its custom-message type. */
export const NUDGE_CUSTOM_TYPE = "idle-watch";

/** Milliseconds between two checks while the interval sits at its base. */
export const DEFAULT_INTERVAL_MS = 15_000;

/** The longest the interval grows to while the result keeps repeating. */
export const MAX_BACKOFF_MS = 120_000;

/** One run of the check. */
export interface TickRun {
  /** Exit code. `0` means the run produced a digest; anything else sends nothing. */
  code: number;
  stdout: string;
  stderr: string;
  /** The run was terminated by the timeout, so its output may be incomplete. */
  killed: boolean;
}

/** One call of the check. */
export interface CommandInvocation {
  /** Absolute path of the check script. */
  script: string;
  /** The project directory the check runs in. */
  cwd: string;
}

export type CommandRunner = (invocation: CommandInvocation) => Promise<TickRun>;

/** The timer this module needs, injectable so a test owns the clock. */
export interface Scheduler {
  now(): Date;
  /**
   * Run `callback` once after `delayMs`, and return a function that cancels it.
   * The callback may return a promise: the real scheduler ignores it, and a test
   * scheduler awaits it to step one tick deterministically.
   */
  schedule(callback: () => void | Promise<void>, delayMs: number): () => void;
}

/**
 * The ids one check result mentioned, sorted, each tagged with the property
 * that carried it: `ready:agnt-ctx-1`.
 *
 * The tag is what makes a move a change. An id that leaves one list and joins
 * another is reported as removed and added, even though the id itself is
 * unchanged, so a bead that becomes stalled reaches the session as work that
 * changed rather than as silence.
 */
export type Digest = readonly string[];

/** What one tick changed, as the ids that arrived and the ids that left. */
export interface Change {
  added: string[];
  removed: string[];
}

/** The data the nudge carries beyond its text. */
export interface NudgeDetails {
  project: string;
  script: string;
  added: string[];
  removed: string[];
  checksRun: number;
  at: string;
}

/** The message `pi.sendMessage` receives. */
export interface NudgeMessage {
  customType: string;
  content: string;
  display: boolean;
  details: NudgeDetails;
}

/** The read-only report `status()` returns. */
export interface WatchStatus {
  watching: boolean;
  script: string;
  project: string;
  /** ISO time of the last tick, or `null` before the first one. */
  lastCheck: string | null;
  checksRun: number;
  nudgesSent: number;
}

/** Everything a watch needs, and the collaborators a test replaces. */
export interface IdleWatchOptions {
  /** The project the watch belongs to; also the directory the check runs in. */
  project: string;
  /** Absolute path of the check script. */
  script: string;
  runCommand: CommandRunner;
  deliver: (message: NudgeMessage) => void;
  scheduler?: Scheduler;
  intervalMs?: number;
  maxBackoffMs?: number;
  /** Report a problem that must not stop the watch, such as a check that threw. */
  warn?: (message: string) => void;
}

/** The real timer: `setTimeout`, cancelled by `clearTimeout`. */
export const systemScheduler: Scheduler = {
  now: () => new Date(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(() => void callback(), delayMs);
    // Never hold the host process open for a watch: pi's own REPL keeps it alive.
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Collect the ids under one property, tagging each with that property's name.
 *
 * An array's own entries are read first, and a nested value that carries no id
 * is descended into under the same tag, so `{ ready: [{ id }] }` and
 * `{ ready: { beads: [{ id }] } }` both yield `ready:<id>`.
 */
function collect(value: unknown, tag: string, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item) && typeof item.id === "string" && item.id !== "") {
        into.add(`${tag}:${item.id}`);
        continue;
      }
      collect(item, tag, into);
    }
    return;
  }

  if (!isRecord(value)) return;

  if (typeof value.id === "string" && value.id !== "") into.add(`${tag}:${value.id}`);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "id") collect(child, key, into);
  }
}

/**
 * Reduce a check's stdout to the ids it mentions.
 *
 * `undefined` means the run produced no digest: empty output, output that is not
 * JSON, or JSON that is not an object. A tick with no digest sends nothing and
 * leaves the previous digest in place, so a broken check cannot wake anyone and
 * cannot make the next good tick look like an arrival.
 */
export function digestOf(stdout: string): Digest | undefined {
  const text = stdout.trim();
  if (text === "") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;

  const tokens = new Set<string>();
  collect(parsed, "result", tokens);
  return [...tokens].sort();
}

/** The digest as one comparable value. Equal tokens are the same digest. */
export function digestHash(tokens: Digest): string {
  return createHash("sha256").update(tokens.join("\n")).digest("hex");
}

/** What changed between two digests, as sorted id lists. */
export function changeBetween(previous: Digest, next: Digest): Change {
  const before = new Set(previous);
  const after = new Set(next);
  return {
    added: next.filter((token) => !before.has(token)),
    removed: previous.filter((token) => !after.has(token)),
  };
}

/**
 * Build the nudge: the ids that arrived and the ids that left, and nothing else.
 *
 * The full result is deliberately absent. The message says what changed and
 * tells its reader to run the check for the rest, so a queue of forty beads
 * costs one line per change instead of forty lines per tick.
 */
export function buildNudge(details: NudgeDetails): NudgeMessage {
  const list = (tokens: string[]): string => (tokens.length === 0 ? "none" : tokens.join(", "));
  const content = [
    `The idle check changed: ${details.added.length} added, ${details.removed.length} removed.`,
    "",
    `- Added: ${list(details.added)}`,
    `- Removed: ${list(details.removed)}`,
    `- Check: ${details.script} in ${details.project}`,
    `- Tick: ${details.checksRun}, at ${details.at}`,
    "",
    "This message carries the change only. Run the check for the full result before deciding what to do.",
  ].join("\n");

  return { customType: NUDGE_CUSTOM_TYPE, content, display: true, details };
}

/**
 * One idle watch.
 *
 * A watch is active from `start()` until `stop()` is called. It has no tick
 * budget and no deadline of its own: the caller's session is the bound, so a
 * quiet watch backs off to the cap and keeps looking rather than stopping. A
 * stopped watch keeps its counts and its last check, so `status()` still answers
 * "what happened" — the zero-activation counter that is invisible is the reason
 * nobody notices a watch that never fires.
 */
export class IdleWatch {
  readonly #project: string;
  readonly #script: string;
  readonly #runCommand: CommandRunner;
  readonly #deliver: (message: NudgeMessage) => void;
  readonly #scheduler: Scheduler;
  readonly #intervalMs: number;
  readonly #maxBackoffMs: number;
  readonly #warn: (message: string) => void;

  #checks = 0;
  #nudges = 0;
  /** Consecutive ticks that changed nothing; the backoff exponent. */
  #quiet = 0;
  #lastCheck: Date | undefined;
  #digest: string | undefined;
  #tokens: Digest = [];
  #cancel: (() => void) | undefined;
  #watching = false;

  constructor(options: IdleWatchOptions) {
    this.#project = options.project;
    this.#script = options.script;
    this.#runCommand = options.runCommand;
    this.#deliver = options.deliver;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
    this.#warn = options.warn ?? (() => {});
  }

  /** Whether the cadence is still running. */
  get active(): boolean {
    return this.#watching;
  }

  /** The read-only report: whether it watches, when it last looked, and what it has done. */
  get status(): WatchStatus {
    return {
      watching: this.#watching,
      script: this.#script,
      project: this.#project,
      lastCheck: this.#lastCheck?.toISOString() ?? null,
      checksRun: this.#checks,
      nudgesSent: this.#nudges,
    };
  }

  /**
   * Start the cadence and return: nothing is awaited and no child process runs
   * before this returns, so the caller's turn ends and the session stays usable.
   *
   * A start is a fresh watch. The previous digest is dropped, so the first tick
   * reports the whole result as an arrival. That is the reset rule: a caller that
   * starts a watch after doing work is told what is there now, not what changed
   * since a watch it has already finished with.
   *
   * Starting an active watch replaces it rather than adding a second cadence: the
   * previous timer is cancelled first, so a re-arm after a stop leaves exactly
   * one cadence running.
   */
  start(): void {
    this.#cancelTimer();
    this.#checks = 0;
    this.#nudges = 0;
    this.#quiet = 0;
    this.#lastCheck = undefined;
    this.#digest = undefined;
    this.#tokens = [];
    this.#watching = true;
    this.#scheduleNext();
  }

  /** Stop the cadence. The next tick, if one is already in flight, is ignored. */
  stop(): void {
    this.#watching = false;
    this.#cancelTimer();
  }

  #cancelTimer(): void {
    this.#cancel?.();
    this.#cancel = undefined;
  }

  /**
   * The delay before the next tick: the base interval on the first quiet tick,
   * then doubled once per quiet tick, never above the cap.
   */
  #delay(): number {
    if (this.#quiet === 0) return this.#intervalMs;
    return Math.min(this.#intervalMs * 2 ** this.#quiet, this.#maxBackoffMs);
  }

  #scheduleNext(): void {
    this.#cancel = this.#scheduler.schedule(() => {
      this.#cancel = undefined;
      return this.#tick();
    }, this.#delay());
  }

  /** One tick. Never rejects: a throw would leave an unhandled rejection in the host. */
  async #tick(): Promise<void> {
    try {
      await this.#poll();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.#warn(`idle-watch: the tick failed: ${detail}`);
    }
  }

  async #poll(): Promise<void> {
    if (!this.#watching) return;

    this.#checks += 1;
    this.#lastCheck = this.#scheduler.now();

    const run = await this.#runSafely();
    // `stop()` may have landed while the check ran: nothing is listening now.
    if (!this.#watching) return;

    const next = run.killed || run.code !== 0 ? undefined : digestOf(run.stdout);
    if (next === undefined) {
      // A failed, timed-out or unreadable check sends nothing. The previous
      // digest stands, so a later good tick is compared with the last good one.
      this.#quiet += 1;
      this.#scheduleNext();
      return;
    }

    const hash = digestHash(next);
    const change = changeBetween(this.#tokens, next);
    const changed = this.#digest === undefined ? next.length > 0 : hash !== this.#digest;

    this.#digest = hash;
    this.#tokens = next;

    if (!changed) {
      this.#quiet += 1;
      this.#scheduleNext();
      return;
    }

    this.#quiet = 0;
    this.#nudges += 1;
    this.#deliver(
      buildNudge({
        project: this.#project,
        script: this.#script,
        added: change.added,
        removed: change.removed,
        checksRun: this.#checks,
        at: (this.#lastCheck ?? this.#scheduler.now()).toISOString(),
      }),
    );

    this.#scheduleNext();
  }

  /** A check that throws is a failed tick, never a crash and never a nudge. */
  async #runSafely(): Promise<TickRun> {
    try {
      return await this.#runCommand({ script: this.#script, cwd: this.#project });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#warn(`idle-watch: the check could not run: ${message}`);
      return { code: 1, stdout: "", stderr: message, killed: false };
    }
  }
}
