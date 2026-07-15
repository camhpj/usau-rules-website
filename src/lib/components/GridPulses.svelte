<script lang="ts">
	import { onMount } from 'svelte';
	import { gridLineOffsets } from '$lib/grid-pulse-lines';

	const TILE = 96;
	const MAX_CONCURRENT = 4;

	type Pulse = { id: number; axis: 'x' | 'y'; offset: number };

	let container: HTMLDivElement;
	let pulses = $state<Pulse[]>([]);
	let nextId = 0;

	function spawn() {
		if (pulses.length >= MAX_CONCURRENT) return;
		const rect = container.getBoundingClientRect();
		const axis: 'x' | 'y' = Math.random() < 0.5 ? 'x' : 'y';
		const offsets =
			axis === 'x'
				? gridLineOffsets(rect.top + window.scrollY, rect.height, TILE)
				: gridLineOffsets(rect.left + window.scrollX, rect.width, TILE);
		if (offsets.length === 0) return;
		const offset = offsets[Math.floor(Math.random() * offsets.length)];
		pulses = [...pulses, { id: nextId++, axis, offset }];
	}

	function remove(id: number) {
		pulses = pulses.filter((p) => p.id !== id);
	}

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		let timer: ReturnType<typeof setTimeout>;
		const schedule = (delay: number) => {
			timer = setTimeout(() => {
				spawn();
				schedule(2500 + Math.random() * 3000);
			}, delay);
		};
		schedule(800);
		return () => clearTimeout(timer);
	});
</script>

<div
	bind:this={container}
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 overflow-hidden"
>
	{#each pulses as pulse (pulse.id)}
		{#if pulse.axis === 'x'}
			<div
				class="grid-pulse grid-pulse-x"
				style="top: {pulse.offset}px"
				onanimationend={() => remove(pulse.id)}
			></div>
		{:else}
			<div
				class="grid-pulse grid-pulse-y"
				style="left: {pulse.offset}px"
				onanimationend={() => remove(pulse.id)}
			></div>
		{/if}
	{/each}
</div>
