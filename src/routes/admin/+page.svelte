<script lang="ts">
	import ThumbIcon from '$lib/components/icons/ThumbIcon.svelte';

	let { data } = $props();
	const m = $derived(data.metrics);
	const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
	function bars(series: { day: string; count: number }[]) {
		const max = Math.max(1, ...series.map((s) => s.count));
		return series.map((s) => ({ ...s, h: Math.round((s.count / max) * 100) }));
	}
</script>

{#snippet tile(label: string, value: string | number, hint: string = '')}
	<div
		class="flex items-center justify-between gap-3 rounded-lg border border-navy/10 bg-white p-4"
	>
		<div class="min-w-0">
			<div class="text-xs font-medium text-navy/60">{label}</div>
			{#if hint}<div class="mt-0.5 text-[11px] text-navy/40">{hint}</div>{/if}
		</div>
		<div class="shrink-0 text-2xl font-semibold text-navy tabular-nums">{value}</div>
	</div>
{/snippet}

{#snippet barRow(title: string, series: { day: string; count: number }[])}
	<div class="rounded-lg border border-navy/10 bg-white p-4">
		<div class="mb-2 flex items-baseline justify-between">
			<div class="text-xs font-medium text-navy/70">{title}</div>
			<div class="text-[11px] text-navy/40">peak {Math.max(0, ...series.map((s) => s.count))}</div>
		</div>
		{#if series.some((s) => s.count > 0)}
			<div class="flex h-16 items-end gap-px border-b border-navy/10">
				{#each bars(series) as b (b.day)}
					<div
						class="flex-1 rounded-t bg-cardinal/70"
						style="height: {b.count > 0 ? Math.max(b.h, 8) : 0}%"
						title="{b.day}: {b.count}"
					></div>
				{/each}
			</div>
			<div class="mt-1 flex justify-between text-[10px] text-navy/40">
				<span>{series[0]?.day.slice(5)}</span>
				<span>{series[series.length - 1]?.day.slice(5)}</span>
			</div>
		{:else}
			<div class="flex h-16 items-center justify-center text-xs text-navy/30">
				No activity in this range
			</div>
		{/if}
	</div>
{/snippet}

{#snippet sectionHead(label: string)}
	<h2 class="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">{label}</h2>
{/snippet}

<section>
	{@render sectionHead('Totals')}
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{@render tile('Users', m.totals.users)}
		{@render tile('Active users', m.totals.activeUsers)}
		{@render tile('Quiz attempts', m.totals.quizAttempts)}
		{@render tile('Questions asked', m.totals.asks)}
	</div>
</section>

<section class="mt-6">
	{@render sectionHead(`Last ${m.rangeDays} days`)}
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{@render tile('New users', m.recent.newUsers)}
		{@render tile('Active users', m.recent.activeUsers)}
		{@render tile('Quiz attempts', m.recent.quizAttempts)}
		{@render tile('Questions asked', m.recent.asks)}
	</div>
	<div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<div
			class="flex items-center justify-between gap-3 rounded-lg border border-navy/10 bg-white p-4"
		>
			<div class="min-w-0">
				<div class="flex items-center gap-1 text-xs font-medium text-navy/60">
					<ThumbIcon direction="down" class="block h-3.5 w-3.5" /> Thumbs-down rate
				</div>
				<div class="mt-0.5 text-[11px] text-navy/40">
					{m.aiQuality.down} of {m.aiQuality.answerTotal} answers
				</div>
			</div>
			<div class="shrink-0 text-2xl font-semibold text-navy tabular-nums">
				{pct(m.aiQuality.downRate)}
			</div>
		</div>
		{@render tile(
			'Error rate',
			pct(m.aiQuality.errorRate),
			`of ${m.aiQuality.answerTotal} answers`
		)}
		{@render tile(
			'Truncated rate',
			pct(m.aiQuality.truncatedRate),
			`of ${m.aiQuality.answerTotal} answers`
		)}
		{@render tile(
			'Quiz fallback',
			pct(m.aiQuality.fallbackRate),
			`${m.aiQuality.fallback} of ${m.aiQuality.questionTotal} generated`
		)}
	</div>
</section>

<div class="mt-6 grid gap-3 sm:grid-cols-2">
	{@render barRow(`Daily active users (${m.rangeDays}d)`, m.dailyActive)}
	{@render barRow(`Daily sign-ups (${m.rangeDays}d)`, m.dailySignups)}
</div>

{#if m.quizByMode.length}
	<div class="mt-6 rounded-lg border border-navy/10 bg-white p-4">
		<div class="mb-2 text-xs font-medium text-navy/70">Quiz attempts by mode</div>
		<table class="w-full text-sm">
			<tbody>
				{#each m.quizByMode as row (row.mode)}
					<tr class="border-t border-navy/5"
						><td class="py-1 text-navy/70">{row.mode}</td><td
							class="py-1 text-right font-medium text-navy">{row.count}</td
						></tr
					>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
