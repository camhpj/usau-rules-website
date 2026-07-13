<script lang="ts">
	import { onMount } from 'svelte';
	import QuestionPlayer from '$lib/components/quiz/QuestionPlayer.svelte';
	import QuizSummary from '$lib/components/quiz/QuizSummary.svelte';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
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

	onMount(() => {
		best = getTimedBest(DEFAULT_RULESET_ID);
		return () => clearInterval(ticker);
	});

	function start() {
		runToken = beginTimedRun();
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
			void (async () => {
				const token = await runToken;
				if (token) {
					await submitTimedRun({
						token,
						rulesetId: DEFAULT_RULESET_ID,
						items: finishedItems,
						records: finishedRecords
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
