<script lang="ts">
	import { goto } from '$app/navigation';
	import { conversations } from '$lib/ask/conversations.svelte';
	import { timeAgo } from '$lib/time';

	let { activeId }: { activeId: string | null } = $props();

	async function remove(id: string) {
		const wasActive = id === activeId;
		const ok = await conversations.remove(id);
		if (ok && wasActive) void goto('/ask');
	}
</script>

<nav class="flex h-full flex-col" aria-label="Conversations">
	<!-- Desktop only: the mobile drawer carries its own compact New-chat pill in its header row. -->
	<a
		href="/ask"
		class="mx-6 mt-5 hidden items-center justify-center gap-1.5 rounded-full bg-cardinal px-4 py-2.5 text-xs font-semibold tracking-wider text-white uppercase hover:brightness-110 lg:inline-flex"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
			class="h-4 w-4 shrink-0"
			aria-hidden="true"
		>
			<path d="M12 5v14M5 12h14" />
		</svg>
		<span>New chat</span>
	</a>
	{#if conversations.errorMessage}
		<p class="mx-3 mt-3 text-xs text-navy/50" role="alert">{conversations.errorMessage}</p>
	{/if}
	{#if conversations.loading}
		<div class="mx-3 mt-3 h-24 animate-pulse rounded-xl bg-white/10" aria-hidden="true"></div>
	{:else if conversations.list.length === 0 && !conversations.errorMessage}
		<div class="flex flex-1 items-center justify-center px-3">
			<p class="text-xs text-navy/40">No chats yet</p>
		</div>
	{:else}
		<ul class="mt-3 flex-1 space-y-1.5 overflow-y-auto px-3">
			{#each conversations.list as convo (convo.id)}
				<li class="group relative">
					{#if convo.pending}
						<div class="block rounded-lg px-3 py-2 text-sm text-navy/70">
							<span class="block truncate">{convo.title}</span>
							<span class="text-xs text-navy/40">Sending…</span>
						</div>
					{:else}
						<a
							href="/ask/{convo.id}"
							aria-current={convo.id === activeId ? 'page' : undefined}
							class="block rounded-lg px-3 py-2 text-sm text-navy hover:bg-navy/5 {convo.id ===
							activeId
								? 'bg-navy/10 font-semibold'
								: ''}"
						>
							<span class="block truncate">{convo.title}</span>
							<span class="text-xs text-navy/40">{timeAgo(convo.updatedAt)}</span>
						</a>
						<!-- On hover, fades in left→right to wipe the title/preview and give the
						     trash icon a backdrop; gradient end matches the item's own bg tint. -->
						<div
							aria-hidden="true"
							class="pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100"
							style="background-image: linear-gradient(to right, transparent 65%, {convo.id ===
							activeId
								? 'color-mix(in srgb, var(--color-navy) 10%, var(--color-mist))'
								: 'color-mix(in srgb, var(--color-navy) 5%, var(--color-mist))'} 85%)"
						></div>
						<button
							type="button"
							aria-label="Delete conversation: {convo.title}"
							onclick={() => remove(convo.id)}
							class="group/del absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-navy opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus:opacity-100 hover:text-cardinal"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								class="h-4 w-4 opacity-40 transition-opacity group-hover/del:opacity-100"
								aria-hidden="true"
							>
								<path d="M3 6h18" />
								<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
								<path d="M10 11v6M14 11v6" />
							</svg>
						</button>
					{/if}
				</li>
			{/each}
		</ul>
		{#if conversations.hasMore}
			<button
				type="button"
				disabled={conversations.loadingMore}
				onclick={() => conversations.loadMore()}
				class="mx-3 my-3 text-xs font-semibold tracking-wider text-navy/50 uppercase hover:text-navy disabled:opacity-40"
			>
				{conversations.loadingMore ? 'Loading…' : 'Load more'}
			</button>
		{/if}
	{/if}
</nav>
