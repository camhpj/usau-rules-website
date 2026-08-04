<script lang="ts">
	import Button from '$lib/components/Button.svelte';

	let { heading, onclick }: { heading: string; onclick: () => void } = $props();
</script>

<div class="card mt-8 p-8 text-center">
	<h2 class="display text-2xl">{heading}</h2>
	<Button {onclick} class="mt-6">Sign in with Google</Button>
</div>
