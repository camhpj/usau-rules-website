<script lang="ts">
	import { tick } from 'svelte';
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

	// SvelteKit reuses the same <article> element (and thus the same `container`)
	// across client-side navigations, so the $effect below won't re-run for a new
	// section's dfns — re-upgrade them after every navigation instead.
	afterNavigate(async () => {
		open = false;
		anchor = null;
		entry = null;
		await tick();
		if (container) upgradeDfns(container);
	});

	function upgradeDfns(container: HTMLElement) {
		for (const dfn of container.querySelectorAll<HTMLElement>('dfn[data-rule]')) {
			dfn.setAttribute('role', 'button');
			dfn.setAttribute('tabindex', '0');
			dfn.setAttribute('aria-haspopup', 'dialog');
		}
	}

	function openFrom(dfn: HTMLElement) {
		entry = glossary.find((g) => g.ruleId === dfn.getAttribute('data-rule')) ?? null;
		anchor = dfn;
		open = entry !== null;
	}

	$effect(() => {
		if (!container) return;
		upgradeDfns(container);
		const findDfn = (e: Event) => {
			const dfn = (e.target as HTMLElement).closest('dfn[data-rule]');
			return dfn && container.contains(dfn) ? (dfn as HTMLElement) : null;
		};
		const onClick = (e: MouseEvent) => {
			const dfn = findDfn(e);
			if (!dfn) return;
			e.preventDefault();
			openFrom(dfn);
		};
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			const dfn = findDfn(e);
			if (!dfn) return;
			e.preventDefault();
			openFrom(dfn);
		};
		container.addEventListener('click', onClick);
		container.addEventListener('keydown', onKeydown);
		return () => {
			container.removeEventListener('click', onClick);
			container.removeEventListener('keydown', onKeydown);
		};
	});
</script>

<Popover.Root bind:open>
	<Popover.Portal>
		<Popover.Content
			customAnchor={anchor}
			sideOffset={6}
			onCloseAutoFocus={(e) => {
				e.preventDefault();
				anchor?.focus();
			}}
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
