<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { DropdownMenu } from 'bits-ui';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';

	let { onSearch }: { onSearch?: () => void } = $props();
	const links = [
		{ href: '/rules', label: 'Rules' },
		{ href: '/quiz', label: 'Quiz' },
		{ href: '/ask', label: 'Ask' }
	];

	type SessionUser = { name: string; email: string; image?: string | null };
	type AuthView = 'pending' | 'signedIn' | 'signedOut';
	const AUTH_HINT_KEY = 'bp-auth-hint';

	let user = $state<SessionUser | null>(null);
	let view = $state<AuthView>('pending');

	function readAuthHint(): string | null {
		try {
			return localStorage.getItem(AUTH_HINT_KEY);
		} catch {
			return null;
		}
	}

	function writeAuthHint(value: '1' | '0') {
		try {
			localStorage.setItem(AUTH_HINT_KEY, value);
		} catch {
			/* storage blocked — hint is best-effort */
		}
	}

	onMount(() => {
		// localStorage hint renders the likely final state before the session
		// resolves; onMount runs pre-paint, so the correction is never visible
		if (readAuthHint() === '0') view = 'signedOut';
		const store = authClient.useSession();
		return store.subscribe((s) => {
			if (s.isPending) return;
			user = s.data?.user ?? null;
			view = user ? 'signedIn' : 'signedOut';
			writeAuthHint(user ? '1' : '0');
		});
	});

	function signIn() {
		void authClient.signIn.social({ provider: 'google', callbackURL: location.pathname });
	}

	function signOut() {
		void authClient.signOut({
			fetchOptions: {
				onSuccess: () => goto('/')
			}
		});
	}
</script>

<header class="sticky top-0 z-40 border-b border-white/10 bg-navy-deep/90 backdrop-blur">
	<nav
		class="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-2 px-4 py-1.5 sm:gap-x-4 sm:px-6 sm:py-0"
	>
		<a href="/" class="display text-base whitespace-nowrap text-white sm:text-2xl">
			Best <span class="text-cardinal">Perspective</span>
		</a>
		<div class="ml-auto flex items-center gap-2 sm:gap-6">
			<button
				type="button"
				onclick={onSearch}
				aria-label="Search"
				class="flex items-center gap-2 rounded-full border border-transparent px-1 py-1.5 text-xs font-semibold tracking-wider text-white/70 uppercase hover:border-white/60 hover:text-white sm:border-white/25 sm:px-3.5"
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
					class="text-[10px] font-semibold tracking-[0.05em] whitespace-nowrap uppercase transition-colors sm:text-xs sm:tracking-[0.18em]
						{active ? 'text-cardinal' : 'text-white/70 hover:text-white'}"
				>
					{link.label}
				</a>
			{/each}
			{#snippet signInButton(extraClass: string)}
				<button
					type="button"
					onclick={signIn}
					aria-label="Sign in"
					class={[
						extraClass,
						'rounded-full border border-white/25 p-1.5 text-[11px] font-semibold tracking-wider whitespace-nowrap text-white/80 uppercase hover:border-white/60 hover:text-white sm:px-4 sm:py-1.5 sm:text-xs'
					]
						.filter(Boolean)
						.join(' ')}
				>
					<svg
						aria-hidden="true"
						class="h-4 w-4 shrink-0 sm:hidden"
						viewBox="0 -960 960 960"
						fill="currentColor"
						><path
							d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z"
						/></svg
					>
					<span class="hidden sm:inline">Sign in</span>
				</button>
			{/snippet}
			{#if view === 'pending'}
				<div
					aria-hidden="true"
					class="auth-pending-placeholder h-8 w-8 rounded-full border border-white/15"
				></div>
				{@render signInButton('auth-signin-optimistic')}
			{:else if view === 'signedIn' && user}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						aria-label="Account menu"
						class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/25 text-xs font-bold text-white uppercase hover:border-white/60"
					>
						{#if user.image}
							<img
								src={user.image}
								alt=""
								referrerpolicy="no-referrer"
								class="h-full w-full object-cover"
							/>
						{:else}
							{user.name?.[0] ?? '?'}
						{/if}
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							sideOffset={8}
							align="end"
							class="z-50 min-w-44 rounded-xl border border-mist bg-white p-1.5 text-sm text-navy shadow-xl"
						>
							<DropdownMenu.Item>
								{#snippet child({ props })}
									<a
										{...props}
										href="/me"
										class="block w-full rounded-lg px-3 py-2 text-left font-semibold hover:bg-mist"
									>
										Dashboard
									</a>
								{/snippet}
							</DropdownMenu.Item>
							<DropdownMenu.Item
								onSelect={signOut}
								class="w-full cursor-pointer rounded-lg px-3 py-2 text-left font-semibold hover:bg-mist"
							>
								Sign out
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			{:else}
				{@render signInButton('')}
			{/if}
		</div>
	</nav>
</header>
