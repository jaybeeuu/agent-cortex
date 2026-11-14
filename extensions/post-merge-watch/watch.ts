/**
 * The watch: poll the post-merge check script until it reports a verdict, then
 * forward that verdict to the session.
 *
 * The check script (`skills/workflow/ralph/scripts/post-merge-check.mjs`) owns
 * the verdict: it exits `0` passed, `1` failed, `2` inconclusive. This module
 * owns only three things — when to call the script again, when to stop, and what
 * to say when it stops. It reads the run URL out of the script's JSON report; it
 * never decides whether a run passed.
 *
 * Every collaborator is injected, so a test drives the whole lifecycle with a
 * scheduler it steps by hand, a check that returns scripted exit codes, and a
 * temp state directory. Nothing here imports pi, so the module is exercised
 * without a session.
 */

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

/** Provenance of the wake message; also the custom-message type. */
export const WAKE_CUSTOM_TYPE = "post-merge-watch";

/** Milliseconds between two checks while waiting for the run to settle. */
export const DEFAULT_INTERVAL_MS = 15_000;

/** Checks before the watch gives up and reports inconclusive: 40 × 15s ≈ 10 min. */
export const DEFAULT_MAX_ATTEMPTS = 40;

/**
 * Arguments every invocation passes to the check. `--wait 0` makes one
 * script-level check return instead of waiting inside the script: the poll
 * interval belongs to this module, so a stopped watch never blocks on a child.
 */
export const CHECK_ARGS = ["--wait", "0"] as const;

/** What the check script reports, by exit code. */
export type Verdict = "passed" | "failed" | "inconclusive";

/** The state file layout. Versioned so a later change can migrate instead of guess. */
export const STATE_VERSION = 1;

/** One run of the check script. */
export interface CheckRun {
  /** Exit code: 0 passed, 1 failed, 2 inconclusive. */
  code: number;
  stdout: string;
  stderr: string;
  /** The run was terminated by a timeout, so its report may be incomplete. */
  killed: boolean;
}

/** One call of the check script. */
export interface CheckInvocation {
  script: string;
  cwd: string;
  args: readonly string[];
}

export type CheckRunner = (invocation: CheckInvocation) => Promise<CheckRun>;

/** The timer this module needs, injectable so a test owns the clock. */
export interface Scheduler {
  now(): Date;
  /**
   * Run `callback` once after `delayMs`, and return a function that cancels it.
   * The callback may return a promise: the real scheduler ignores it, and a test
   * scheduler awaits it to step one poll deterministically.
   */
  schedule(callback: () => void | Promise<void>, delayMs: number): () => void;
}

/** The verdict as the script reported it, plus what the report says about it. */
export interface VerdictReport {
  verdict: Verdict;
  exitCode: number;
  /** The script's `reason` field, or why the report could not be read. */
  reason: string;
  runUrl: string | undefined;
}

/** The data the follow-up message carries beyond its text. */
export interface WakeDetails {
  bead: string;
  verdict: Verdict;
  runUrl: string | null;
  exitCode: number;
  reason: string;
  attempts: number;
  project: string;
}

/** The message `pi.sendMessage` receives. */
export interface WakeMessage {
  customType: string;
  content: string;
  display: boolean;
  details: WakeDetails;
}

/** One watch, as it is recorded on disk. */
export interface WatchState {
  version: typeof STATE_VERSION;
  bead: string;
  project: string;
  script: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  attempts: number;
  maxAttempts: number;
  lastExitCode: number | null;
  lastReason: string | null;
}

/** Everything a watch needs, and the collaborators a test replaces. */
export interface PostMergeWatchOptions {
  /** The bead the wake names. */
  bead: string;
  /** The project the watch belongs to; also the directory the check runs in. */
  project: string;
  /** Absolute path of the post-merge check script. */
  script: string;
  /** Directory the state file is written to. */
  stateDir: string;
  runCheck: CheckRunner;
  deliver: (message: WakeMessage) => void;
  scheduler?: Scheduler;
  intervalMs?: number;
  maxAttempts?: number;
  /** Report a problem that must not stop the watch, such as an unreadable report. */
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

/**
 * The verdict is the exit code, and nothing else. Any code other than `0` or `1`
 * — including a timeout kill — is inconclusive, matching the check's contract.
 */
export function verdictOf(exitCode: number): Verdict {
  if (exitCode === 0) return "passed";
  if (exitCode === 1) return "failed";
  return "inconclusive";
}

/** The JSON report the check prints, read as untrusted data. */
interface ParsedReport {
  reason: string | undefined;
  runUrl: string | undefined;
}

function parseReport(stdout: string): ParsedReport {
  const text = stdout.trim();
  if (text === "") return { reason: undefined, runUrl: undefined };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { reason: undefined, runUrl: undefined };
  }

