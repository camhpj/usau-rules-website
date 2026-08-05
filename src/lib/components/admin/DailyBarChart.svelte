<script lang="ts">
	/**
	 * A quiet daily bar chart for the admin dashboard: a labelled y-axis (max,
	 * midpoint, zero) plus a value readout that follows the nearest bar on
	 * hover or touch. Bars stay plain, non-focusable `div`s — at a 90-day range
	 * they render a couple of pixels wide, far under any tap-target minimum, so
	 * the chart tracks pointer position across the whole row instead of trying
	 * to make each bar its own target.
	 */
	let { title, series }: { title: string; series: { day: string; count: number }[] } = $props();

	const peak = $derived(Math.max(0, ...series.map((s) => s.count)));
	const hasActivity = $derived(peak > 0);
	const scaleMax = $derived(Math.max(1, peak));
	const mid = $derived(Math.round(scaleMax / 2));
	const bars = $derived(series.map((s) => ({ ...s, h: Math.round((s.count / scaleMax) * 100) })));

	let hoverIndex = $state<number | null>(null);
	let rowEl: HTMLDivElement | undefined = $state();
	const hover = $derived(hoverIndex === null ? null : (bars[hoverIndex] ?? null));

	function indexFromClientX(clientX: number): number {
		if (!rowEl || bars.length === 0) return 0;
		const rect = rowEl.getBoundingClientRect();
		if (rect.width === 0) return 0;
		const ratio = (clientX - rect.left) / rect.width;
		return Math.min(bars.length - 1, Math.max(0, Math.floor(ratio * bars.length)));
	}

	function trackPointer(e: PointerEvent) {
		hoverIndex = indexFromClientX(e.clientX);
	}

	function onPointerLeave(e: PointerEvent) {
		// Touch has no "leave" worth acting on — the value stays put until the
		// visitor taps elsewhere (see the effect below), the same way a tap
		// leaves a value on screen instead of requiring a hover that can't happen.
		if (e.pointerType === 'mouse') hoverIndex = null;
	}

	$effect(() => {
		if (hoverIndex === null || !rowEl) return;
		const el = rowEl;
		function dismissIfOutside(e: PointerEvent) {
			if (e.pointerType === 'mouse') return;
			if (!el.contains(e.target as Node)) hoverIndex = null;
		}
		window.addEventListener('pointerdown', dismissIfOutside);
		return () => window.removeEventListener('pointerdown', dismissIfOutside);
	});
</script>

<div class="rounded-lg border border-navy/10 bg-white p-4">
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<div class="text-xs font-medium text-navy/70">{title}</div>
		<div class="text-[11px] text-navy/40 tabular-nums">
			{#if hover}
				{hover.day.slice(5)} · {hover.count}
			{:else}
				peak {peak}
			{/if}
		</div>
	</div>
	{#if hasActivity}
		<p class="sr-only">
			{title}, by day from {series[0]?.day} to {series[series.length - 1]?.day}, peak {peak}.
		</p>
		<div class="flex gap-1.5">
			<div
				class="flex h-16 w-6 shrink-0 flex-col justify-between text-right text-[10px] leading-none text-navy/40 tabular-nums"
				aria-hidden="true"
			>
				<span>{scaleMax}</span>
				<span>{mid}</span>
				<span>0</span>
			</div>
			<div class="min-w-0 flex-1">
				<div
					bind:this={rowEl}
					class="relative flex h-16 touch-none items-end gap-px border-b border-navy/10"
					aria-hidden="true"
					onpointermove={trackPointer}
					onpointerdown={trackPointer}
					onpointerleave={onPointerLeave}
				>
					<div class="pointer-events-none absolute inset-x-0 top-1/2 border-t border-navy/10"></div>
					{#each bars as b, i (b.day)}
						<div
							class="relative flex-1 rounded-t {hoverIndex === i
								? 'bg-cardinal'
								: 'bg-cardinal/70'}"
							style="height: {b.count > 0 ? Math.max(b.h, 8) : 0}%"
						></div>
					{/each}
				</div>
				<div class="mt-1 flex justify-between text-[10px] text-navy/40">
					<span>{series[0]?.day.slice(5)}</span>
					<span>{series[series.length - 1]?.day.slice(5)}</span>
				</div>
			</div>
		</div>
	{:else}
		<div class="flex h-16 items-center justify-center text-xs text-navy/30">
			No activity in this range
		</div>
	{/if}
</div>
