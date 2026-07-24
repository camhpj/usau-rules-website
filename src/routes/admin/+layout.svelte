<script lang="ts">
	import { page } from '$app/state';
	let { children } = $props();
	const tabs = [
		{ href: '/admin', label: 'Dashboard' },
		{ href: '/admin/ai', label: 'AI review' },
		{ href: '/admin/export', label: 'Export' }
	];
	const active = (href: string) =>
		href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);
</script>

<div class="mx-auto max-w-5xl px-4 py-6">
	<header class="mb-6">
		<h1 class="text-xl font-semibold text-navy">Admin</h1>
		<nav class="mt-3 flex gap-4 border-b border-navy/10 text-sm">
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					class="cursor-pointer pb-2 {active(tab.href)
						? 'border-b-2 border-cardinal font-semibold text-cardinal'
						: 'text-navy/70 hover:text-navy'}">{tab.label}</a
				>
			{/each}
		</nav>
	</header>
	{@render children()}
</div>
