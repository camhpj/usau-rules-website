<script lang="ts">
	import type { RuleNode as TRuleNode } from '$lib/content/types';
	import RuleNode from './RuleNode.svelte';
	let { node, depth = 0 }: { node: TRuleNode; depth?: number } = $props();
</script>

<div
	id={node.id}
	class="scroll-mt-24 {depth > 0 ? 'mt-3 ml-4 border-l border-mist pl-4 sm:ml-5' : 'mt-6'}"
>
	<div class="group flex items-baseline gap-2">
		<a
			href="#{node.id}"
			class="shrink-0 font-mono text-[13px] font-semibold text-cardinal no-underline hover:underline"
			title="Link to {node.id}">{node.label}</a
		>
		<div class="rule-html min-w-0 text-[15px] leading-relaxed text-navy">
			{@html node.html}
		</div>
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
		<RuleNode node={child} depth={depth + 1} />
	{/each}
</div>