  if (typeof parsed !== "object" || parsed === null) return { reason: undefined, runUrl: undefined };
  const record = parsed as { reason?: unknown; runs?: unknown };

  const reason = typeof record.reason === "string" ? record.reason : undefined;
  const runs = Array.isArray(record.runs) ? record.runs : [];
  const first = runs.find(
    (run): run is { url: string } =>
      typeof run === "object" && run !== null && typeof (run as { url?: unknown }).url === "string",
  );

  return { reason, runUrl: first?.url };
}

/**
 * Read one check run as a verdict. The exit code decides; the JSON report only
 * contributes the run URL and a human-readable reason.
 */
export function readVerdict(run: CheckRun): VerdictReport {
  const report = parseReport(run.stdout);
  const verdict = verdictOf(run.code);

  const reason =
    report.reason ??
    (run.killed ? "check-timed-out" : run.stdout.trim() === "" ? "no-report" : "unreadable-report");

  return { verdict, exitCode: run.code, reason, runUrl: report.runUrl };
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Where one project's watch of one bead is recorded. The name carries the bead
 * and the project directory for a human reading the directory, and a digest of
 * the full project path so two checkouts with the same directory name — or two
 * projects watching the same bead — never share a file.
 */
export function stateFileFor(stateDir: string, project: string, bead: string): string {
  const digest = createHash("sha256").update(`${project}\u0000${bead}`).digest("hex").slice(0, 12);
  const label = [safeName(basename(project)) || "project", safeName(bead) || "bead"].join("-");
  return join(stateDir, `${label}-${digest}.json`);
}

/**
 * Build the wake message: the bead, the verdict, and the run URL, in that order.
 * The text is written for the agent that receives it, so it names the run and
 * says who made the judgement — the extension did not.
 */
export function buildWake(details: WakeDetails): WakeMessage {
  const run = details.runUrl ?? "none reported";
  const content = [
    `The post-merge check settled for ${details.bead}: ${details.verdict}.`,
    "",
    `- Bead: ${details.bead}`,
    `- Verdict: ${details.verdict} (check exit code ${details.exitCode}, reason ${details.reason})`,
    `- Run: ${run}`,
    `- Project: ${details.project}`,
    `- Checks run: ${details.attempts}`,
    "",
    "The check's exit code is the verdict; this message only forwards it. Read the run before deciding the next step.",
  ].join("\n");

  return { customType: WAKE_CUSTOM_TYPE, content, display: true, details };
}

/**
 * One watch of one bead in one project.
 *
 * A watch is active from `start()` until it settles — a verdict, the attempt cap,
 * or `stop()` — and it deletes its state file as it settles, so the state
 * directory holds only watches that are still in flight.
 */
export class PostMergeWatch {
  readonly #bead: string;
  readonly #project: string;
  readonly #script: string;
  readonly #stateDir: string;
  readonly #runCheck: CheckRunner;
  readonly #deliver: (message: WakeMessage) => void;
  readonly #scheduler: Scheduler;
  readonly #intervalMs: number;
  readonly #maxAttempts: number;
  readonly #warn: (message: string) => void;

  #attempts = 0;
  #lastExitCode: number | null = null;
  #lastReason: string | null = null;
  #cancel: (() => void) | undefined;
  #startedAt: Date | undefined;
  #stopped = false;

  constructor(options: PostMergeWatchOptions) {
    this.#bead = options.bead;
    this.#project = options.project;
    this.#script = options.script;
    this.#stateDir = options.stateDir;
    this.#runCheck = options.runCheck;
    this.#deliver = options.deliver;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#warn = options.warn ?? (() => {});
  }

  /** Whether the watch is still polling. */
  get active(): boolean {
    return !this.#stopped;
  }

  /** Checks run so far. */
  get attempts(): number {
    return this.#attempts;
  }

  /** The state file this watch writes while it is active. */
  get stateFile(): string {
    return stateFileFor(this.#stateDir, this.#project, this.#bead);
  }

  /** Record the watch, then run the first check. */
  async start(): Promise<void> {
    if (this.#stopped || this.#startedAt !== undefined) return;
    this.#startedAt = this.#scheduler.now();
    await this.#writeState();
    await this.#check();
  }

  /**
   * End the watch without a wake: cancel the pending timer, ignore a check that
   * is still in flight, and remove the state file. Called when the session shuts
   * down, so an abandoned watch leaves nothing behind.
   */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#cancelTimer();
    await this.#removeState();
  }

  #cancelTimer(): void {
    this.#cancel?.();
    this.#cancel = undefined;
  }

  /** One poll. Never rejects: a throw would leave an unhandled rejection in the host. */
  async #check(): Promise<void> {
    try {
      await this.#poll();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.#warn(`post-merge-watch: the poll failed: ${detail}`);
    }
  }

  async #poll(): Promise<void> {
    if (this.#stopped) return;
    this.#attempts += 1;

    const run = await this.#runCheckSafely();
    // `stop()` may have landed while the check ran: the session is gone, so the
    // verdict has nobody to wake.
    if (this.#stopped) return;

    const verdict = readVerdict(run);
    this.#lastExitCode = verdict.exitCode;
    this.#lastReason = verdict.reason;

    // A verdict, or the last check the watch is allowed: either way, one wake.
    if (verdict.verdict !== "inconclusive" || this.#attempts >= this.#maxAttempts) {
      await this.#settle(verdict);
      return;
    }

    await this.#writeState();
    // `stop()` may have landed while the state was written: the session is gone,
    // so schedule nothing more.
    if (this.#stopped) return;
    this.#cancel = this.#scheduler.schedule(() => {
      this.#cancel = undefined;
      return this.#check();
    }, this.#intervalMs);
  }

  /** A check that throws is inconclusive, never a pass and never a crash. */
  async #runCheckSafely(): Promise<CheckRun> {
    try {
      return await this.#runCheck({ script: this.#script, cwd: this.#project, args: CHECK_ARGS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#warn(`post-merge-watch: the check script could not run: ${message}`);
      return { code: 2, stdout: "", stderr: message, killed: false };
    }
  }

  async #settle(verdict: VerdictReport): Promise<void> {
    this.#stopped = true;
    this.#cancelTimer();
    await this.#removeState();

    const message = buildWake({
      bead: this.#bead,
      verdict: verdict.verdict,
      runUrl: verdict.runUrl ?? null,
      exitCode: verdict.exitCode,
      reason: verdict.reason,
      attempts: this.#attempts,
      project: this.#project,
    });

    try {
      this.#deliver(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.#warn(`post-merge-watch: the verdict could not be delivered: ${detail}`);
    }
  }

  async #writeState(): Promise<void> {
    const now = this.#scheduler.now().toISOString();
    const state: WatchState = {
      version: STATE_VERSION,
      bead: this.#bead,
      project: this.#project,
      script: this.#script,
      pid: process.pid,
      startedAt: (this.#startedAt ?? this.#scheduler.now()).toISOString(),
      updatedAt: now,
      attempts: this.#attempts,
      maxAttempts: this.#maxAttempts,
      lastExitCode: this.#lastExitCode,
      lastReason: this.#lastReason,
    };

    try {
      await mkdir(this.#stateDir, { recursive: true });
      await writeFile(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.#warn(`post-merge-watch: the watch state could not be written: ${detail}`);
      return;
    }

    // `stop()` and `#settle()` remove the state file, and either can land while
    // this write is in flight: the remove then runs first and this write
    // recreates the file. Nothing sweeps the directory, so remove it again — a
    // watch that is no longer active leaves no state file behind.
    if (this.#stopped) await this.#removeState();
  }

  async #removeState(): Promise<void> {
    try {
      await rm(this.stateFile, { force: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.#warn(`post-merge-watch: the watch state could not be removed: ${detail}`);
    }
  }
}
