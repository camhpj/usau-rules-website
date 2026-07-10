<script lang="ts">
	import { page } from '$app/state';
	let { onSearch }: { onSearch?: () => void } = $props();
	const links = [
		{ href: '/rules', label: 'Rules' },
		{ href: '/quiz', label: 'Quiz' },
		{ href: '/ask', label: 'Ask' }
	];
</script>

<header class="sticky top-0 z-40 border-b border-white/10 bg-navy-deep/90 backdrop-blur">
	<nav
		class="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-4 px-4 py-1.5 sm:px-6 sm:py-0"
	>
		<a href="/" class="display text-lg whitespace-nowrap text-white sm:text-2xl">
			Best <span class="text-cardinal">Perspective</span>
		</a>
		<div class="ml-auto flex items-center gap-1.5 sm:gap-6">
			<button
				type="button"
				onclick={onSearch}
				aria-label="Search"
				class="flex items-center gap-2 rounded-full border border-white/25 px-2 py-1.5 text-xs font-semibold tracking-wider text-white/70 uppercase hover:border-white/60 hover:text-white sm:px-3.5"
			>
				<svg
					aria-hidden="true"
					class="h-4 w-4 shrink-0"
					viewBox="0 -960 960 960"
					fill="currentColor"
					><path
						d="M378.09-314.5q-111.16 0-188.33-77.17-77.17-77.18-77.17-188.33t77.17-188.33q77.17-77.17 188.33-77.17 111.15 0 188.32 77.17 77.18 77.18 77.18 188.33 0 44.48-13.52 83.12-13.53 38.64-36.57 68.16l222.09 222.33q12.67 12.91 12.67 31.94 0 19.04-12.91 31.71-12.68 12.67-31.83 12.67t-31.82-12.67L529.85-364.59q-29.76 23.05-68.64 36.57-38.88 13.52-83.12 13.52Zm0-91q72.84 0 123.67-50.83 50.83-50.82 50.83-123.67t-50.83-123.67q-50.83-50.83-123.67-50.83-72.85 0-123.68 50.83-50.82 50.82-50.82 123.67t50.82 123.67q50.83 50.83 123.68 50.83Z"
					/></svg
				>
				<span class="hidden sm:inline">Search</span>
				<kbd
					class="hidden rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[0.65rem] font-normal normal-case tracking-normal text-white/50 sm:inline"
					>⌘K</kbd
				>
			</button>
			{#each links as link (link.href)}
				{@const active =
					page.url.pathname === link.href || page.url.pathname.startsWith(link.href + '/')}
				<a
					href={link.href}
					aria-current={active ? 'page' : undefined}
					class="px-0.5 text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap uppercase transition-colors sm:px-0 sm:text-xs sm:tracking-[0.18em]
						{active ? 'text-cardinal' : 'text-white/70 hover:text-white'}"
				>
					{link.label}
				</a>
			{/each}
			<button
				type="button"
				class="rounded-full border border-white/25 px-2 py-1.5 text-[11px] font-semibold tracking-wider whitespace-nowrap text-white/80 uppercase hover:border-white/60 hover:text-white sm:px-4 sm:text-xs"
				title="Sign-in arrives in a later phase"
			>
				Sign in
			</button>
		</div>
	</nav>
</header>
