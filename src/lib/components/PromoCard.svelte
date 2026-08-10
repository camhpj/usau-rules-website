<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		href,
		class: extraClass,
		children
	}: {
		href: string;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<a
	{href}
	class={[extraClass, 'group animate-fade-up relative card card-link p-3.5 sm:p-6']
		.filter(Boolean)
		.join(' ')}
>
	{@render children()}
	<span
		aria-hidden="true"
		class="absolute top-3.5 right-3.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-1 sm:top-6 sm:right-6"
		>→</span
	>
</a>
