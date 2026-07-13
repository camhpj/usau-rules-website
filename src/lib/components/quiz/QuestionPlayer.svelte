<script lang="ts">
	import type { AnswerRecord, QuizItem } from '$lib/quiz/engine';
	import RuleRefLinks from './RuleRefLinks.svelte';

	let {
		items,
		rulesetId,
		mode = 'standard',
		finishLabel = 'See results',
		onAnswer,
		onComplete
	}: {
		items: QuizItem[];
		rulesetId: string;
		mode?: 'standard' | 'rapid';
		finishLabel?: string;
		onAnswer?: (record: AnswerRecord) => void;
		onComplete: (records: AnswerRecord[]) => void;
	} = $props();

	const RAPID_ADVANCE_MS = 600;
	const CHOICE_KEYS = ['A', 'B', 'C', 'D'];

	let index = $state(0);
	let chosen = $state<number | null>(null);
	// Latched when onComplete fires. The component stays mounted in the revealed
	// state on the last item, so without this a second Enter press or CTA click
	// would re-enter next() and fire onComplete again.
	let finished = $state(false);
	let records: AnswerRecord[] = [];
	let advanceTimer: ReturnType<typeof setTimeout> | undefined;

	const item = $derived(items[index]);
	const revealed = $derived(chosen !== null);

	function choose(display: number) {
		if (!item || finished || chosen !== null) return;
		chosen = display;
		const record: AnswerRecord = {
			questionId: item.question.id,
			sectionSlug: item.question.sectionSlug,
			chosenChoice: display,
			correct: display === item.correctChoice
		};
		records.push(record);
		onAnswer?.(record);
		if (mode === 'rapid') advanceTimer = setTimeout(next, RAPID_ADVANCE_MS);
	}

	function next() {
		if (finished) return;
		clearTimeout(advanceTimer);
		if (index + 1 >= items.length) {
			finished = true;
			onComplete([...records]);
			return;
		}
		chosen = null;
		index += 1;
	}

	function onKeydown(e: KeyboardEvent) {
		if (!item || finished) return;
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
		if (!revealed) {
			// A–D are the primary answer keys (case-insensitive), matching the
			// on-screen choice badges; 1–4 remain a legacy alias.
			const letterIndex = CHOICE_KEYS.indexOf(e.key.toUpperCase());
			const digit = Number(e.key);
			const choiceIndex =
				letterIndex !== -1 && letterIndex < item.order.length
					? letterIndex
					: digit >= 1 && digit <= item.order.length
						? digit - 1
						: -1;
			if (choiceIndex !== -1) {
				e.preventDefault();
				choose(choiceIndex);
			}
		}
		if (revealed && mode === 'standard' && e.key === 'Enter') {
			e.preventDefault();
			next();
		}
	}

	$effect(() => () => clearTimeout(advanceTimer));
</script>

<svelte:window onkeydown={onKeydown} />

{#if item}
	<div class="rounded-xl bg-white p-6 text-navy sm:p-8">
		{#if mode !== 'rapid'}
			<p class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">
				Question {index + 1} of {items.length}
			</p>
		{/if}
		<h2 class="mt-3 text-lg leading-relaxed font-semibold">{item.question.prompt}</h2>

		<div class="mt-5 grid gap-2.5">
			{#each item.order as choiceIndex, display (`${item.question.id}:${choiceIndex}`)}
				{@const isCorrect = display === item.correctChoice}
				{@const isChosen = display === chosen}
				<button
					type="button"
					data-testid="choice"
					disabled={revealed}
					onclick={() => choose(display)}
					class="flex items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors
						{!revealed ? 'border-mist hover:border-navy/40 hover:bg-mist/50' : ''}
						{revealed && isCorrect ? 'border-turf bg-turf/10' : ''}
						{revealed && isChosen && !isCorrect ? 'border-cardinal bg-cardinal/10' : ''}
						{revealed && !isChosen && !isCorrect ? 'border-mist text-navy/50' : ''}"
				>
					<span
						class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-current font-mono text-[11px] font-bold"
					>
						{CHOICE_KEYS[display]}
					</span>
					<span class="min-w-0">{item.question.choices[choiceIndex]}</span>
					{#if revealed && isCorrect}
						<span class="ml-auto shrink-0 font-bold text-turf">✓</span>
					{:else if revealed && isChosen}
						<span class="ml-auto shrink-0 font-bold text-cardinal">✗</span>
					{/if}
				</button>
			{/each}
		</div>

		{#if revealed && mode === 'standard'}
			<div class="mt-5 rounded-lg bg-mist p-4">
				<p class="display text-lg {chosen === item.correctChoice ? 'text-turf' : 'text-cardinal'}">
					{chosen === item.correctChoice ? 'Correct' : 'Not quite'}
				</p>
				<p class="mt-1.5 text-sm leading-relaxed text-navy/80">{item.question.explanation}</p>
				<p class="mt-2.5"><RuleRefLinks refs={item.question.ruleRefs} {rulesetId} /></p>
				<button
					type="button"
					disabled={finished}
					onclick={next}
					class="mt-4 rounded-full bg-cardinal px-6 py-2 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100"
				>
					{index + 1 >= items.length ? finishLabel : 'Next question'}
				</button>
			</div>
		{/if}
	</div>
{/if}
