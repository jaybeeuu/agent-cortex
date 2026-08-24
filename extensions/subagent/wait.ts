/**
 * Blocking wait over background subagent runs.
 *
 * Factored out of the extension entrypoint so the wait semantics can be tested
 * without spawning real `pi` processes: the run store is injected as a lookup
 * function and completion is driven by each entry's `promise` (which resolves
 * exactly when the run's result is committed).
 */

export interface BackgroundEntry<T> {
	/** The run's result once it finishes; null while the agent is still working. */
	result: T | null;
	/** Resolves when the run finishes (success, failure, or abort). */
	promise: Promise<unknown>;
}

export interface CompletedRun<T> {
	agentId: string;
	result: T;
}

export interface WaitResult<T> {
	/** Requested agents whose result is now available, in requested order. */
	completed: CompletedRun<T>[];
	/** Requested agents still working when the wait ended. */
	running: string[];
	/** Requested IDs with no tracked run (never dispatched or expired). */
	notFound: string[];
	/** True when the wait ended because the timeout elapsed with agents still running. */
	timedOut: boolean;
	/** True when the wait ended because the abort signal fired. */
	aborted: boolean;
}

export interface WaitOptions {
	/** Block for at most this many milliseconds before returning (default 120_000). */
	timeoutMs?: number;
	/** Abort the wait early (e.g. user Ctrl+C). */
	signal?: AbortSignal;
}

export const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

type GetEntry<T> = (agentId: string) => BackgroundEntry<T> | undefined;

function scan<T>(getEntry: GetEntry<T>, agentIds: string[], timedOut: boolean, aborted: boolean): WaitResult<T> {
	const completed: CompletedRun<T>[] = [];
	const running: string[] = [];
	const notFound: string[] = [];
	for (const agentId of agentIds) {
		const entry = getEntry(agentId);
		if (!entry) notFound.push(agentId);
		else if (entry.result !== null) completed.push({ agentId, result: entry.result });
		else running.push(agentId);
	}
	return { completed, running, notFound, timedOut, aborted };
}

export async function waitForAgents<T>(
	getEntry: GetEntry<T>,
	agentIds: string[],
	options: WaitOptions = {},
): Promise<WaitResult<T>> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
	const { signal } = options;

	const hasResolution = (result: WaitResult<T>): boolean => result.completed.length > 0 || result.notFound.length > 0;

	// Fast path: any requested agent that already resolved (completed or unknown)
	// ends the wait — the caller dispatches replacements before waiting again.
	const initial = scan(getEntry, agentIds, false, false);
	if (hasResolution(initial)) return initial;

	// Single shared abort racer so a fired signal always wins the next race.
	const abortRacer: Promise<"aborted"> | undefined = signal
		? new Promise((resolve) => {
				if (signal.aborted) resolve("aborted");
				else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
			})
		: undefined;

	const deadline = Date.now() + timeoutMs;
	let timedOut = false;
	let aborted = false;

	while (!timedOut && !aborted) {
		const runningPromises: Promise<unknown>[] = agentIds
			.map(getEntry)
			.filter((entry): entry is BackgroundEntry<T> => entry !== undefined && entry.result === null)
			.map((entry) => entry.promise);

		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			timedOut = true;
			break;
		}

		const racers: Promise<"completed" | "timeout" | "aborted">[] = [];
		if (runningPromises.length > 0) {
			// A settled run promise means its result was committed before settling.
			racers.push(Promise.race(runningPromises.map((p) => p.then(() => "completed" as const, () => "completed" as const))));
		}
		racers.push(new Promise((resolve) => setTimeout(() => resolve("timeout" as const), remaining)));
		if (abortRacer) racers.push(abortRacer);

		const outcome = await Promise.race(racers);
		if (outcome === "timeout") timedOut = true;
		else if (outcome === "aborted") aborted = true;

		// "completed": at least one run promise settled — re-scan. Entries whose
		// result is now available end the wait; everything else loops back under
		// the same deadline.
		const current = scan(getEntry, agentIds, timedOut, aborted);
		if (hasResolution(current) || timedOut || aborted) return current;
	}

	return scan(getEntry, agentIds, timedOut, aborted);
}