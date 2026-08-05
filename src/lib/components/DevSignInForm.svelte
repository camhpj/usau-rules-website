<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import Button from '$lib/components/Button.svelte';

	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let message = $state<string | null>(null);

	// Deriving a name from the email keeps this to the two fields the task asks
	// for; better-auth's sign-up requires a name, but nothing here shows it back.
	async function submit(mode: 'sign-in' | 'sign-up') {
		busy = true;
		message = null;
		const { error } =
			mode === 'sign-up'
				? await authClient.signUp.email({ email, password, name: email })
				: await authClient.signIn.email({ email, password });
		busy = false;
		if (error) message = error.message ?? 'Something went wrong — try again.';
		// On success the shared session store updates and every subscriber
		// (Nav, this page's sign-in gate) re-renders into the signed-in state —
		// same as the redirect back from Google, no reload needed here.
	}
</script>

<div class="card mt-4 border-2 border-dashed border-cardinal/60 p-6 text-left">
	<p class="eyebrow text-cardinal">Dev only · email + password</p>
	<p class="mt-1 text-xs text-navy/60">
		For testing on a phone over your LAN, where Google rejects a private-IP redirect. Never
		available in production.
	</p>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void submit('sign-in');
		}}
		class="mt-4 flex flex-col gap-3"
	>
		<label class="flex flex-col gap-1 text-sm font-semibold text-navy/70">
			Email
			<input
				type="email"
				bind:value={email}
				required
				autocomplete="email"
				class="min-h-11 w-full rounded-md border border-mist px-3 text-base text-navy focus:border-navy/50 focus:outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm font-semibold text-navy/70">
			Password
			<input
				type="password"
				bind:value={password}
				required
				minlength={8}
				autocomplete="current-password"
				class="min-h-11 w-full rounded-md border border-mist px-3 text-base text-navy focus:border-navy/50 focus:outline-none"
			/>
		</label>
		{#if message}
			<p class="text-sm font-semibold text-cardinal" role="alert">{message}</p>
		{/if}
		<div class="flex gap-2">
			<Button type="submit" class="min-h-11 flex-1" disabled={busy}>Sign in</Button>
			<Button
				type="button"
				variant="outline"
				class="min-h-11 flex-1"
				disabled={busy}
				onclick={() => submit('sign-up')}
			>
				Sign up
			</Button>
		</div>
	</form>
</div>
