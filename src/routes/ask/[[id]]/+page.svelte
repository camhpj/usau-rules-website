<script lang="ts">
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { CHAT_MAX_MESSAGE_CHARS } from '$lib/ai/payload';
	import { latestThoughtHeadline } from '$lib/ai/thoughts';
	import { AskPageState } from '$lib/ask/ask-page.svelte';
	import { chatStream } from '$lib/ask/chat-stream.svelte';
	import AskAnswer from '$lib/components/AskAnswer.svelte';
	import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';

	let scrollEl = $state<HTMLElement | null>(null);

	function scrollToEnd() {
		requestAnimationFrame(() => scrollEl?.scrollTo({ top: scrollEl.scrollHeight }));
	}

	// Seeded from the URL directly (not via afterNavigate — see AskPageState's constructor)
	// so a hard navigation straight to /ask/<id> starts with the right id.
	// Not named `state`: that name collides with the `$state` rune above and silently
	// turns every `$state(...)` in this file into a store auto-subscription instead.
	const ask = new AskPageState(page.params.id ?? null, {
		scrollToEnd,
		adoptUrl: (id) => replaceState(`/ask/${id}`, {})
	});

	// Covers every navigation that happens once this component is mounted — the
	// hard-navigation entry case above is the one gap, handled by the constructor.
	afterNavigate((nav) => {
		ask.handleNavigate(nav.to?.params?.id ?? null);
	});

	// Reactively re-checked whenever chatStream's jobs or this view's own id change —
	// see AskPageState.checkUrlAdoption for what it does and why.
	$effect(() => {
		ask.checkUrlAdoption();
	});

	// Reactively re-checked whenever chatStream's completed map, this view's id, or its
	// load state change — see AskPageState.consumeCompletedIfReady.
	$effect(() => {
		ask.consumeCompletedIfReady();
	});

	const thoughtHeadline = $derived(
		ask.activeJob ? latestThoughtHeadline(ask.activeJob.thoughts) : null
	);

	function submitMessage(event: SubmitEvent) {
		event.preventDefault();
		void ask.send();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		// Cmd/Ctrl+Enter inserts a newline; Shift+Enter keeps its native newline; bare Enter sends.
		if (event.metaKey || event.ctrlKey) {
			event.preventDefault();
			const el = event.currentTarget as HTMLTextAreaElement;
			el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
			ask.input = el.value;
			return;
		}
		if (event.shiftKey) return;
		event.preventDefault();
		void ask.send();
	}
</script>

