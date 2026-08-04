import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetLocal } from './local';
import { TIMED_DURATION_S } from './payload';
import { type Clock, TimedRunState } from './timed-run.svelte';
import type { Question } from './types';

/** A promise plus its resolver/rejecter, so a test can control exactly when a
 *  fetch or bank load settles. Same shape as `$lib/ask/ask-page.test.ts`'s. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Flushes both microtasks and the odd macrotask-scheduled continuation
 *  (e.g. Response#json), unlike a fixed number of `await Promise.resolve()`s. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const q = (id: string): Question => ({
	id,
	rulesetId: 'r',
	type: 'multiple-choice',
	prompt: `Prompt for ${id}?`,
	choices: ['a', 'b', 'c', 'd'],
	answerIndex: 0,
	explanation: 'Because the rules say so.',
	ruleRefs: ['15.D'],
	sectionSlug: '15',
	difficulty: 1
});

/** A clock that never fires its interval — for tests that call start() but
 *  don't care about the countdown, so no real timer ever gets registered. */
function inertClock(): Clock {
	return { now: () => 0, setInterval: () => 0, clearInterval: () => {} };
}

/** A clock a test can advance by hand, invoking whatever the code registered
 *  via setInterval synchronously — no real timer, no waiting on real elapsed time. */
function fakeClock(startAt = 0) {
	let now = startAt;
	let cb: (() => void) | null = null;
	const clock: Clock = {
		now: () => now,
		setInterval: (callback) => {
			cb = callback;
			return 1;
		},
		clearInterval: () => {
			cb = null;
		}
	};
	return {
		clock,
		advance(ms: number) {
			now += ms;
			cb?.();
		},
		get scheduled() {
			return cb !== null;
		}
	};
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	__resetLocal();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('TimedRunState.start: mint-after-bank ordering', () => {
	// Preserves the fix named in the task brief: minting before the bank resolves
	// spends the server's finish-window grace period on the download instead of on
	// the run, silently voiding completed runs. Not reachable as a unit test before
	// this extraction — the bank load and the mint lived in the same unexported
	// function closure inside the .svelte file.
	it('does not request a token until the bank resolves, and starts the clock without waiting on the mint', async () => {
		const bankGate = deferred<Question[]>();
		const run = new TimedRunState({ clock: inertClock(), loadBank: () => bankGate.promise });

		const pending = run.start();
		await Promise.resolve(); // let start() reach its first await (the bank load)
		expect(fetchMock).not.toHaveBeenCalled(); // no mint, and no other network call, before the bank resolves
		expect(run.phase).toBe('intro');

		const mint = deferred<Response>();
		fetchMock.mockReturnValueOnce(mint.promise);
		bankGate.resolve([q('15-01'), q('15-02')]);
		await pending;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/timed/start',
			expect.objectContaining({ method: 'POST' })
		);
		// The clock is already running even though the mint's own round trip is still pending.
		expect(run.phase).toBe('running');
		expect(run.timeLeft).toBe(TIMED_DURATION_S);

		mint.resolve(jsonResponse({ token: 'tok' }));
		await tick();
	});
});

describe('TimedRunState.start: stale-generation guards around the bank load', () => {
	// The guard at "if (gen !== runGeneration) return" right after the bank load
	// resolves. Impossible to unit test before this extraction: driving two
	// overlapping start() calls with independently controllable bank promises
	// required a full mounted-component harness this repo doesn't use.
	it("a stale run's bank resolving after a newer run started must not mint a token or overwrite the new run's items", async () => {
		const staleBank = deferred<Question[]>();
		const freshBank = deferred<Question[]>();
		const bankQueue = [staleBank, freshBank];
		const run = new TimedRunState({
			clock: inertClock(),
			loadBank: () => bankQueue.shift()!.promise
		});

		const first = run.start(); // gen 1, awaiting staleBank
		const mintFresh = deferred<Response>();
		fetchMock.mockReturnValueOnce(mintFresh.promise);
		const second = run.start(); // gen 2, supersedes the first before it resolves

		freshBank.resolve([q('15-fresh')]);
		await second;
		expect(run.items.map((i) => i.question.id)).toEqual(['15-fresh']);
		expect(fetchMock).toHaveBeenCalledTimes(1); // only the fresh run minted

		staleBank.resolve([q('15-stale')]); // the superseded run's bank finally arrives
		await first;

		expect(run.items.map((i) => i.question.id)).toEqual(['15-fresh']); // not clobbered
		expect(fetchMock).toHaveBeenCalledTimes(1); // the stale run never minted a second token
		expect(run.phase).toBe('running');
	});

	// The guard inside the bank load's catch block. Same "impossible before" note
	// as above, applied to the rejection path instead of the success path.
	it("a stale run's bank-load rejection must not set errorMessage on the run that superseded it", async () => {
		const staleBank = deferred<Question[]>();
		const freshBank = deferred<Question[]>();
		const bankQueue = [staleBank, freshBank];
		const run = new TimedRunState({
			clock: inertClock(),
			loadBank: () => bankQueue.shift()!.promise
		});

		run.start(); // gen 1
		const mintFresh = deferred<Response>();
		fetchMock.mockReturnValueOnce(mintFresh.promise);
		const second = run.start(); // gen 2
		freshBank.resolve([q('15-fresh')]);
		await second;
		expect(run.errorMessage).toBeNull();

		staleBank.reject(new Error('offline'));
		await tick();

		expect(run.errorMessage).toBeNull(); // the stale rejection did not land on the current run
		expect(run.phase).toBe('running'); // unaffected
	});
});

