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
			class="flex h-[calc(100dvh-11rem)] w-full flex-col overflow-hidden rounded-xl border border-mist bg-white shadow-sm"
		>
			<!--
				Shared mobile header band: one physical row for both states, so the left
				control (Chats ⇄ Close) and the New-chat pill hold identical screen
				positions whether the conversation menu is open or closed.
			-->
			<div
				class="flex shrink-0 items-center justify-between border-b border-navy/10 py-2 pr-4 pl-2 sm:pr-6 lg:hidden"
			>
				<button
					type="button"
					onclick={() => (drawerOpen = !drawerOpen)}
					class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold tracking-wider text-navy/60 uppercase hover:text-navy"
				>
					{#if drawerOpen}
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
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
						<span>Close</span>
					{:else}
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
					{/if}
				</button>
				<!-- onclick closes explicitly: navigating /ask → /ask is a same-URL no-op,
				     so the close-on-navigation effect alone wouldn't dismiss the drawer. -->
				<a
					href="/ask"
					onclick={() => (drawerOpen = false)}
					class="inline-flex items-center gap-1.5 rounded-full bg-cardinal px-3 py-1.5 text-xs font-semibold tracking-wider text-white uppercase hover:brightness-110"
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
			</div>
			<div class="relative flex min-h-0 flex-1">
				<aside class="hidden w-64 shrink-0 overflow-hidden border-r border-mist bg-mist lg:block">
					<ConversationSidebar {activeId} />
				</aside>
				{#if drawerOpen}
					<!-- Covers only the area below the shared header band, so the band's
					     controls stay visible and fixed while the menu is open. -->
					<div class="absolute inset-0 z-10 overflow-hidden bg-mist lg:hidden">
						<ConversationSidebar {activeId} />
					</div>
				{/if}
				<main class="flex min-w-0 flex-1 flex-col bg-white py-4 pl-4 sm:pl-6">
					<!--
						No right padding here: the messages `<section>` and the input area below own
						their own right inset (`pr-*`) so the scrollbar renders in a clear gutter at the
						true panel edge instead of overlapping message content that would otherwise sit
						flush against it.
					-->
					{@render children()}
				</main>
			</div>
		</div>
	</div>
{/if}
