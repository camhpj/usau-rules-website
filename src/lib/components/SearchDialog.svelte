<script lang="ts">
	import { Dialog } from 'bits-ui';
	import MiniSearch, { type Options, type SearchResult } from 'minisearch';
	import { goto } from '$app/navigation';
	import { SEARCH_OPTIONS } from '$lib/search/options';

	interface SearchDoc {
		id: string;
		label: string;
		text: string;
		sectionSlug: string;
		sectionTitle: string;
	}

	/** A search hit: MiniSearch's generic result shape plus our stored fields. */
	type Hit = SearchResult & SearchDoc;

	// SEARCH_OPTIONS is `as const` (readonly arrays); MiniSearch's Options wants
	// mutable string[], so spread into fresh arrays rather than casting away safety.
	const MINISEARCH_OPTIONS: Options<SearchDoc> = {
		fields: [...SEARCH_OPTIONS.fields],
		storeFields: [...SEARCH_OPTIONS.storeFields]
	};

	const RULESET = 'usau-official-2026-27';
	let { open = $bindable(false) }: { open?: boolean } = $props();
	let query = $state('');
	let selected = $state(0);
	let mini = $state<MiniSearch<SearchDoc> | null>(null);
	let loadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');

	$effect(() => {
		if (open && loadState === 'idle') {
			loadState = 'loading';
			fetch(`/search/${RULESET}.json`)
				.then((r) => {
					if (!r.ok) throw new Error(`search index fetch failed: ${r.status}`);
					return r.text();
				})
				.then((json) => {
					mini = MiniSearch.loadJSON(json, MINISEARCH_OPTIONS);
					loadState = 'ready';
				})
				.catch(() => (loadState = 'error'));
		}
		// Closing the dialog after a failed load resets to idle so reopening retries.
		if (!open && loadState === 'error') loadState = 'idle';
	});

	const results = $derived(
		mini && query.length > 1
			? (mini
					.search(query, { prefix: true, fuzzy: 0.2, boost: { label: 3 } })
					.slice(0, 12) as Hit[])
			: []
	);
	$effect(() => {
		query;
		selected = 0;
	});

	function go(hit: Hit) {
		open = false;
		query = '';
		goto(`/rules/${RULESET}/${hit.sectionSlug}#${encodeURIComponent(hit.id)}`);
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(selected + 1, results.length - 1);
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		}
		if (e.key === 'Enter' && results[selected]) go(results[selected]);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-navy-deep/70 backdrop-blur-sm" />
		<Dialog.Content
			class="fixed top-24 left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl bg-white shadow-2xl"
		>
			<Dialog.Title class="sr-only">Search the rules</Dialog.Title>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={query}
				onkeydown={onKeydown}
				autofocus
				placeholder="Search the rules… (e.g. stall count, travel)"
				class="w-full border-b border-mist px-5 py-4 text-navy outline-none placeholder:text-navy/40"
			/>
			<ul class="max-h-96 overflow-y-auto p-2">
				{#each results as hit, i (hit.id)}
					<li>
						<button
							class="w-full rounded-lg px-3 py-2.5 text-left {i === selected
								? 'bg-mist'
								: 'hover:bg-mist/60'}"
							onmouseenter={() => (selected = i)}
							onclick={() => go(hit)}
						>
							<span class="font-mono text-xs font-semibold text-cardinal">{hit.label}</span>
							<span class="ml-2 text-xs text-navy/50 uppercase">{hit.sectionTitle}</span>
							<p class="mt-0.5 line-clamp-2 text-sm text-navy">{hit.text}</p>
						</button>
					</li>
				{:else}
					{#if loadState === 'error'}
						<li class="rounded-lg bg-mist/60 px-3 py-6 text-center text-sm text-navy/50">
							Search index failed to load — try again.
						</li>
					{:else if query.length > 1 && loadState === 'loading'}
						<li class="px-3 py-6 text-center text-sm text-navy/50">Loading index…</li>
					{:else if query.length > 1 && mini}
						<li class="px-3 py-6 text-center text-sm text-navy/50">No rules match “{query}”.</li>
					{/if}
				{/each}
			</ul>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
