<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { authClient } from '$lib/auth-client';
	import Button from '$lib/components/Button.svelte';

	let {
		callbackURL,
		heading,
		pendingClass = '',
		signedOutWrapperClass,
		onSignedIn,
		children
	}: {
		callbackURL: string;
		heading: string;
		// Extra classes for the pending skeleton, since the two call sites sit in
		// different ambient layout (one supplies its own mx-auto/max-w, one doesn't).
		pendingClass?: string;
		// When set, wraps the signed-out card in a <section class={signedOutWrapperClass}>.
		// Omit it to render the card directly, for a site that's already inside one.
		signedOutWrapperClass?: string;
		// Fires once, the first time the session resolves to a signed-in user.
		onSignedIn?: () => void;
		children: Snippet;
	} = $props();

	let user = $state<{ name: string } | null>(null);
	let sessionReady = $state(false);
	let signedInNotified = false;

	onMount(() => {
		const store = authClient.useSession();
		return store.subscribe((s) => {
			user = s.data?.user ?? null;
			if (!s.isPending) sessionReady = true;
		});
	});

	$effect(() => {
		if (user && !signedInNotified) {
			signedInNotified = true;
			onSignedIn?.();
		}
	});

	function signIn() {
		void authClient.signIn.social({ provider: 'google', callbackURL });
	}
</script>

{#snippet gate()}
	<div class="card mt-8 p-8 text-center">
		<h2 class="display text-2xl">{heading}</h2>
		<Button onclick={signIn} class="mt-6">Sign in with Google</Button>
	</div>
{/snippet}

{#if !sessionReady}
	<div
		class={[pendingClass, 'h-40 animate-pulse rounded-xl bg-white/10'].filter(Boolean).join(' ')}
		aria-hidden="true"
	></div>
{:else if !user}
	{#if signedOutWrapperClass}
		<section class={signedOutWrapperClass}>
			{@render gate()}
		</section>
	{:else}
		{@render gate()}
	{/if}
{:else}
	{@render children()}
{/if}
