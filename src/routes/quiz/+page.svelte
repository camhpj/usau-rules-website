<script lang="ts">
	import { onMount } from 'svelte';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { listQuestions, questionCountsBySection } from '$lib/quiz/bank';
	import { computeSectionMastery } from '$lib/quiz/mastery';
	import { getTimedBest, loadResponses } from '$lib/quiz/storage';

	const questionTotal = listQuestions(DEFAULT_RULESET_ID).length;
	const sectionSlugs = [...questionCountsBySection(DEFAULT_RULESET_ID).keys()];

	let masteredCount = $state<number | null>(null);
	let bestScore = $state<number | null>(null);

	onMount(() => {
		const responses = loadResponses(DEFAULT_RULESET_ID);
		masteredCount = sectionSlugs.filter(
			(slug) => computeSectionMastery(responses, slug).level === 'mastered'
		).length;
		bestScore = getTimedBest(DEFAULT_RULESET_ID)?.score ?? null;
	});

	const modes = $derived([
		{
			href: '/quiz/quick',
			title: 'Quick quiz',
			body: 'Ten questions from the bank — pick your sections and difficulty.',
			stat: `${questionTotal} questions in the bank`
		},
		{
			href: '/quiz/mastery',
			title: 'Section mastery',
			body: 'Work through the rulebook section by section; missed questions come back first.',
			stat:
				masteredCount === null ? '' : `${masteredCount}/${sectionSlugs.length} sections mastered`
		},
		{
			href: '/quiz/timed',
			title: 'Timed challenge',
			body: 'Sixty seconds against the clock. Keep the streak alive.',
			stat: bestScore === null ? 'No personal best yet' : `Personal best: ${bestScore}`
		}
	]);
</script>

<svelte:head><title>Quiz · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-6xl px-4 py-12 sm:px-6">
	<p class="text-xs font-semibold tracking-[0.18em] text-cardinal uppercase">Test yourself</p>
	<h1 class="display mt-3 text-5xl text-white sm:text-6xl">Pick your game.</h1>
	<p class="mt-4 max-w-xl text-white/70">
		Every question is grounded in the official rules, with citations that link straight into the
		rulebook.
	</p>

	<div class="mt-10 grid gap-4 md:grid-cols-3">
		{#each modes as mode (mode.href)}
			<a
				href={mode.href}
				class="group relative rounded-xl bg-white p-6 text-navy transition-transform hover:-translate-y-0.5"
			>
				<h2 class="display text-2xl">{mode.title}</h2>
				<p class="mt-1.5 pr-8 text-sm text-navy/70">{mode.body}</p>
				{#if mode.stat}
					<p class="mt-4 text-xs font-semibold tracking-wider text-navy/50 uppercase">
						{mode.stat}
					</p>
				{/if}
				<span
					aria-hidden="true"
					class="absolute top-6 right-6 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-1"
					>→</span
				>
			</a>
		{/each}
	</div>
</section>
