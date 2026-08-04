<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'filled',
		href,
		type = 'button',
		disabled = false,
		onclick,
		class: extraClass,
		children
	}: {
		variant?: 'filled' | 'outline';
		href?: string;
		type?: 'button' | 'submit';
		disabled?: boolean;
		onclick?: () => void;
		class?: string;
		children: Snippet;
	} = $props();

	// disabled:opacity-40 is appended to every <button> regardless of variant or
	// whether the call site ever passes `disabled`. The variant only emits
	// styles when the element is actually disabled, so at the sites that never
	// set `disabled` it stays inert and the rendered look is unchanged.
	const base = $derived(
		variant === 'filled'
			? 'rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110'
			: 'rounded-full border border-navy/30 px-6 py-2.5 text-sm font-semibold tracking-wider text-navy uppercase hover:border-navy'
	);
</script>

{#if href}
	<a {href} {onclick} class={[extraClass, base].filter(Boolean).join(' ')}>
		{@render children()}
	</a>
{:else}
	<button
		{type}
		{disabled}
		{onclick}
		class={[extraClass, base, 'disabled:opacity-40'].filter(Boolean).join(' ')}
	>
		{@render children()}
	</button>
{/if}
