<script lang="ts">
	import { sectionSlugForRuleId } from '$lib/content/rule-ids';

	let { refs, rulesetId }: { refs: string[]; rulesetId: string } = $props();

	function href(id: string): string | null {
		const slug = sectionSlugForRuleId(id);
		return slug ? `/rules/${rulesetId}/${slug}#${encodeURIComponent(id)}` : null;
	}
</script>

<span class="inline-flex flex-wrap gap-2">
	{#each refs as ref (ref)}
		{@const link = href(ref)}
		{#if link}
			<a
				href={link}
				target="_blank"
				rel="noopener"
				class="rounded border border-cardinal/40 px-2 py-0.5 font-mono text-xs font-semibold text-cardinal no-underline transition-colors hover:bg-cardinal hover:text-white"
				title="Open rule {ref} in the explorer"
			>
				{ref} ↗
			</a>
		{:else}
			<span class="rounded border border-navy/20 px-2 py-0.5 font-mono text-xs text-navy/60"
				>{ref}</span
			>
		{/if}
	{/each}
</span>
