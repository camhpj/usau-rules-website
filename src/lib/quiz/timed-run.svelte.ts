import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { LEADERBOARD_SIZE, LeaderboardResponseSchema } from '$lib/leaderboard/payload';
import { DisplayNameStateSchema } from '$lib/profile/payload';
import { loadAllQuestions } from './bank-lazy';
import { buildQuizItems, mulberry32, shuffle, type AnswerRecord, type QuizItem } from './engine';
import { TIMED_DURATION_S as DURATION_S } from './payload';
import { getTimedBest, recordAnswers, recordTimedResult, type TimedBest } from './storage';
import { beginTimedRun, submitTimedRun } from './sync';
import type { Question } from './types';

const BOARD_ERROR_MESSAGE = "Couldn't check the leaderboard — your score is saved.";

/**
 * Timer abstraction so a test can drive the countdown deterministically instead of
 * waiting on real elapsed time. Production uses the real globals (`realClock`,
 * the default); a test injects a fake one that advances on command.
 */
export interface Clock {
	now(): number;
	setInterval(callback: () => void, ms: number): number;
	clearInterval(id: number): void;
}

const realClock: Clock = {
	now: () => Date.now(),
	setInterval: (callback, ms) => setInterval(callback, ms) as unknown as number,
	clearInterval: (id) => clearInterval(id)
};

export interface TimedRunDeps {
	rulesetId?: string;
	clock?: Clock;
	/** Defaults to the real bank loader; a test injects a controllable one to
	 *  observe/delay bank resolution independently of the fetch mock. */
	loadBank?: (rulesetId: string) => Promise<Question[]>;
}

/**
 * Orchestration for `/quiz/timed`: loading the question bank, running the
 * countdown, persisting the result, and the race guards that keep a
 * late-resolving leaderboard lookup from a prior run off the current one's
 * results screen.
 *
 * Per-page-mount: construct one instance per component mount, the way the
 * page does (`new TimedRunState()` in its `<script>`). A singleton would
 * carry one run's generation counter into the next — see `createSessionGate`
 * in `$lib/auth-gate.svelte` and `AskPageState` in `$lib/ask/ask-page.svelte`
 * for the same reasoning applied elsewhere.
 *
 * Must not import `$app/state` or `$app/navigation`, so it stays testable
 * under `environment: 'node'`. This page needs neither: unlike `/ask`, it has
 * no route param and no in-place URL rewrite.
 *
 * Does not call `onMount` internally. `$effect`/`onMount` require an active
 * component context; constructing this class directly (as every test here
 * does) has none, and would throw `effect_orphan`/`lifecycle_outside_component`
 * the moment a test called `new TimedRunState()`. Instead `mount()` and
 * `destroy()` are plain methods the page's own `onMount` delegates to —
 * the same resolution `AskPageState` uses for its two `$effect` blocks.
 */
export class TimedRunState {
	loadingBank = $state(false);
	/** Bank-load failure. A different concern from `boardError` below — rendered
	 *  under a different ARIA role (`alert` vs. `status`) — so keep them separate. */
	errorMessage = $state<string | null>(null);

	phase = $state<'intro' | 'running' | 'done'>('intro');
	items = $state<QuizItem[]>([]);
	records = $state<AnswerRecord[]>([]);
	timeLeft = $state(DURATION_S);
	streak = $state(0);
	bestStreak = $state(0);
	best = $state<TimedBest | null>(null);
	isNewBest = $state(false);

	nudge = $state<{ rank: number; suggestion: string } | null>(null);
	nudgeDismissed = $state(false);
	claimedName = $state<string | null>(null);
	myRank = $state<number | null>(null);
	/** Leaderboard-lookup failure. A different concern from `errorMessage` above —
	 *  see the comment there. */
	boardError = $state<string | null>(null);

	readonly #rulesetId: string;
	readonly #clock: Clock;
	readonly #loadBank: (rulesetId: string) => Promise<Question[]>;

	#ticker: number | undefined;
	#runToken: Promise<string | null> = Promise.resolve(null);

	// Bumped on every start() so a late-resolving resolveBoardStatus() chain from a
	// prior run (e.g. "End run" → "Run it back" → "End run" in quick
	// succession) can detect it's stale and no-op instead of clobbering the
	// current run's results state.
	#runGeneration = 0;

	constructor(deps: TimedRunDeps = {}) {
		this.#rulesetId = deps.rulesetId ?? DEFAULT_RULESET_ID;
		this.#clock = deps.clock ?? realClock;
		this.#loadBank = deps.loadBank ?? loadAllQuestions;
	}

