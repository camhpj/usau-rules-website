<script lang="ts">
	import { Popover } from 'bits-ui';
	import { afterNavigate } from '$app/navigation';
	import type { GlossaryEntry } from '$lib/content/types';

	let {
		glossary,
		rulesetId,
		container
	}: { glossary: GlossaryEntry[]; rulesetId: string; container: HTMLElement | undefined } =
		$props();

	let open = $state(false);
	let anchor = $state<HTMLElement | null>(null);
	let entry = $state<GlossaryEntry | null>(null);

	afterNavigate(() => {
		open = false;
		anchor = null;
		entry = null;
	});

	$effect(() => {
		if (!container) return;
		const onClick = (e: MouseEvent) => {
			const dfn = (e.target as HTMLElement).closest('dfn[data-rule]');
			if (!dfn || !container.contains(dfn)) return;
			e.preventDefault();
			entry = glossary.find((g) => g.ruleId === dfn.getAttribute('data-rule')) ?? null;
			anchor = dfn as HTMLElement;
			open = entry !== null;
		};
		container.addEventListener('click', onClick);
		return () => container.removeEventListener('click', onClick);
	});
</script>

<Popover.Root bind:open>
	<Popover.Portal>
		<Popover.Content
			customAnchor={anchor}
			sideOffset={6}
			class="z-50 max-w-sm rounded-lg border border-mist bg-white p-4 text-sm text-navy shadow-xl"
		>
			{#if entry}
				<p class="display text-lg text-navy">{entry.term}</p>
				<p class="mt-1 leading-relaxed text-navy/80">{entry.definition}</p>
				<a
					class="mt-2 inline-block text-xs font-semibold tracking-wider text-cardinal uppercase hover:underline"
					href="/rules/{rulesetId}/{entry.ruleId.split('.')[0]}#{entry.ruleId}"
					onclick={() => (open = false)}
				>
					Definition {entry.ruleId} →
				</a>
			{/if}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
