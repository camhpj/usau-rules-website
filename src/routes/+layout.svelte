<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import SearchDialog from '$lib/components/SearchDialog.svelte';
	import { authClient } from '$lib/auth-client';
	import { bookmarks } from '$lib/bookmarks.svelte';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { flushOutbox, hydrateFromServer } from '$lib/quiz/sync';
	let { children } = $props();
	let searchOpen = $state(false);

	onMount(() => {
		let wasSignedIn = false;
		const store = authClient.useSession();
		return store.subscribe(({ data }) => {
			const signedIn = Boolean(data);
			if (signedIn && !wasSignedIn) {
				void flushOutbox(); // upload anything played before/while signed out
				void hydrateFromServer(DEFAULT_RULESET_ID); // seed a fresh device from the account
				void bookmarks.load();
			}
			if (!signedIn && wasSignedIn) bookmarks.reset();
			wasSignedIn = signedIn;
		});
	});
</script>

<svelte:head><link rel="icon" href="/icons/frisbee-favicon.svg" type="image/svg+xml" /></svelte:head
>

<svelte:window
	onkeydown={(e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			searchOpen = true;
		}
	}}
/>

<div class="field-lines flex min-h-screen flex-col bg-navy-deep">
	<Nav onSearch={() => (searchOpen = true)} />
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer />
</div>

<SearchDialog bind:open={searchOpen} />
