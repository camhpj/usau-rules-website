<script lang="ts">
	import { segmentCitations } from '$lib/content/citations';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { ruleIdSet } from '$lib/content/rule-id-sets';
	import { sectionSlugForRuleId } from '$lib/content/rule-ids';

	let { answer, streaming = false }: { answer: string; streaming?: boolean } = $props();

	const ruleIds = ruleIdSet(DEFAULT_RULESET_ID);
	const segments = $derived(segmentCitations(answer, ruleIds));

	function refHref(id: string): string | null {
		const slug = sectionSlugForRuleId(id);
		return slug ? `/rules/${DEFAULT_RULESET_ID}/${slug}#${encodeURIComponent(id)}` : null;
	}
</script>

<p class="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap text-navy">
	{#each segments as segment, i (i)}
		{#if segment.type === 'text'}{segment.text}{:else}
			{@const link = refHref(segment.anchorId)}
			{#if link}
				<a
					href={link}
					target="_blank"
					rel="noopener"
					title="Open rule {segment.anchorId} in the explorer"
					class="font-mono text-[13px] font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
					>{segment.id}</a
				>
			{:else}<span class="font-mono text-[13px] font-semibold">{segment.id}</span>{/if}
		{/if}
	{/each}{#if streaming}<span
			class="ml-0.5 inline-block h-4 w-2 animate-pulse bg-cardinal/60"
			aria-hidden="true"
		></span>{/if}
</p>
