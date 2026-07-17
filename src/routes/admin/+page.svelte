<script lang="ts">
	let { data } = $props();
	const m = data.metrics;
	const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
	function bars(series: { day: string; count: number }[]) {
		const max = Math.max(1, ...series.map((s) => s.count));
		return series.map((s) => ({ ...s, h: Math.round((s.count / max) * 100) }));
	}
</script>

{#snippet tile(label: string, value: string | number, hint: string = '')}
	<div class="rounded-lg border border-navy/10 bg-white p-4">
		<div class="text-2xl font-semibold text-navy">{value}</div>
		<div class="text-xs text-navy/60">{label}</div>
		{#if hint}<div class="mt-1 text-[11px] text-navy/40">{hint}</div>{/if}
	</div>
{/snippet}

{#snippet barRow(title: string, series: { day: string; count: number }[])}
	<div class="rounded-lg border border-navy/10 bg-white p-4">
		<div class="mb-2 text-xs font-medium text-navy/70">{title}</div>
		<div class="flex h-16 items-end gap-1">
			{#each bars(series) as b (b.day)}
				<div
					class="flex-1 rounded-t bg-cardinal/70"
					style="height: {b.h}%"
					title="{b.day}: {b.count}"
				></div>
			{/each}
		</div>
	</div>
{/snippet}

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
	{@render tile('Users', m.totals.users, `+${m.recent.newUsers7d} in 7d`)}
	{@render tile('Conversations', m.totals.conversations)}
	{@render tile('Messages', m.totals.messages)}
	{@render tile('Quiz attempts', m.totals.quizAttempts, `+${m.recent.quizAttempts7d} in 7d`)}
	{@render tile('Asks today', m.recent.asksToday, `${m.recent.asks7d} in 7d`)}
	{@render tile('👎 ratio', pct(m.feedback.downRatio), `${m.feedback.up}👍 / ${m.feedback.down}👎`)}
	{@render tile(
		'Truncated',
		pct(m.answerHealth.truncatedRate),
		`of ${m.answerHealth.assistantTotal} answers`
	)}
	{@render tile('Errored', pct(m.answerHealth.errorRate), 'of assistant answers')}
	{@render tile(
		'Q fallback',
		pct(m.questionHealth.fallbackRate),
		`of ${m.questionHealth.total} gen`
	)}
	{@render tile('Quota hits 7d', m.quotaHits7d, 'users at daily cap')}
</div>

<div class="mt-4 grid gap-4 sm:grid-cols-2">
	{@render barRow('Daily asks (14d)', m.dailyAsks)}
	{@render barRow('Daily sign-ups (14d)', m.dailySignups)}
</div>

{#if m.quizByMode.length}
	<div class="mt-4 rounded-lg border border-navy/10 bg-white p-4">
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
