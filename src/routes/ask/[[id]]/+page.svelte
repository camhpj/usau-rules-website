<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import {
		CHAT_MAX_MESSAGE_CHARS,
		CONVERSATION_MESSAGE_CAP,
		deriveTitle,
		type ChatMessage,
		type ConversationDetail
	} from '$lib/ai/payload';
	import { latestThoughtHeadline } from '$lib/ai/thoughts';
	import { conversations } from '$lib/ask/conversations.svelte';
	import AskAnswer from '$lib/components/AskAnswer.svelte';
	import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';

	/** No bytes for this long while streaming → show the stall hint. */
	const STALL_HINT_MS = 20_000;

	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let phase = $state<'idle' | 'streaming'>('idle');
	let streamingText = $state('');
	let thoughts = $state('');
	let errorMessage = $state<string | null>(null);
	let remaining = $state<number | null>(null);
	let loadingConvo = $state(false);
	let notFound = $state(false);
	let activeId = $state<string | null>(null);
	let scrollEl = $state<HTMLElement | null>(null);
	let stalled = $state(false);

	let stopController: AbortController | null = null;
	let stallTimer: ReturnType<typeof setTimeout> | null = null;

	// Bumped on every view change; in-flight send() continuations from a previous
	// view compare against it and discard their results (the server has already
	// persisted them — they'll appear on next load of that conversation).
	let viewGeneration = 0;

	const thoughtHeadline = $derived(latestThoughtHeadline(thoughts));
	const full = $derived(messages.length >= CONVERSATION_MESSAGE_CAP);

	// React to REAL route changes (sidebar clicks, back/forward, hard loads, "New chat").
	// replaceState after the first send updates page.url but not page.params, so reading
	// only page.params.id would miss it: params.id stays undefined the whole time (send
	// never gives it a value), so Svelte never sees that tracked value change and this
	// effect would never re-run. Reading page.url too gives it a dependency that always
	// changes on navigation, so the params check below still runs and can compare against
	// lastParam (which send() resyncs after its replaceState).
	let lastParam: string | null | undefined = undefined;
	$effect(() => {
		void page.url;
		const param = page.params.id ?? null;
		if (param === lastParam) return;
		lastParam = param;
		viewGeneration += 1;
		stopController?.abort(); // a stream for the old view has no reader once we leave
		stopController = null;
		clearStallTimer();
		activeId = param;
		errorMessage = null;
		streamingText = '';
		thoughts = '';
		phase = 'idle';
		messages = []; // clear immediately so a conversation switch never flashes the old thread
		notFound = false;
		if (param) void loadConversation(param);
	});

	$effect(() => {
		return () => {
			viewGeneration += 1; // strand any in-flight send() so it can't replaceState after unmount
			stopController?.abort();
			clearStallTimer();
		};
	});

	function armStallTimer() {
		if (stallTimer) clearTimeout(stallTimer);
		stalled = false;
		stallTimer = setTimeout(() => (stalled = true), STALL_HINT_MS);
	}

	function clearStallTimer() {
		if (stallTimer) clearTimeout(stallTimer);
		stallTimer = null;
		stalled = false;
	}

	function stop() {
		stopController?.abort();
	}

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
		const gen = viewGeneration;
		const text = input.trim();
		if (text.length < 3 || phase === 'streaming' || full) return;
		phase = 'streaming';
		errorMessage = null;
		streamingText = '';
		thoughts = '';
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

		const controller = new AbortController();
		stopController = controller;
		let truncated = false;
		let serverError = false;
		let conversationId: string | null = null;
		let messageId: string | null = null;

		// The server persisted the exchange the moment the response opened; keep
		// the URL and sidebar in sync with that on every terminal path.
		const syncConversation = () => {
			if (!activeId && conversationId) {
				activeId = conversationId;
				replaceState(`/ask/${conversationId}`, {});
				lastParam = conversationId; // replaceState doesn't update page.params; resync so the route-change effect still fires on the next real navigation (e.g. "New chat")
				conversations.prepend({
					id: conversationId,
					title: deriveTitle(text),
					updatedAt: Date.now()
				});
			} else if (activeId) {
				conversations.touch(activeId, Date.now());
			}
		};
		const pushAssistant = (status: 'complete' | 'truncated' | 'error') => {
			messages = [
				...messages,
				{
					id: messageId ?? `local-${crypto.randomUUID()}`,
					role: 'assistant',
					content: status === 'error' ? '' : streamingText,
					status,
					feedback: null,
					createdAt: Date.now()
				}
			];
			streamingText = '';
		};
		const settle = () => {
			clearStallTimer();
			if (stopController === controller) stopController = null;
			phase = 'idle';
		};

		try {
			const res = await fetch('/api/ai/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message: text, ...(activeId ? { conversationId: activeId } : {}) }),
				signal: controller.signal
			});
			if (gen !== viewGeneration) return;
			if (!res.ok || !res.body) {
				const serverMessage = (await res.json().catch(() => null))?.message;
				if (gen !== viewGeneration) return;
				errorMessage =
					res.status === 429 || res.status === 400
						? (serverMessage ?? 'That message could not be sent.')
						: res.status === 503
							? 'AI features are offline right now.'
							: res.status === 401
								? 'Your session expired — sign in again.'
								: res.status === 404
									? 'Conversation not found — start a new chat.'
									: 'The rules assistant is unavailable — try again in a minute.';
				messages = messages.slice(0, -1); // roll back the optimistic user bubble
				input = text; // keep the message for retry
				settle();
				return;
			}
			const remainingHeader = res.headers.get('x-bp-ai-remaining');
			if (remainingHeader !== null) {
				const n = Number(remainingHeader);
				if (Number.isFinite(n)) remaining = n;
			}
			conversationId = res.headers.get('x-bp-conversation-id');
			messageId = res.headers.get('x-bp-message-id');
			armStallTimer();
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let lineBuffer = '';
			const handleLine = (line: string) => {
				if (!line) return;
				let msg: { t?: string; text?: string };
				try {
					msg = JSON.parse(line);
				} catch {
					return;
				}
				if (msg.t === 'think') thoughts += msg.text ?? '';
				else if (msg.t === 'text') streamingText += msg.text ?? '';
				else if (msg.t === 'truncated') truncated = true;
				else if (msg.t === 'error') serverError = true;
			};
			for (;;) {
				const { done, value } = await reader.read();
				if (gen !== viewGeneration) {
					void reader.cancel();
					return;
				}
				if (done) break;
				armStallTimer();
				lineBuffer += decoder.decode(value, { stream: true });
				let newline: number;
				while ((newline = lineBuffer.indexOf('\n')) !== -1) {
					handleLine(lineBuffer.slice(0, newline));
					lineBuffer = lineBuffer.slice(newline + 1);
				}
			}
			lineBuffer += decoder.decode();
			handleLine(lineBuffer);
			if (gen !== viewGeneration) return;
			if (serverError) {
				pushAssistant(streamingText.trim() ? 'truncated' : 'error');
				errorMessage = 'The assistant ran into a problem — try asking again.';
			} else if (!streamingText.trim()) {
				pushAssistant('error');
				errorMessage = 'No answer came back — try again.';
			} else {
				pushAssistant(truncated ? 'truncated' : 'complete');
				if (truncated) errorMessage = 'The answer was cut short — try asking again.';
			}
			syncConversation();
			settle();
			scrollToEnd();
		} catch {
			if (gen !== viewGeneration) return;
			const wasStopped = controller.signal.aborted;
			if (streamingText.trim()) {
				pushAssistant('truncated');
				errorMessage = wasStopped
					? null
					: 'The connection dropped mid-answer — what arrived is shown above.';
				syncConversation();
			} else if (wasStopped) {
				// The server keeps generating and persists the full answer; the user
				// bubble stays so this view matches what a reload will show.
				syncConversation();
			} else {
				messages = messages.slice(0, -1);
				input = text;
				errorMessage = 'Network error — try again.';
			}
			settle();
		}
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
		phase === 'idle' &&
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
		{:else if messages.length === 0 && phase === 'idle'}
			<div class="text-center">
				<p class="text-sm text-navy/60">Ask anything about the rules</p>
				<p class="mt-1 text-xs text-navy/40">Ask is powered by AI and can make mistakes</p>
			</div>
		{/if}
		{#each messages as message (message.id)}
			<ChatMessageRow {message} />
		{/each}
		{#if phase === 'streaming'}
			{#if !streamingText}
				<p class="flex items-center gap-2 text-sm text-navy/60 italic">
					<span
						class="inline-block h-2 w-2 animate-pulse rounded-full bg-cardinal/60"
						aria-hidden="true"
					></span>
					{thoughtHeadline ? `Thinking — ${thoughtHeadline}` : 'Thinking…'}
				</p>
			{:else}
				<AskAnswer answer={streamingText} streaming={true} />
			{/if}
			{#if stalled}
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
						{#if remaining !== null}
							<p class="self-end text-xs text-navy/50">
								{remaining} question{remaining === 1 ? '' : 's'} left today
							</p>
						{:else}
							<span aria-hidden="true"></span>
						{/if}
						{#if phase === 'streaming'}
							<button
								type="button"
								onclick={stop}
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
								disabled={input.trim().length < 3}
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
