<script lang="ts">
	import { onMount } from 'svelte';
	import QuestionPlayer from '$lib/components/quiz/QuestionPlayer.svelte';
	import QuizSummary from '$lib/components/quiz/QuizSummary.svelte';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { getManifest } from '$lib/content/manifests';
	import { listQuestions, questionCountsBySection } from '$lib/quiz/bank';
	import {
		buildQuizItems,
		filterQuestions,
		mulberry32,
		shuffle,
		type AnswerRecord,
		type QuizItem
	} from '$lib/quiz/engine';
	import { buildAttemptPayload, enqueueAttempt } from '$lib/quiz/sync';
	import { recordAnswers } from '$lib/quiz/storage';
	import { DIFFICULTY_LABELS } from '$lib/quiz/types';

	const QUIZ_LENGTH = 10;
	const DIFFICULTIES = [1, 2, 3] as const;

	const manifest = getManifest(DEFAULT_RULESET_ID);
	const bank = listQuestions(DEFAULT_RULESET_ID);
	const counts = questionCountsBySection(DEFAULT_RULESET_ID);
	const sections = manifest.sections.filter((s) => (counts.get(s.slug) ?? 0) > 0);

	let phase = $state<'setup' | 'playing' | 'done'>('setup');
	let selectedSections = $state<string[]>([]);
	let selectedDifficulties = $state<number[]>([]);
	let items = $state<QuizItem[]>([]);
	let records = $state<AnswerRecord[]>([]);
	let startedAt = 0;

	const pool = $derived(
		filterQuestions(bank, { sections: selectedSections, difficulties: selectedDifficulties })
	);

	onMount(() => {
		const preset = new URLSearchParams(location.search)
			.getAll('section')
			.filter((slug) => counts.has(slug));
		if (preset.length > 0) selectedSections = preset;
	});

	function toggleSection(slug: string) {
		selectedSections = selectedSections.includes(slug)
			? selectedSections.filter((s) => s !== slug)
			: [...selectedSections, slug];
	}

	function toggleDifficulty(d: number) {
		selectedDifficulties = selectedDifficulties.includes(d)
			? selectedDifficulties.filter((x) => x !== d)
			: [...selectedDifficulties, d];
	}

	function start() {
		const rng = mulberry32(Date.now());
		items = buildQuizItems(shuffle(pool, rng).slice(0, QUIZ_LENGTH), rng);
		records = [];
		startedAt = Date.now();
		phase = 'playing';
	}

	function complete(finished: AnswerRecord[]) {
		records = finished;
		recordAnswers(DEFAULT_RULESET_ID, finished);
		const payload = buildAttemptPayload({
			rulesetId: DEFAULT_RULESET_ID,
			mode: 'quick',
			startedAt,
			durationS: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
			items,
			records: finished
		});
		if (payload) enqueueAttempt(payload);
		phase = 'done';
	}
</script>

<svelte:head><title>Quick quiz · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<p class="text-xs font-semibold tracking-[0.18em] text-cardinal uppercase">Quick quiz</p>
	<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Ten questions.</h1>

	{#if phase === 'setup'}
		<div class="card mt-8 p-6 sm:p-8">
			<h2 class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">Sections</h2>
			<p class="mt-1 text-sm text-navy/60">Leave everything off to draw from the whole bank.</p>
			<div class="mt-3 flex flex-wrap gap-2">
				{#each sections as section (section.slug)}
					<button
						type="button"
						aria-pressed={selectedSections.includes(section.slug)}
						onclick={() => toggleSection(section.slug)}
						class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors
							{selectedSections.includes(section.slug)
							? 'border-navy bg-navy text-white'
							: 'border-mist text-navy/70 hover:border-navy/40'}"
					>
						{section.number}. {section.title}
					</button>
				{/each}
			</div>

			<h2 class="mt-6 text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">
				Difficulty
			</h2>
			<div class="mt-3 flex flex-wrap gap-2">
				{#each DIFFICULTIES as d (d)}
					<button
						type="button"
						aria-pressed={selectedDifficulties.includes(d)}
						onclick={() => toggleDifficulty(d)}
						class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors
							{selectedDifficulties.includes(d)
							? 'border-navy bg-navy text-white'
							: 'border-mist text-navy/70 hover:border-navy/40'}"
					>
						{d} · {DIFFICULTY_LABELS[d]}
					</button>
				{/each}
			</div>

			<div class="mt-8 flex items-center justify-between border-t border-mist pt-5">
				<p class="text-sm text-navy/60" aria-live="polite">
					{pool.length} question{pool.length === 1 ? '' : 's'} match
				</p>
				<button
					type="button"
					disabled={pool.length === 0}
					onclick={start}
					class="rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110 disabled:opacity-40"
				>
					Start quiz
				</button>
			</div>
		</div>
	{:else if phase === 'playing'}
		<div class="mt-8">
			<QuestionPlayer {items} rulesetId={DEFAULT_RULESET_ID} onComplete={complete} />
		</div>
	{:else}
		<div class="mt-8">
			<QuizSummary {items} {records} rulesetId={DEFAULT_RULESET_ID}>
				<div class="mt-4 flex gap-3">
					<button
						type="button"
						onclick={start}
						class="rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
					>
						Play again
					</button>
					<button
						type="button"
						onclick={() => (phase = 'setup')}
						class="rounded-full border border-navy/30 px-6 py-2.5 text-sm font-semibold tracking-wider text-navy uppercase hover:border-navy"
					>
						Change settings
					</button>
				</div>
			</QuizSummary>
		</div>
	{/if}
</section>
