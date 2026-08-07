<script lang="ts">
	/**
	 * A quiet daily bar chart for the admin dashboard: a labelled y-axis (max,
	 * midpoint, zero) plus a tooltip that names the day and count of whichever
	 * bar the pointer is over. Bars stay plain, non-focusable `div`s — at a
	 * 90-day range they render a couple of pixels wide, far under any tap-target
	 * minimum, so the chart tracks pointer position across the whole row instead
	 * of trying to make each bar its own target.
	 *
	 * The chart carries no standing readout. The y-axis already labels the peak,
	 * so a second copy of it in the corner said nothing new, and swapping that
	 * corner between a peak and a hovered value made a fixed part of the chart
	 * appear to change meaning under the pointer.
	 */
	let { title, series }: { title: string; series: { day: string; count: number }[] } = $props();

	const peak = $derived(Math.max(0, ...series.map((s) => s.count)));
	const hasActivity = $derived(peak > 0);
	const scaleMax = $derived(Math.max(1, peak));
	const mid = $derived(Math.round(scaleMax / 2));
	const bars = $derived(series.map((s) => ({ ...s, h: Math.round((s.count / scaleMax) * 100) })));

	let hoverIndex = $state<number | null>(null);
	let rowEl: HTMLDivElement | undefined = $state();
	let rowWidth = $state(0);
	let tipWidth = $state(0);
	// A day with no activity draws no bar, so there is nothing under the pointer
	// to describe. Reporting "· 0" there labelled empty space as if it were a bar.
	const hover = $derived.by(() => {
		if (hoverIndex === null) return null;
		const bar = bars[hoverIndex];
		return bar && bar.count > 0 ? bar : null;
	});

	// Centre the tooltip on its bar, then hold it inside the plot: near either
	// end the bar's centre is closer to the edge than half the tooltip, and an
	// unclamped tooltip would hang off the card and widen the page.
	const tipLeft = $derived.by(() => {
		if (hoverIndex === null || bars.length === 0 || rowWidth === 0) return 0;
		const centre = ((hoverIndex + 0.5) / bars.length) * rowWidth;
		return Math.min(Math.max(centre - tipWidth / 2, 0), Math.max(0, rowWidth - tipWidth));
	});

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
	<div class="mb-2 text-xs font-medium text-navy/70">{title}</div>
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
					bind:clientWidth={rowWidth}
					data-testid="bar-row"
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
					{#if hover}
						<div
							bind:clientWidth={tipWidth}
							data-testid="bar-tooltip"
							class="pointer-events-none absolute top-0 z-10 rounded bg-navy px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white tabular-nums"
							style="left: {tipLeft}px"
						>
							{hover.day.slice(5)} · {hover.count}
						</div>
					{/if}
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
