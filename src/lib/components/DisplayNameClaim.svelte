<script lang="ts">
	let {
		suggestion,
		prefix = '',
		onSaved
	}: { suggestion: string; prefix?: string; onSaved: (displayName: string) => void } = $props();

	let editing = $state(false);
	let value = $state('');
	let busy = $state(false);
	let message = $state<string | null>(null);

	async function put(body: { displayName: string; resolveConflict?: boolean }) {
		busy = true;
		message = null;
		try {
			const res = await fetch('/api/profile/display-name', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const data = (await res.json().catch(() => null)) as {
				displayName?: string;
				suggestion?: string;
				message?: string;
			} | null;
			if (res.ok && data?.displayName) {
				onSaved(data.displayName);
				return;
			}
			if (res.status === 409) {
				editing = true;
				if (data?.suggestion) value = data.suggestion;
				message = data?.suggestion ? `taken — try “${data.suggestion}”?` : 'that name is taken';
				return;
			}
			message = data?.message ?? 'couldn’t save that name — try again';
		} catch {
			message = 'network error — try again';
		} finally {
			busy = false;
		}
	}
</script>

<span class="text-sm text-navy/70">
	{prefix}<button
		type="button"
		disabled={busy}
		onclick={() => put({ displayName: suggestion, resolveConflict: true })}
		class="font-semibold whitespace-nowrap text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal disabled:opacity-40"
		>join as “{suggestion}”</button
	>
	{#if editing}
		<span class="font-extrabold text-navy">or</span>
		<span class="inline-flex flex-wrap items-center gap-1.5">
			<input
				type="text"
				bind:value
				maxlength={30}
				placeholder="Display name"
				class="w-36 rounded-md border border-mist px-2 py-1 text-xs focus:border-navy/50 focus:outline-none"
			/>
			<button
				type="button"
				disabled={busy || value.trim().length < 2}
				onclick={() => put({ displayName: value })}
				class="rounded-full bg-cardinal px-3 py-1 text-[10px] font-semibold tracking-wider text-white uppercase hover:brightness-110 disabled:opacity-40"
				>Save</button
			>
			<button
				type="button"
				onclick={() => {
					editing = false;
					message = null;
				}}
				class="text-xs text-navy/50 underline underline-offset-2 hover:text-navy">cancel</button
			>
		</span>
	{:else}
		<!-- "or" travels with the second link so a wrap never strands it. -->
		<span class="whitespace-nowrap">
			<span class="font-extrabold text-navy">or</span>
			<button
				type="button"
				disabled={busy}
				onclick={() => (editing = true)}
				class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal disabled:opacity-40"
				>use another name</button
			>
		</span>
	{/if}
	{#if message}
		<span class="text-xs font-semibold text-cardinal" role="alert">{message}</span>
	{/if}
</span>
