<script lang="ts">
	import { onMount } from 'svelte';
	import QuestionPlayer from '$lib/components/quiz/QuestionPlayer.svelte';
	import QuizSummary from '$lib/components/quiz/QuizSummary.svelte';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { getManifest } from '$lib/content/manifests';
	import type { TocEntry } from '$lib/content/types';
	import { listQuestions, questionCountsBySection } from '$lib/quiz/bank';
	import { buildQuizItems, mulberry32, type AnswerRecord, type QuizItem } from '$lib/quiz/engine';
	import { computeSectionMastery, orderForMastery, type SectionMastery } from '$lib/quiz/mastery';
	import { LEVEL_LABELS, LEVEL_STYLES } from '$lib/quiz/mastery-ui';
	import { loadResponses, recordAnswers } from '$lib/quiz/storage';
	import { buildAttemptPayload, enqueueAttempt } from '$lib/quiz/sync';

	const RUN_LENGTH = 10;

	const manifest = getManifest(DEFAULT_RULESET_ID);
	const bank = listQuestions(DEFAULT_RULESET_ID);
	const counts = questionCountsBySection(DEFAULT_RULESET_ID);
	const sections = manifest.sections.filter((s) => (counts.get(s.slug) ?? 0) > 0);

	let phase = $state<'grid' | 'playing' | 'done'>('grid');
	let mastery = $state<Map<string, SectionMastery>>(new Map());
	let active = $state<TocEntry | null>(null);
	let items = $state<QuizItem[]>([]);
	let records = $state<AnswerRecord[]>([]);
	let startedAt = 0;

	function refresh() {
		const responses = loadResponses(DEFAULT_RULESET_ID);
		mastery = new Map(sections.map((s) => [s.slug, computeSectionMastery(responses, s.slug)]));
	}

	onMount(() => {
		refresh();
		const slug = new URLSearchParams(location.search).get('section');
		const target = sections.find((s) => s.slug === slug);
		if (target) startSection(target);
	});

	function startSection(section: TocEntry) {
		const rng = mulberry32(Date.now());
		const ordered = orderForMastery(
			bank.filter((q) => q.sectionSlug === section.slug),
			loadResponses(DEFAULT_RULESET_ID),
			rng
		);
		items = buildQuizItems(ordered.slice(0, RUN_LENGTH), rng);
		active = section;
		records = [];
		startedAt = Date.now();
		phase = 'playing';
	}

	function complete(finished: AnswerRecord[]) {
		records = finished;
		recordAnswers(DEFAULT_RULESET_ID, finished);
		const payload = buildAttemptPayload({
			rulesetId: DEFAULT_RULESET_ID,
			mode: 'mastery',
			sectionSlug: active!.slug,
			startedAt,
			durationS: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
			items,
			records: finished
		});
		if (payload) enqueueAttempt(payload);
		refresh();
		phase = 'done';
	}
</script>

<svelte:head><title>Section mastery · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-4xl px-4 py-10 sm:px-6">
	<p class="text-xs font-semibold tracking-[0.18em] text-cardinal uppercase">Section mastery</p>

	{#if phase === 'grid'}
		<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Own the rulebook.</h1>
		<p class="mt-3 max-w-xl text-white/70">
			Miss a question and it comes back first next time. Answer 90% of a section's questions
			correctly to master it.
		</p>
		<div class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each sections as section (section.slug)}
				{@const m = mastery.get(section.slug)}
				<button
					type="button"
					onclick={() => startSection(section)}
					class="rounded-xl border p-4 text-left transition-transform hover:-translate-y-0.5 {LEVEL_STYLES[
						m?.level ?? 'unseen'
					]}"
				>
					<p class="font-mono text-xs text-cardinal">{section.number}.</p>
					<p class="display mt-1 text-xl">{section.title}</p>
					<p class="mt-2 text-xs tracking-wider uppercase opacity-80">
						{LEVEL_LABELS[m?.level ?? 'unseen']}{#if m && m.attempts > 0}
							&nbsp;· {m.recentPct}% recent{/if}
					</p>
				</button>
			{/each}
		</div>
	{:else if phase === 'playing' && active}
		<h1 class="display mt-2 text-4xl text-white sm:text-5xl">
			{active.number}. {active.title}
		</h1>
		<div class="mt-8">
			<QuestionPlayer {items} rulesetId={DEFAULT_RULESET_ID} onComplete={complete} />
		</div>
	{:else if active}
		<h1 class="display mt-2 text-4xl text-white sm:text-5xl">
			{active.number}. {active.title}
		</h1>
		<div class="mt-8">
			<QuizSummary {items} {records} rulesetId={DEFAULT_RULESET_ID}>
				{@const m = mastery.get(active.slug)}
				{#if m}
					<p class="mt-3 text-sm font-semibold text-navy/70">
						Section status: {LEVEL_LABELS[m.level]} · {m.recentPct}% over your last
						{m.attempts} answers
					</p>
				{/if}
				<div class="mt-4 flex gap-3">
					<button
						type="button"
						onclick={() => startSection(active!)}
						class="rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
					>
						Run it again
					</button>
					<button
						type="button"
						onclick={() => (phase = 'grid')}
						class="rounded-full border border-navy/30 px-6 py-2.5 text-sm font-semibold tracking-wider text-navy uppercase hover:border-navy"
					>
						All sections
					</button>
				</div>
			</QuizSummary>
		</div>
	{/if}
</section>
