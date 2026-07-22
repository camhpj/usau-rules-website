<script lang="ts">
	import { fade } from 'svelte/transition';
	import type { ChatMessage } from '$lib/ai/payload';
	import AskAnswer from '$lib/components/AskAnswer.svelte';

	let { message, onretry = null }: { message: ChatMessage; onretry?: (() => void) | null } =
		$props();

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
		const prev = message.feedback;
		const next = prev === value ? null : value;
		message.feedback = next; // optimistic; parent's $state array is a deep proxy
		try {
			const res = await fetch(`/api/ai/messages/${encodeURIComponent(message.id)}/feedback`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ feedback: next })
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			message.feedback = prev;
		}
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
				onclick={() => setFeedback('up')}
				class="flex h-7 w-7 items-center justify-center rounded {message.feedback === 'up'
					? 'text-cardinal'
					: 'text-[#758395] hover:text-navy'}"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill={message.feedback === 'up' ? 'currentColor' : 'none'}
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="block h-4 w-4"
					aria-hidden="true"
				>
					<path
						d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
					/>
					<path d="M7 10v12" />
				</svg>
			</button>
			<button
				type="button"
				aria-label="Bad answer"
				aria-pressed={message.feedback === 'down'}
				onclick={() => setFeedback('down')}
				class="flex h-7 w-7 items-center justify-center rounded {message.feedback === 'down'
					? 'text-cardinal'
					: 'text-[#758395] hover:text-navy'}"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill={message.feedback === 'down' ? 'currentColor' : 'none'}
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="block h-4 w-4 rotate-180"
					aria-hidden="true"
				>
					<path
						d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
					/>
					<path d="M7 10v12" />
				</svg>
			</button>
		</div>
	</div>
{/if}
