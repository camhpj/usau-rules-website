<script lang="ts">
	const EMAIL = 'contact@usaurules.com';

	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyEmail() {
		try {
			await navigator.clipboard.writeText(EMAIL);
		} catch {
			return; // clipboard unavailable — leave the address visible to copy by hand
		}
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 2000);
	}
</script>

<footer class="border-t border-white/10 py-6">
	<p class="mx-auto max-w-6xl px-4 text-center text-xs text-white/50 sm:px-6">
		Not affiliated with <a
			href="https://usaultimate.org/"
			class="underline decoration-white/30 underline-offset-2 hover:text-white/80">USA Ultimate</a
		>
		• Questions or feedback? Contact me at
		<span class="relative">
			<button
				type="button"
				onclick={copyEmail}
				title="Copy email address"
				class="cursor-pointer underline decoration-white/30 underline-offset-2 hover:text-white/80"
			>
				{EMAIL}</button
			>.
			<!-- Absolutely positioned so it never reflows the sentence. -->
			{#if copied}<span
					class="absolute top-1/2 left-full ml-1 -translate-y-1/2 font-semibold whitespace-nowrap text-white/80"
					role="status">Copied!</span
				>{/if}
		</span>
	</p>
</footer>
