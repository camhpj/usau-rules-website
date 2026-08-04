<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		selected,
		onclick,
		children
	}: {
		selected: boolean;
		onclick: () => void;
		children: Snippet;
	} = $props();
</script>

<button
	type="button"
	aria-pressed={selected}
	{onclick}
	class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors
		{selected ? 'border-navy bg-navy text-white' : 'border-mist text-navy/70 hover:border-navy/40'}"
>
	{@render children()}
</button>