describe('TimedRunState: errorMessage and boardError are separate concerns', () => {
	it('a bank-load failure sets errorMessage, never boardError', async () => {
		const run = new TimedRunState({
			clock: inertClock(),
			loadBank: () => Promise.reject(new Error('offline'))
		});
		await run.start();
		expect(run.errorMessage).toBe("Couldn't load questions — try again.");
		expect(run.boardError).toBeNull();
	});

	it('a leaderboard-lookup failure sets boardError, never errorMessage', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ displayName: null, suggestion: 'Zone' }));
		fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
		const run = new TimedRunState();
		await run.resolveBoardStatus(3, 2, 0); // a fresh instance's generation starts at 0
		expect(run.boardError).toBe("Couldn't check the leaderboard — your score is saved.");
		expect(run.errorMessage).toBeNull();
	});
});

describe('TimedRunState: the leaderboard-lookup generation guard', () => {
	// The scenario named directly in the task brief, driven through the real
	// start()/finish() flow end to end: a full run finishes, its background
	// leaderboard lookup is still in flight, and the user starts another run
	// before it resolves. The stale lookup must never even reach the leaderboard
	// fetch, let alone write to the new run's nudge/myRank/boardError.
	it('a leaderboard response arriving after the user started a new run must not write to the new run state', async () => {
		const run = new TimedRunState({
			clock: inertClock(),
			loadBank: () => Promise.resolve([q('15-01')])
		});

		const mint1 = deferred<Response>();
		fetchMock.mockReturnValueOnce(mint1.promise);
		await run.start(); // gen 1
		run.onAnswer({ questionId: '15-01', sectionSlug: '15', chosenChoice: 0, correct: true });

		const finish1 = deferred<Response>();
		fetchMock.mockReturnValueOnce(finish1.promise);
		mint1.resolve(jsonResponse({ token: 'tok-1' }));
		run.finish();
		await tick(); // runToken resolves -> submitTimedRun's fetch fires

		const profile1 = deferred<Response>();
		fetchMock.mockReturnValueOnce(profile1.promise);
		finish1.resolve(jsonResponse({ score: 1, bestStreak: 1 }, 201));
		await tick(); // submitTimedRun resolves -> resolveBoardStatus's first fetch fires

		// The user clicks "Run it back" before the first run's board lookup settles.
		fetchMock.mockReturnValueOnce(new Promise(() => {})); // run 2's own mint; left pending
		await run.start(); // gen 2
		expect(run.nudge).toBeNull();
		expect(run.boardError).toBeNull();
		expect(run.myRank).toBeNull();

		// The stale run's profile lookup finally resolves.
		profile1.resolve(jsonResponse({ displayName: null, suggestion: 'Zone' }));
		await tick();

		expect(fetchMock).toHaveBeenCalledTimes(4); // mint1, finish1, profile1, mint2 — never the leaderboard
		expect(run.nudge).toBeNull();
		expect(run.boardError).toBeNull();
		expect(run.myRank).toBeNull();
	});

	// Same guard, isolated to resolveBoardStatus directly and triggered at the
	// checkpoint right after the profile lookup: proves the leaderboard fetch is
	// never even issued once superseded, not merely that its result gets discarded.
	it('a stale lookup superseded right after the profile fetch never requests the leaderboard', async () => {
		const run = new TimedRunState();
		const profileGate = deferred<Response>();
		fetchMock.mockReturnValueOnce(profileGate.promise);

		const pending = run.resolveBoardStatus(5, 4, 0);
		run.destroy(); // stands in for "a newer run started" — same generation counter, same guard

		profileGate.resolve(jsonResponse({ displayName: null, suggestion: 'Zone' }));
		await pending;

		expect(fetchMock).toHaveBeenCalledTimes(1); // the leaderboard was never requested
		expect(run.nudge).toBeNull();
		expect(run.myRank).toBeNull();
		expect(run.boardError).toBeNull();
	});

	// The guard right after the leaderboard fetch itself resolves — the literal
	// "leaderboard response arriving late" case, at the narrowest possible scope.
	it('a stale lookup superseded while the leaderboard fetch is in flight must not write nudge/myRank/boardError', async () => {
		const run = new TimedRunState();
		fetchMock.mockResolvedValueOnce(jsonResponse({ displayName: null, suggestion: 'Zone' }));
		const boardGate = deferred<Response>();
		fetchMock.mockReturnValueOnce(boardGate.promise);

		const pending = run.resolveBoardStatus(1, 1, 0);
		await tick(); // let the profile fetch/parse settle so the leaderboard fetch is issued
		run.destroy();

		boardGate.resolve(jsonResponse({ entries: [], me: null }));
		await pending;

		expect(run.nudge).toBeNull();
		expect(run.myRank).toBeNull();
		expect(run.boardError).toBeNull();
	});

	// The catch-block guard: a network-level failure (not a bad response) must
	// also respect the generation check before surfacing boardError.
	it('a stale lookup swallows a network failure without setting boardError once superseded', async () => {
		const run = new TimedRunState();
		const profileGate = deferred<Response>();
		fetchMock.mockReturnValueOnce(profileGate.promise);

		const pending = run.resolveBoardStatus(1, 1, 0);
		run.destroy();
		profileGate.reject(new Error('network down'));
		await pending;

		expect(run.boardError).toBeNull();
	});

	// Control: proves the guard is a real comparison, not a check that always
	// short-circuits — an unsuperseded lookup still produces a nudge.
	it('a lookup whose generation still matches sets the nudge normally', async () => {
		const run = new TimedRunState();
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ displayName: null, suggestion: 'Zone Defense' })
		);
		fetchMock.mockResolvedValueOnce(jsonResponse({ entries: [], me: null }));

		await run.resolveBoardStatus(10, 5, 0);

		expect(run.nudge).toEqual({ rank: 1, suggestion: 'Zone Defense' });
		expect(run.boardError).toBeNull();
	});
});

