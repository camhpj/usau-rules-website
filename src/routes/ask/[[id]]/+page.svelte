<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import {
		CHAT_MAX_MESSAGE_CHARS,
		CONVERSATION_MESSAGE_CAP,
		type ChatMessage,
		type ConversationDetail
	} from '$lib/ai/payload';
	import { latestThoughtHeadline } from '$lib/ai/thoughts';
	import { chatStream } from '$lib/ask/chat-stream.svelte';
	import AskAnswer from '$lib/components/AskAnswer.svelte';
	import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';

	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let errorMessage = $state<string | null>(null);
	let loadingConvo = $state(false);
	let notFound = $state(false);
	let activeId = $state<string | null>(null);
	let scrollEl = $state<HTMLElement | null>(null);
	/** Regenerated per view session; ties a send to the view that initiated it. */
	let myToken = $state<symbol>(Symbol());

	// Guards page-local mutations (bubble rollback, load results) against view
	// changes. Stream continuations live in chatStream and need no guard.
	let viewGeneration = 0;

	const full = $derived(messages.length >= CONVERSATION_MESSAGE_CAP);
	/** The live stream belonging to what this view shows, if any. */
	const activeJob = $derived(chatStream.jobForView(activeId, myToken));
	const thoughtHeadline = $derived(activeJob ? latestThoughtHeadline(activeJob.thoughts) : null);

	// React to REAL route changes (sidebar clicks, back/forward, hard loads, "New chat").
	// replaceState after the first send updates page.url but not page.params, so reading
	// only page.params.id would miss it: params.id stays undefined the whole time (send
	// never gives it a value), so Svelte never sees that tracked value change and this
	// effect would never re-run. Reading page.url too gives it a dependency that always
	// changes on navigation, so the params check below still runs and can compare against
	// lastParam (which the adoption effect resyncs after its replaceState).
	let lastParam: string | null | undefined = undefined;
	$effect(() => {
		void page.url;
		const param = page.params.id ?? null;
		if (param === lastParam) return;
		lastParam = param;
		viewGeneration += 1;
		myToken = Symbol(); // a background send from the old view must not adopt this view's URL
		activeId = param;
		errorMessage = null;
		messages = []; // clear immediately so a conversation switch never flashes the old thread
		notFound = false;
		loadingConvo = false;
		if (param) void loadConversation(param);
	});

	// Adopt the conversation id once headers arrive for a send initiated from
	// THIS view's blank composer: morph the URL and selection in place.
	$effect(() => {
		if (activeId !== null) return;
		const cid = chatStream.jobForView(null, myToken)?.conversationId ?? null;
		if (!cid) return;
		activeId = cid;
		replaceState(`/ask/${cid}`, {});
		lastParam = cid; // replaceState doesn't update page.params; resync so the route effect still fires on the next real navigation
	});

	// Pick up an exchange that finished (possibly while this view was unmounted).
	// Defers until the transcript load settles, so it never races loadConversation's
	// own assignment; the server row may already be in the loaded transcript — dedupe by id.
	$effect(() => {
		if (!activeId || loadingConvo) return;
		const done = chatStream.completed.get(activeId);
		if (!done) return;
		if (!messages.some((m) => m.id === done.id)) {
			messages = [...messages, done];
			scrollToEnd();
		}
		chatStream.consumeCompleted(activeId);
	});

	async function loadConversation(id: string) {
		const gen = viewGeneration;
		loadingConvo = true;
		notFound = false;
		try {
			const res = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}`);
			if (gen !== viewGeneration) return;
			if (res.status === 404) {
				notFound = true;
				messages = [];
				return;
			}
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as ConversationDetail;
			if (gen !== viewGeneration) return;
			messages = data.messages;
			scrollToEnd();
		} catch {
			if (gen !== viewGeneration) return;
			errorMessage = "Couldn't load this conversation — try again.";
		} finally {
			if (gen === viewGeneration) loadingConvo = false; // a stale load must not clear the new load's skeleton
		}
	}

	function scrollToEnd() {
		requestAnimationFrame(() => scrollEl?.scrollTo({ top: scrollEl.scrollHeight }));
	}

	async function send(event?: SubmitEvent) {
		event?.preventDefault();
		const text = input.trim();
		if (text.length < 3 || activeJob || full) return;
		const gen = viewGeneration;
		messages = [
			...messages,
			{
				id: `local-${crypto.randomUUID()}`,
				role: 'user',
				content: text,
				status: null,
				feedback: null,
				createdAt: Date.now()
			}
		];
		input = '';
		scrollToEnd();
		const result = await chatStream.send(text, { conversationId: activeId, viewToken: myToken });
		if (gen !== viewGeneration) return;
		if (result.kind === 'failed' || result.kind === 'rejected') {
			messages = messages.slice(0, -1); // roll back the optimistic user bubble
			input = text; // keep the message for retry
		}
		errorMessage = result.message;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		// Cmd/Ctrl+Enter inserts a newline; Shift+Enter keeps its native newline; bare Enter sends.
		if (event.metaKey || event.ctrlKey) {
			event.preventDefault();
			const el = event.currentTarget as HTMLTextAreaElement;
			el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
			input = el.value;
			return;
		}
		if (event.shiftKey) return;
		event.preventDefault();
		void send();
	}
</script>

{#if notFound}
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
		class="flex-1 overflow-y-auto pr-4 pb-4 sm:pr-6 {messages.length === 0 &&
		!activeJob &&
		!loadingConvo
			? 'flex items-center justify-center'
			: 'space-y-5'}"
		aria-label="Messages"
	>
		{#if loadingConvo}
			<div class="space-y-3" aria-hidden="true">
				<div class="flex justify-end">
					<div class="h-8 w-36 animate-pulse rounded-2xl bg-navy/15"></div>
				</div>
				<div class="h-4 w-4/5 animate-pulse rounded bg-navy/10"></div>
				<div class="h-4 w-3/5 animate-pulse rounded bg-navy/10"></div>
			</div>
		{:else if messages.length === 0 && !activeJob}
			<div class="text-center">
				<p class="text-sm text-navy/60">Ask anything about the rules</p>
				<p class="mt-1 text-xs text-navy/40">Ask is powered by AI and can make mistakes</p>
			</div>
		{/if}
		{#each messages as message (message.id)}
			<ChatMessageRow {message} />
		{/each}
		{#if activeJob}
			{#if !activeJob.streamingText}
				<p class="flex items-center gap-2 text-sm text-navy/60 italic">
					<span
						class="inline-block h-2 w-2 animate-pulse rounded-full bg-cardinal/60"
						aria-hidden="true"
					></span>
					{thoughtHeadline ? `Thinking — ${thoughtHeadline}` : 'Thinking…'}
				</p>
			{:else}
				<AskAnswer answer={activeJob.streamingText} streaming={true} />
			{/if}
			{#if activeJob.stalled}
				<p class="text-xs text-navy/50 italic">
					Taking longer than usual — you can stop and ask again.
				</p>
			{/if}
		{/if}
	</section>

	<div class="border-t border-mist pt-4 pr-4 sm:pr-6">
		{#if errorMessage}
			<p class="mb-2 text-sm font-semibold text-cardinal" role="alert">{errorMessage}</p>
		{/if}
		{#if full}
			<p class="text-sm text-navy/60">
				This conversation is full —
				<a href="/ask" class="font-semibold text-cardinal hover:underline">start a new chat</a>.
			</p>
		{:else}
			<form onsubmit={send} class="flex flex-col gap-2">
				<div
					class="flex flex-col rounded-lg border border-mist bg-mist/50 focus-within:border-navy/50 focus-within:bg-white"
				>
					<textarea
						bind:value={input}
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
						{#if activeJob}
							<button
								type="button"
								onclick={() => activeJob && chatStream.stop(activeJob)}
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
								disabled={chatStream.atCap || input.trim().length < 3}
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
