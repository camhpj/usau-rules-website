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
			class="flex h-[calc(100dvh-11rem)] w-full overflow-hidden rounded-xl border border-mist bg-white shadow-sm"
		>
			<aside class="hidden w-64 shrink-0 overflow-hidden border-r border-mist bg-mist lg:block">
				<ConversationSidebar {activeId} />
			</aside>
			{#if drawerOpen}
				<div class="fixed inset-0 z-40 lg:hidden">
					<button
						type="button"
						aria-label="Close conversation list"
						onclick={() => (drawerOpen = false)}
						class="absolute inset-0 bg-navy/40"
					></button>
					<aside class="absolute inset-y-0 left-0 z-50 w-72 overflow-hidden bg-mist shadow-xl">
						<ConversationSidebar {activeId} />
					</aside>
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
					class="mb-2 self-start rounded-lg border border-mist px-3 py-1.5 text-xs font-semibold tracking-wider text-navy/60 uppercase lg:hidden"
				>
					☰ Chats
				</button>
				{@render children()}
			</main>
		</div>
	</div>
{/if}
