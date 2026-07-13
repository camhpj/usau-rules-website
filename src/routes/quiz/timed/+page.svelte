<script lang="ts">
	import { onMount } from 'svelte';
	import DisplayNameClaim from '$lib/components/DisplayNameClaim.svelte';
	import QuestionPlayer from '$lib/components/quiz/QuestionPlayer.svelte';
	import QuizSummary from '$lib/components/quiz/QuizSummary.svelte';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { LEADERBOARD_SIZE, LeaderboardResponseSchema } from '$lib/leaderboard/payload';
	import { DisplayNameStateSchema } from '$lib/profile/payload';
	import { listQuestions } from '$lib/quiz/bank';
	import {
		buildQuizItems,
		mulberry32,
		shuffle,
		type AnswerRecord,
		type QuizItem
	} from '$lib/quiz/engine';
	import { TIMED_DURATION_S as DURATION_S } from '$lib/quiz/payload';
	import {
		getTimedBest,
		recordAnswers,
		recordTimedResult,
		type TimedBest
	} from '$lib/quiz/storage';
	import { beginTimedRun, submitTimedRun } from '$lib/quiz/sync';

	const bank = listQuestions(DEFAULT_RULESET_ID);

	let phase = $state<'intro' | 'running' | 'done'>('intro');
	let items = $state<QuizItem[]>([]);
	let records = $state<AnswerRecord[]>([]);
	let timeLeft = $state(DURATION_S);
	let streak = $state(0);
	let bestStreak = $state(0);
	let best = $state<TimedBest | null>(null);
	let isNewBest = $state(false);
	let ticker: ReturnType<typeof setInterval> | undefined;
	let runToken: Promise<string | null> = Promise.resolve(null);

	let nudge = $state<{ rank: number; suggestion: string } | null>(null);
	let nudgeDismissed = $state(false);
	let claimedName = $state<string | null>(null);
	let myRank = $state<number | null>(null);

	// Bumped on every start() so a late-resolving maybeNudge() chain from a
	// prior run (e.g. "End run" → "Run it back" → "End run" in quick
	// succession) can detect it's stale and no-op instead of clobbering the
	// current run's results state.
	let runGeneration = 0;

	onMount(() => {
		best = getTimedBest(DEFAULT_RULESET_ID);
		return () => clearInterval(ticker);
	});

	/** Server-accepted run → the player's board status for the results screen:
	 *  has a name → their current rank; no name + would place → the claim nudge. */
	async function resolveBoardStatus(score: number, streak: number, gen: number) {
		try {
			const profileRes = await fetch('/api/profile/display-name');
			if (gen !== runGeneration) return; // a newer run started while we awaited
			if (!profileRes.ok) return; // signed out (401) → plain leaderboard link only
			const profile = DisplayNameStateSchema.safeParse(await profileRes.json().catch(() => null));
			if (gen !== runGeneration || !profile.success) return;
			const boardRes = await fetch('/api/leaderboard');
			if (gen !== runGeneration) return;
			const board = LeaderboardResponseSchema.safeParse(await boardRes.json().catch(() => null));
			if (gen !== runGeneration) return;
			if (!boardRes.ok || !board.success) return;
			if (profile.data.displayName !== null) {
				myRank = board.data.me?.rank ?? null;
				return;
			}
			const beats = board.data.entries.filter(
				(e) => e.score > score || (e.score === score && e.bestStreak >= streak)
			).length;
			const rank = beats + 1;
			if (gen !== runGeneration) return; // final guard right before mutating state
			if (rank <= LEADERBOARD_SIZE) nudge = { rank, suggestion: profile.data.suggestion };
		} catch {
			// network problems never touch the results screen
		}
	}

	function start() {
		runGeneration += 1;
		nudge = null;
		nudgeDismissed = false;
		claimedName = null;
		myRank = null;
		runToken = beginTimedRun(DEFAULT_RULESET_ID);
		const rng = mulberry32(Date.now());
		items = buildQuizItems(shuffle(bank, rng), rng);
		records = [];
		streak = 0;
		bestStreak = 0;
		timeLeft = DURATION_S;
		phase = 'running';
		const startedAt = Date.now();
		ticker = setInterval(() => {
			const elapsedMs = Date.now() - startedAt;
			timeLeft = Math.max(0, Math.ceil(DURATION_S - elapsedMs / 1000));
			if (elapsedMs >= DURATION_S * 1000) finish();
		}, 250);
	}

	function onAnswer(record: AnswerRecord) {
		records = [...records, record];
		streak = record.correct ? streak + 1 : 0;
		bestStreak = Math.max(bestStreak, streak);
	}

	function finish() {
		clearInterval(ticker);
		if (phase !== 'running') return;
		recordAnswers(DEFAULT_RULESET_ID, records);
		// A zero-answer run records nothing — otherwise a first-ever idle run
		// would persist a phantom 0/0 personal best onto the intro screen.
		if (records.length > 0) {
			const score = records.filter((r) => r.correct).length;
			const result = recordTimedResult(DEFAULT_RULESET_ID, { score, bestStreak });
			isNewBest = result.isNewBest;
			best = result.best;
			const finishedItems = items;
			const finishedRecords = records;
			const gen = runGeneration;
			void (async () => {
				const token = await runToken;
				if (token && gen === runGeneration) {
					void submitTimedRun({
						token,
						rulesetId: DEFAULT_RULESET_ID,
						items: finishedItems,
						records: finishedRecords
					}).then((accepted) => {
						if (accepted && gen === runGeneration)
							void resolveBoardStatus(accepted.score, accepted.bestStreak, gen);
					});
				}
			})();
		} else {
			isNewBest = false;
		}
		phase = 'done';
	}