describe('TimedRunState: the injectable clock', () => {
	it('advances timeLeft and auto-finishes once the full duration elapses', async () => {
		fetchMock.mockReturnValue(new Promise(() => {})); // mint's fetch; unused by this test
		const fc = fakeClock(1_000_000);
		const run = new TimedRunState({
			clock: fc.clock,
			loadBank: () => Promise.resolve([q('15-01')])
		});

		await run.start();
		expect(run.phase).toBe('running');
		expect(run.timeLeft).toBe(TIMED_DURATION_S);

		fc.advance(60_000);
		expect(run.timeLeft).toBe(TIMED_DURATION_S - 60);
		expect(run.phase).toBe('running');

		fc.advance((TIMED_DURATION_S - 60) * 1000);
		expect(run.timeLeft).toBe(0);
		expect(run.phase).toBe('done'); // finish() fired from inside the tick, not from a real timer
	});
});

describe('TimedRunState.destroy', () => {
	it('stops the ticker so a late clock tick does not mutate timeLeft or re-finish', async () => {
		fetchMock.mockReturnValue(new Promise(() => {}));
		const fc = fakeClock(0);
		const run = new TimedRunState({
			clock: fc.clock,
			loadBank: () => Promise.resolve([q('15-01')])
		});
		await run.start();
		expect(fc.scheduled).toBe(true);

		run.destroy();
		const timeLeftAtDestroy = run.timeLeft;
		fc.advance(10_000); // the interval, if still registered, would fire here

		expect(run.timeLeft).toBe(timeLeftAtDestroy);
		expect(run.phase).toBe('running'); // finish() was never re-triggered by a stray tick
	});

	// Mirrors the original onMount cleanup comment: destroying mid-fetch must
	// invalidate the in-flight start() so it never starts a ticker on a
	// torn-down component.
	it('a component destroyed while start() awaits the bank must not transition to running once the bank resolves', async () => {
		const bankGate = deferred<Question[]>();
		const run = new TimedRunState({ clock: inertClock(), loadBank: () => bankGate.promise });

		const pending = run.start();
		run.destroy();

		bankGate.resolve([q('15-01')]);
		await pending;

		expect(run.phase).toBe('intro'); // never advanced
		expect(fetchMock).not.toHaveBeenCalled(); // no token minted for a run nobody is watching
	});
});
