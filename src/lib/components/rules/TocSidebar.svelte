<script lang="ts">
	import type { Manifest } from '$lib/content/types';
	let { manifest, current }: { manifest: Manifest; current: string } = $props();
</script>

<!-- -mx-3 cancels the rows' px-3 so the text column aligns with the page
     container edge (and the nav wordmark); the hover pill pads outward. -->
<nav aria-label="Sections" class="-mx-3 space-y-0.5 text-sm">
	{#each manifest.sections as s (s.slug)}
		<a
			href="/rules/{manifest.id}/{s.slug}"
			aria-current={s.slug === current ? 'page' : undefined}
			class="flex items-baseline gap-2 rounded-md px-3 py-1.5 transition-colors
				{s.slug === current
				? 'bg-white/10 font-semibold text-white'
				: 'text-white/60 hover:bg-white/5 hover:text-white'}"
		>
			<span class="w-6 shrink-0 text-right font-mono text-xs text-cardinal"
				>{s.number ? s.number + '.' : ''}</span
			>
			<span class="min-w-0 flex-1">{s.title}</span>
		</a>
	{/each}
</nav>