</script>

<svelte:head><title>Timed challenge · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<p class="text-xs font-semibold tracking-[0.18em] text-cardinal uppercase">Timed challenge</p>

	{#if phase === 'intro'}
		<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Five minutes.</h1>
		<p class="mt-3 max-w-xl text-white/70">
			Answer as many as you can before the clock runs out. Correct answers build your streak; one
			miss resets it. Explanations wait for you in the results.
		</p>
		{#if best}
			<p class="mt-4 text-sm font-semibold tracking-wider text-white/60 uppercase">
				Personal best: {best.score} correct · streak {best.bestStreak}
			</p>
		{/if}
		<p class="mt-3 text-sm">
			<a
				href="/leaderboard"
				class="text-white/70 underline decoration-white/30 underline-offset-2 hover:text-white"
			>
				See the leaderboard →
			</a>
		</p>
		<button
			type="button"
			onclick={start}
			class="mt-8 rounded-full bg-cardinal px-8 py-3 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
		>
			Start
		</button>
	{:else if phase === 'running'}
		<div
			class="relative mt-6 flex flex-wrap items-center justify-between gap-y-1 rounded-xl bg-navy px-5 py-3"
		>
			<p class="font-mono text-3xl font-bold {timeLeft <= 10 ? 'text-cardinal' : 'text-white'}">
				{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
			</p>
			<p
				class="basis-full text-xs font-semibold tracking-wider whitespace-nowrap text-white/70 uppercase sm:basis-auto sm:text-sm"
			>
				Streak {streak} · Score {records.filter((r) => r.correct).length}
			</p>
			<button
				type="button"
				onclick={finish}
				class="absolute top-1/2 right-5 -translate-y-1/2 rounded-full border border-white/30 px-4 py-1.5 text-xs font-semibold tracking-wider whitespace-nowrap text-white/80 uppercase hover:border-white sm:static sm:translate-y-0"
			>
				End run
			</button>
		</div>
		<div class="mt-4">
			<QuestionPlayer
				{items}
				rulesetId={DEFAULT_RULESET_ID}
				mode="rapid"
				{onAnswer}
				onComplete={finish}
			/>
		</div>
	{:else}
		<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Time!</h1>
		<div class="mt-8">
			<QuizSummary {items} {records} rulesetId={DEFAULT_RULESET_ID} heading="Timed challenge">
				<p class="mt-3 text-sm font-semibold text-navy/70">
					Best streak this run: {bestStreak}
					{#if isNewBest}
						<span
							class="ml-2 rounded bg-turf px-2 py-0.5 text-xs font-bold tracking-wider text-white uppercase"
						>
							New personal best
						</span>
					{/if}
				</p>
				{#if claimedName}
					<p class="mt-2 text-sm text-navy/70">
						On the board as <b class="text-navy">{claimedName}</b> —
						<a
							href="/leaderboard"
							class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
							>see the leaderboard →</a
						>
					</p>
				{:else if nudge && !nudgeDismissed}
					<p class="mt-2 text-sm text-navy/70">
						#{nudge.rank} on the
						<a
							href="/leaderboard"
							class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
							>leaderboard</a
						>
						if you claim it —
						<DisplayNameClaim suggestion={nudge.suggestion} onSaved={(n) => (claimedName = n)} />
						<button
							type="button"
							aria-label="Dismiss"
							onclick={() => (nudgeDismissed = true)}
							class="ml-1 text-navy/40 hover:text-navy/70">✕</button
						>
					</p>
				{:else if myRank !== null}
					<p class="mt-2 text-sm text-navy/70">
						On the board at <b class="text-navy">#{myRank}</b> —
						<a
							href="/leaderboard"
							class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
							>see the leaderboard →</a
						>
					</p>
				{:else}
					<p class="mt-2 text-sm text-navy/70">
						<a
							href="/leaderboard"
							class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
							>See the leaderboard →</a
						>
					</p>
				{/if}
				<div class="mt-4 flex gap-3">
					<button
						type="button"
						onclick={start}
						class="rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
					>
						Run it back
					</button>
					<a
						href="/quiz"
						class="rounded-full border border-navy/30 px-6 py-2.5 text-sm font-semibold tracking-wider text-navy uppercase hover:border-navy"
					>
						All modes
					</a>
				</div>
			</QuizSummary>
		</div>
	{/if}
</section>
