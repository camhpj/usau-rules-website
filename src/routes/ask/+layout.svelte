<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { conversations } from '$lib/ask/conversations.svelte';
	import { authClient } from '$lib/auth-client';
	import ConversationSidebar from '$lib/components/chat/ConversationSidebar.svelte';

	let { children }: { children: Snippet } = $props();

	let user = $state<{ name: string } | null>(null);
	let sessionReady = $state(false);
	let drawerOpen = $state(false);
	let listLoaded = false;

	const activeId = $derived(
		page.url.pathname.startsWith('/ask/')
			? decodeURIComponent(page.url.pathname.slice('/ask/'.length))
			: null
	);

	onMount(() => {
		const store = authClient.useSession();
		return store.subscribe((s) => {
			user = s.data?.user ?? null;
			if (!s.isPending) sessionReady = true;
		});
	});

	$effect(() => {
		if (user && !listLoaded) {
			listLoaded = true;
			void conversations.load();
		}
	});

	// Close the mobile drawer on any navigation.
	$effect(() => {
		void page.url.pathname;
		drawerOpen = false;
	});

	function signIn() {
		void authClient.signIn.social({ provider: 'google', callbackURL: '/ask' });
	}
</script>

<svelte:head><title>Ask · Best Perspective</title></svelte:head>

{#if !sessionReady}
	<div
		class="mx-auto mt-16 h-40 max-w-3xl animate-pulse rounded-xl bg-white/10"
		aria-hidden="true"
	></div>
{:else if !user}
	<section class="animate-fade-up mx-auto max-w-3xl px-4 py-10 sm:px-6">
		<div class="card mt-8 p-8 text-center">
			<h2 class="display text-2xl">Sign in to use the ask feature</h2>
			<button
				type="button"
				onclick={signIn}
				class="mt-6 rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
			>
				Sign in with Google
			</button>
		</div>
	</section>
{:else}
	<div class="animate-fade-up mx-auto max-w-6xl px-4 py-6 sm:px-6">
		<div
			class="relative flex h-[calc(100dvh-11rem)] w-full overflow-hidden rounded-xl border border-mist bg-white shadow-sm"
		>
			<aside class="hidden w-64 shrink-0 overflow-hidden border-r border-mist bg-mist lg:block">
				<ConversationSidebar {activeId} />
			</aside>
			{#if drawerOpen}
				<div class="absolute inset-0 z-10 flex flex-col bg-mist lg:hidden">
					<div class="flex shrink-0 justify-end border-b border-navy/10 p-2">
						<button
							type="button"
							onclick={() => (drawerOpen = false)}
							class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold tracking-wider text-navy/60 uppercase hover:text-navy"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								class="h-3.5 w-3.5 shrink-0"
								aria-hidden="true"
							>
								<path d="M6 6l12 12M18 6L6 18" />
							</svg>
							<span>Close</span>
						</button>
					</div>
					<div class="min-h-0 flex-1 overflow-hidden">
						<ConversationSidebar {activeId} />
					</div>
				</div>
			{/if}
			<main class="flex min-w-0 flex-1 flex-col bg-white py-4 pl-4 sm:pl-6">
				<!--
					No right padding here: the messages `<section>` and the input area below own
					their own right inset (`pr-*`) so the scrollbar renders in a clear gutter at the
					true panel edge instead of overlapping message content that would otherwise sit
					flush against it.
				-->
				<button
					type="button"
					onclick={() => (drawerOpen = true)}
					class="mb-2 inline-flex items-center gap-1.5 self-start text-xs font-semibold tracking-wider text-navy/60 uppercase hover:text-navy lg:hidden"
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
						<path d="M4 7h16M4 12h16M4 17h16" />
					</svg>
					<span>Chats</span>
				</button>
				{@render children()}
			</main>
		</div>
	</div>
{/if}