	/** Call from the page's `onMount`. Loads the stored personal best; deferred to
	 *  mount (rather than the constructor) because it's the same client-only-storage
	 *  boundary `getTimedBest` already respects. */
	mount(): void {
		this.best = getTimedBest(this.#rulesetId);
	}

	/** Call from the page's `onMount` cleanup. */
	destroy(): void {
		this.#stopTicker();
		// Invalidates any start() awaiting the bank load, or resolveBoardStatus()
		// awaiting the leaderboard, when the component is destroyed mid-fetch, so its
		// post-await guard sees a stale generation and never mutates a torn-down
		// component's state.
		this.#runGeneration += 1;
	}

	#stopTicker(): void {
		if (this.#ticker !== undefined) this.#clock.clearInterval(this.#ticker);
		this.#ticker = undefined;
	}

	async start(): Promise<void> {
		this.#runGeneration += 1;
		const gen = this.#runGeneration;
		this.nudge = null;
		this.nudgeDismissed = false;
		this.claimedName = null;
		this.myRank = null;
		this.boardError = null;
		this.errorMessage = null;
		// The clock waits on the bank fetch, or the user loses run time to the network.
		this.loadingBank = true;
		let bank: Question[];
		try {
			bank = await this.#loadBank(this.#rulesetId);
		} catch {
			if (gen === this.#runGeneration) this.errorMessage = "Couldn't load questions — try again.";
			return;
		} finally {
			if (gen === this.#runGeneration) this.loadingBank = false;
		}
		if (gen !== this.#runGeneration) return; // a newer start() fired while this one awaited
		// Minted only now, once the bank is in hand: the server measures its finish
		// window from this request, so starting it here keeps that window aligned
		// with the clock below instead of also spending it on the download above.
		this.#runToken = beginTimedRun(this.#rulesetId);
		const rng = mulberry32(this.#clock.now());
		this.items = buildQuizItems(shuffle(bank, rng), rng);
		this.records = [];
		this.streak = 0;
		this.bestStreak = 0;
		this.timeLeft = DURATION_S;
		this.phase = 'running';
		const startedAt = this.#clock.now();
		this.#stopTicker();
		this.#ticker = this.#clock.setInterval(() => {
			const elapsedMs = this.#clock.now() - startedAt;
			this.timeLeft = Math.max(0, Math.ceil(DURATION_S - elapsedMs / 1000));
			if (elapsedMs >= DURATION_S * 1000) this.finish();
		}, 250);
	}

	onAnswer(record: AnswerRecord): void {
		this.records = [...this.records, record];
		this.streak = record.correct ? this.streak + 1 : 0;
		this.bestStreak = Math.max(this.bestStreak, this.streak);
	}

	finish(): void {
		this.#stopTicker();
		if (this.phase !== 'running') return;
		recordAnswers(this.#rulesetId, this.records);
		// A zero-answer run records nothing — otherwise a first-ever idle run
		// would persist a phantom 0/0 personal best onto the intro screen.
		if (this.records.length > 0) {
			const score = this.records.filter((r) => r.correct).length;
			const result = recordTimedResult(this.#rulesetId, { score, bestStreak: this.bestStreak });
			this.isNewBest = result.isNewBest;
			this.best = result.best;
			const finishedItems = this.items;
			const finishedRecords = this.records;
			const gen = this.#runGeneration;
			void (async () => {
				const token = await this.#runToken;
				if (token && gen === this.#runGeneration) {
					void submitTimedRun({
						token,
						rulesetId: this.#rulesetId,
						items: finishedItems,
						records: finishedRecords
					}).then((accepted) => {
						if (accepted && gen === this.#runGeneration)
							void this.resolveBoardStatus(accepted.score, accepted.bestStreak, gen);
					});
				}
			})();
		} else {
			this.isNewBest = false;
		}
		this.phase = 'done';
	}

	/** Server-accepted run → the player's board status for the results screen:
	 *  has a name → their current rank; no name + would place → the claim nudge.
	 *
	 *  Not private: `finish()` is its only production caller, but a test drives it
	 *  directly to exercise each generation guard below without re-plumbing the
	 *  whole start→answer→finish→submit chain for every case. */
	async resolveBoardStatus(score: number, streak: number, gen: number): Promise<void> {
		try {
			const profileRes = await fetch('/api/profile/display-name');
			if (gen !== this.#runGeneration) return; // a newer run started while we awaited
			if (!profileRes.ok) return; // signed out (401) → plain leaderboard link only
			const profile = DisplayNameStateSchema.safeParse(await profileRes.json().catch(() => null));
			if (gen !== this.#runGeneration || !profile.success) return;
			const boardRes = await fetch('/api/leaderboard');
			if (gen !== this.#runGeneration) return;
			const board = LeaderboardResponseSchema.safeParse(await boardRes.json().catch(() => null));
			if (gen !== this.#runGeneration) return;
			if (!boardRes.ok || !board.success) {
				if (gen === this.#runGeneration) this.boardError = BOARD_ERROR_MESSAGE;
				return;
			}
			this.boardError = null;
			if (profile.data.displayName !== null) {
				this.myRank = board.data.me?.rank ?? null;
				return;
			}
			const beats = board.data.entries.filter(
				(e) => e.score > score || (e.score === score && e.bestStreak >= streak)
			).length;
			const rank = beats + 1;
			if (gen !== this.#runGeneration) return; // final guard right before mutating state
			if (rank <= LEADERBOARD_SIZE) this.nudge = { rank, suggestion: profile.data.suggestion };
		} catch {
			// A network-level failure (abort, DNS, CORS, etc). Same user-facing
			// message as a bad response above — the user can't tell them apart
			// and shouldn't have to.
			if (gen === this.#runGeneration) this.boardError = BOARD_ERROR_MESSAGE;
		}
	}
}
