<script lang="ts">
	import { ruleRefLabel, sectionSlugForRuleId } from '$lib/content/rule-ids';

	let { refs, rulesetId }: { refs: string[]; rulesetId: string } = $props();

	function href(id: string): string | null {
		const slug = sectionSlugForRuleId(id);
		return slug ? `/rules/${rulesetId}/${slug}#${encodeURIComponent(id)}` : null;
	}

	/** "Open rule 15.F.2 in the explorer" for a numeric id, "Open Appendix G in the explorer" for an appendix anchor. */
	function refTitle(id: string): string {
		const label = ruleRefLabel(id);
		return label === id ? `Open rule ${label} in the explorer` : `Open ${label} in the explorer`;
	}
</script>

<span class="inline-flex flex-wrap gap-2">
	{#each refs as ref (ref)}
		{@const link = href(ref)}
		{@const label = ruleRefLabel(ref)}
		{#if link}
			<a
				href={link}
				target="_blank"
				rel="noopener"
				class="rounded border border-cardinal/40 px-2 py-0.5 text-xs font-semibold text-cardinal no-underline transition-colors hover:bg-cardinal hover:text-white"
				class:font-mono={label === ref}
				title={refTitle(ref)}
			>
				{label} ↗
			</a>
		{:else}
			<span
				class="rounded border border-navy/20 px-2 py-0.5 text-xs text-navy/60"
				class:font-mono={label === ref}>{label}</span
			>
		{/if}
	{/each}
</span>