{#if ask.notFound}
	<div class="p-8 text-center">
		<h2 class="display text-xl text-navy">Conversation not found</h2>
		<a href="/ask" class="mt-4 inline-block text-sm font-semibold text-cardinal hover:underline">
			Start a new chat
		</a>
	</div>
{:else}
	<section
		bind:this={scrollEl}
		style="scrollbar-gutter: stable;"
		class="flex-1 overflow-y-auto pr-4 pb-4 sm:pr-6 {ask.messages.length === 0 &&
		!ask.activeJob &&
		!ask.loadingConvo
			? 'flex items-center justify-center'
			: 'space-y-5'}"
		aria-label="Messages"
	>
		{#if ask.loadingConvo}
			<div class="space-y-3" aria-hidden="true">
				<div class="flex justify-end">
					<div class="h-8 w-36 animate-pulse rounded-2xl bg-navy/15"></div>
				</div>
				<div class="h-4 w-4/5 animate-pulse rounded bg-navy/10"></div>
				<div class="h-4 w-3/5 animate-pulse rounded bg-navy/10"></div>
			</div>
		{:else if ask.messages.length === 0 && !ask.activeJob}
			<div class="text-center">
				<p class="text-sm text-navy/60">Ask anything about the rules</p>
				<p class="mt-1 text-xs text-navy/40">Ask is powered by AI and can make mistakes</p>
			</div>
		{/if}
		{#each ask.messages as message (message.id)}
			<ChatMessageRow
				{message}
				onretry={ask.canRetry && message.id === ask.lastMessage?.id ? () => void ask.retry() : null}
			/>
		{/each}
		<!--
			Live region for the in-flight answer only — never wrap the whole section.
			Opening a conversation clears `messages` then repopulates it in one render,
			so a section-wide aria-live would announce the entire loaded transcript.
			Rendered unconditionally so assistive tech has the region before content
			appears in it (a region added at the same time as its content is not
			reliably announced). Idle, it's an empty node the {#if} below leaves with
			no children — that would still count as a real DOM sibling and, being the
			section's last child, would flip the previous message row out of
			`:not(:last-child)` and onto `space-y-5`'s bottom margin, adding a trailing
			gap that isn't there today. `-mt-5` when idle cancels exactly that margin
			via collapsing; it's a no-op once the wrapper has content of its own.
		-->
		<div
			aria-live="polite"
			aria-busy={!!ask.activeJob}
			class="space-y-5 {ask.activeJob ? '' : '-mt-5'}"
		>
			{#if ask.activeJob}
				{#if !ask.activeJob.streamingText}
					<p class="flex items-center gap-2 text-sm text-navy/60 italic">
						<span
							class="inline-block h-2 w-2 animate-pulse rounded-full bg-cardinal/60"
							aria-hidden="true"
						></span>
						{thoughtHeadline ? `Thinking — ${thoughtHeadline}` : 'Thinking…'}
					</p>
				{:else}
					<AskAnswer answer={ask.activeJob.streamingText} streaming={true} />
				{/if}
				{#if ask.activeJob.stalled}
					<p class="text-xs text-navy/50 italic">
						Taking longer than usual — you can stop and ask again.
					</p>
				{/if}
			{/if}
		</div>
	</section>

	<div class="border-t border-mist pt-4 pr-4 sm:pr-6">
		{#if ask.errorMessage}
			<p class="mb-2 text-sm font-semibold text-cardinal" role="alert">{ask.errorMessage}</p>
		{/if}
		{#if ask.full}
			<p class="text-sm text-navy/60">
				This conversation is full —
				<a href="/ask" class="font-semibold text-cardinal hover:underline">start a new chat</a>.
			</p>
		{:else}
			<form onsubmit={submitMessage} class="flex flex-col gap-2">
				<div
					class="flex flex-col rounded-lg border border-mist bg-mist/50 focus-within:border-navy/50 focus-within:bg-white"
				>
					<textarea
						bind:value={ask.input}
						onkeydown={onKeydown}
						maxlength={CHAT_MAX_MESSAGE_CHARS}
						rows="2"
						placeholder="Ask about the rules…"
						aria-label="Your message"
						class="min-h-0 w-full resize-none rounded-lg bg-transparent p-3 text-sm text-navy placeholder:text-navy/40 focus:outline-none"
					></textarea>
					<div class="flex items-center justify-between px-3 pb-3">
						{#if chatStream.remaining !== null}
							<p class="self-end text-xs text-navy/50">
								{chatStream.remaining} question{chatStream.remaining === 1 ? '' : 's'} left today
							</p>
						{:else}
							<span aria-hidden="true"></span>
						{/if}
						{#if ask.activeJob}
							<button
								type="button"
								onclick={() => ask.activeJob && chatStream.stop(ask.activeJob)}
								aria-label="Stop"
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-white hover:brightness-110"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="currentColor"
									class="h-4 w-4"
									aria-hidden="true"
								>
									<rect x="6" y="6" width="12" height="12" rx="2" />
								</svg>
							</button>
						{:else}
							<button
								type="submit"
								aria-label="Send"
								disabled={chatStream.atCap || ask.input.trim().length < 3}
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cardinal text-white hover:brightness-110 disabled:opacity-40"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="h-5 w-5"
									aria-hidden="true"
								>
									<path d="M5 12h14M13 6l6 6-6 6" />
								</svg>
							</button>
						{/if}
					</div>
				</div>
			</form>
		{/if}
	</div>
{/if}
