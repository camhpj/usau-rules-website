<script module lang="ts">
	import { createKeyedMutex } from '$lib/optimistic';

	// Module-scoped and keyed by message id, so same-message feedback clicks
	// still serialize across a row being destroyed and recreated (e.g. a
	// re-keyed #each), not just across re-renders of one instance.
	const runFeedback = createKeyedMutex();
</script>

<script lang="ts">
	import { fade } from 'svelte/transition';
	import type { ChatMessage } from '$lib/ai/payload';
	import AskAnswer from '$lib/components/AskAnswer.svelte';
	import ThumbIcon from '$lib/components/icons/ThumbIcon.svelte';
	import { safeFetch } from '$lib/fetch';

	let {
		message,
		onretry = null,
		readonly = false
	}: { message: ChatMessage; onretry?: (() => void) | null; readonly?: boolean } = $props();

	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(message.content);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard unavailable — ignore */
		}
	}

	async function setFeedback(value: 'up' | 'down') {
		// Reading `prev` must happen inside the task: a same-message feedback
		// click already queued ahead of this one may still be running (or
		// reverting), and reading it here, before this task's turn, would race it.
		await runFeedback(message.id, async () => {
			const prev = message.feedback;
			const next = prev === value ? null : value;
			message.feedback = next; // optimistic; parent's $state array is a deep proxy
			const ok = (
				await safeFetch(`/api/ai/messages/${encodeURIComponent(message.id)}/feedback`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ feedback: next })
				})
			).ok;
			if (!ok) message.feedback = prev;
		});
	}
</script>

{#if message.role === 'user'}
	<div class="flex justify-end">
		<p
			class="max-w-[85%] rounded-2xl bg-navy px-4 py-2.5 text-[15px] whitespace-pre-wrap text-white"
		>
			{message.content}
		</p>
	</div>
{:else if message.status === 'error'}
	<div class="flex items-center gap-3">
		<p class="text-sm text-navy/50 italic">Something went wrong</p>
		{#if onretry}
			<button
				type="button"
				onclick={onretry}
				class="text-xs font-semibold tracking-wider text-cardinal uppercase hover:underline"
			>
				Retry
			</button>
		{/if}
	</div>
{:else}
	<div>
		<AskAnswer answer={message.content} />
		{#if message.status === 'truncated'}
			<p class="mt-2 text-xs text-navy/50 italic">This answer was cut short.</p>
		{/if}
		<div class="mt-2 flex items-center gap-3">
			<button
				type="button"
				onclick={copy}
				aria-label={copied ? 'Copied' : 'Copy'}
				class="flex h-7 w-7 items-center justify-center rounded text-navy/50 hover:text-navy"
			>
				{#if copied}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="block h-4 w-4"
						aria-hidden="true"
					>
						<path d="M20 6 9 17l-5-5" />
					</svg>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="block h-4 w-4"
						aria-hidden="true"
					>
						<rect x="9" y="9" width="11" height="11" rx="2" />
						<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
					</svg>
				{/if}
			</button>
			{#if copied}
				<span
					transition:fade={{ duration: 150 }}
					aria-hidden="true"
					class="-ml-2 text-xs text-navy/50"
				>
					Copied
				</span>
			{/if}
			<button
				type="button"
				aria-label="Good answer"
				aria-pressed={message.feedback === 'up'}
				disabled={readonly}
				onclick={() => setFeedback('up')}
				class="flex h-7 w-7 items-center justify-center rounded {message.feedback === 'up'
					? 'text-cardinal'
					: readonly
						? 'cursor-default text-[#758395]'
						: 'text-[#758395] hover:text-navy'}"
			>
				<ThumbIcon direction="up" filled={message.feedback === 'up'} class="block h-4 w-4" />
			</button>
			<button
				type="button"
				aria-label="Bad answer"
				aria-pressed={message.feedback === 'down'}
				disabled={readonly}
				onclick={() => setFeedback('down')}
				class="flex h-7 w-7 items-center justify-center rounded {message.feedback === 'down'
					? 'text-cardinal'
					: readonly
						? 'cursor-default text-[#758395]'
						: 'text-[#758395] hover:text-navy'}"
			>
				<ThumbIcon direction="down" filled={message.feedback === 'down'} class="block h-4 w-4" />
			</button>
		</div>
	</div>
{/if}
