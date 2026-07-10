<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import SearchDialog from '$lib/components/SearchDialog.svelte';
	let { children } = $props();
	let searchOpen = $state(false);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

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
