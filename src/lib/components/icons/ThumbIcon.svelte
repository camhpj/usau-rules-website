<script lang="ts">
	/**
	 * Lucide's thumbs-up / thumbs-down pair.
	 *
	 * The down variant is Lucide's own path, not the up path rotated. Both are
	 * drawn to the same optical box as the rest of the icon set (spanning y2–y22
	 * of a 24 viewBox), which is what keeps a row of mixed icons sitting on one
	 * baseline. Rotating instead works geometrically but drifts once either path
	 * changes, and it silently opts this icon out of that shared box.
	 *
	 * stroke-width matches the Lucide default of 2. A lighter weight here reads
	 * as misalignment next to any neighbouring icon.
	 */
	let {
		direction = 'up',
		filled = false,
		class: klass = 'block h-4 w-4'
	}: { direction?: 'up' | 'down'; filled?: boolean; class?: string } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	fill={filled ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={klass}
	aria-hidden="true"
>
	{#if direction === 'up'}
		<path d="M7 10v12" />
		<path
			d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
		/>
	{:else}
		<path d="M17 14V2" />
		<path
			d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"
		/>
	{/if}
</svg>
