<script lang="ts">
	import type { RuleNode as TRuleNode } from '$lib/content/types';
	import RuleNode from './RuleNode.svelte';
	import { bookmarks } from '$lib/bookmarks.svelte';
	let {
		node,
		depth = 0,
		rulesetId
	}: { node: TRuleNode; depth?: number; rulesetId: string } = $props();
	const marked = $derived(bookmarks.has(rulesetId, node.id));
</script>

<div
	id={node.id}
	class="scroll-mt-24 {depth > 0 ? 'mt-3 ml-4 border-l border-mist pl-4 sm:ml-5' : 'mt-6'}"
>
	<div class="group relative flex items-baseline gap-2">
		<a
			href="#{node.id}"
			data-inline-target
			class="shrink-0 font-mono text-[13px] font-semibold text-cardinal no-underline hover:underline"
			title="Link to {node.id}">{node.label}</a
		>
		<div class="rule-html min-w-0 text-[15px] leading-relaxed text-navy pointer-coarse:pr-7">
			{@html node.html}
		</div>
		{#if bookmarks.enabled}
			<button
				type="button"
				aria-pressed={marked}
				aria-label="{marked ? 'Remove bookmark for' : 'Bookmark'} rule {node.id}"
				onclick={() => bookmarks.toggle(rulesetId, node.id)}
				class="flex shrink-0 items-center justify-center self-center transition-opacity pointer-coarse:absolute pointer-coarse:top-1/2 pointer-coarse:right-0 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:-translate-y-1/2 pointer-coarse:justify-end pointer-coarse:opacity-100 {marked
					? 'text-cardinal opacity-100'
					: 'text-navy/30 opacity-0 group-hover:opacity-100 hover:text-cardinal focus-visible:opacity-100 pointer-coarse:text-navy/70'}"
			>
				<svg aria-hidden="true" class="h-4 w-4" viewBox="0 -960 960 960" fill="currentColor">
					{#if marked}
						<path
							d="M200-120v-640q0-33 23.5-56.5T280-840h400q33 0 56.5 23.5T760-760v640L480-240 200-120Z"
						/>
					{:else}
						<path
							d="M200-120v-640q0-33 23.5-56.5T280-840h400q33 0 56.5 23.5T760-760v640L480-240 200-120Zm80-122 200-86 200 86v-518H280v518Z"
						/>
					{/if}
				</svg>
			</button>
		{/if}
	</div>
	{#each node.annotations as annotation, i (i)}
		<aside
			class="mt-2 rounded-md border-l-2 border-cardinal/60 bg-mist px-3 py-2 text-sm text-navy/80"
		>
			<span class="text-[10px] font-bold tracking-wider text-cardinal uppercase"
				>Official annotation</span
			>
			<p class="mt-0.5">{annotation}</p>
		</aside>
	{/each}
	{#each node.children as child (child.id)}
		<RuleNode node={child} depth={depth + 1} {rulesetId} />
	{/each}
</div>
