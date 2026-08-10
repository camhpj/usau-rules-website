<script lang="ts">
	import { page } from '$app/state';
	import ThumbIcon from '$lib/components/icons/ThumbIcon.svelte';
	let { children } = $props();
	const tabs = [
		{ href: '/admin', label: 'Dashboard' },
		{ href: '/admin/ai', label: 'AI review' },
		{ href: '/admin/export', label: 'Export' }
	];
	const active = (href: string) =>
		href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);

	const RANGES = [7, 14, 30, 90];
	const path = $derived(page.url.pathname);
	const isDashboard = $derived(path === '/admin');
	const isAiList = $derived(path === '/admin/ai');
	const isAiDetail = $derived(/^\/admin\/ai\/[^/]+$/.test(path));
	const downOnly = $derived(page.url.searchParams.get('down') === '1');
	const range = $derived.by(() => {
		const raw = Number(page.url.searchParams.get('range'));
		return RANGES.includes(raw) ? raw : 14;
	});

	const pill =
		'inline-flex items-center justify-center rounded-full px-2.5 py-1 text-xs font-medium pointer-coarse:min-h-11 pointer-coarse:min-w-11';
	const pillOn = 'bg-cardinal text-white';
	const pillOff = 'bg-white/10 text-white/70 hover:bg-white/20';
</script>

<div class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
	<header class="mb-6">
		<h1 class="text-xl font-semibold text-white">Admin</h1>
		<nav class="mt-3 flex flex-wrap items-center gap-x-4 border-b border-white/15 text-sm">
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					class="inline-flex min-h-11 cursor-pointer items-center justify-center pb-2 pointer-coarse:min-w-11 {active(
						tab.href
					)
						? 'border-b-2 border-cardinal font-semibold text-cardinal'
						: 'text-white/70 hover:text-white'}">{tab.label}</a
				>
			{/each}
			<div class="ml-auto flex w-full items-center justify-end gap-2 pb-2 sm:w-auto">
				{#if isDashboard}
					{#each RANGES as r (r)}
						<a href="/admin?range={r}" class="{pill} {range === r ? pillOn : pillOff}">{r}d</a>
					{/each}
				{:else if isAiDetail}
					<a
						href="/admin/ai"
						class="inline-flex min-h-11 items-center text-xs font-medium text-white/70 hover:text-white"
						>← Conversations</a
					>
				{:else if isAiList}
					<a href="/admin/ai" class="{pill} {!downOnly ? pillOn : pillOff}">All</a>
					<a
						href="/admin/ai?down=1"
						class="flex items-center gap-1 {pill} {downOnly ? pillOn : pillOff}"
						><ThumbIcon direction="down" class="block h-3.5 w-3.5" /> only</a
					>
				{/if}
			</div>
		</nav>
	</header>
	{@render children()}
</div>
