<script lang="ts">
	import type { Snippet } from 'svelte';
	import { summarize, type AnswerRecord, type QuizItem } from '$lib/quiz/engine';
	import RuleRefLinks from './RuleRefLinks.svelte';

	let {
		items,
		records,
		rulesetId,
		heading = 'Results',
		children
	}: {
		items: QuizItem[];
		records: AnswerRecord[];
		rulesetId: string;
		heading?: string;
		children?: Snippet;
	} = $props();

	const score = $derived(summarize(records));
	const itemsById = $derived(new Map(items.map((i) => [i.question.id, i])));
</script>

<div class="rounded-xl bg-white p-6 text-navy sm:p-8">
	<p class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">{heading}</p>
	<p class="display mt-2 text-6xl">
		{score.correct}<span class="text-navy/30">/{score.total}</span>
	</p>
	<p class="mt-1 text-sm text-navy/60">{score.pct}% correct</p>

	{#if children}{@render children()}{/if}

	<ul class="mt-6 space-y-5 border-t border-mist pt-6">
		{#each records as record, i (i)}
			{@const item = itemsById.get(record.questionId)}
			{#if item}
				<li class="text-sm">
					<p class="flex items-start gap-2 font-semibold">
						<span class="shrink-0 font-bold {record.correct ? 'text-turf' : 'text-cardinal'}">
							{record.correct ? '✓' : '✗'}
						</span>
						<span>{item.question.prompt}</span>
					</p>
					{#if !record.correct}
						<p class="mt-1 pl-6 text-navy/70">
							Your answer: {item.question.choices[item.order[record.chosenChoice]]}<br />
							Correct answer: {item.question.choices[item.question.answerIndex]}
						</p>
					{/if}
					<p class="mt-1 pl-6 leading-relaxed text-navy/70">{item.question.explanation}</p>
					<p class="mt-1.5 pl-6"><RuleRefLinks refs={item.question.ruleRefs} {rulesetId} /></p>
				</li>
			{/if}
		{/each}
	</ul>
</div>
