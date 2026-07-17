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

	// Bumped on every view change; in-flight send() continuations from a previous
	// view compare against it and discard their results (the server has already
	// persisted them — they'll appear on next load of that conversation).
	let viewGeneration = 0;

	const thoughtHeadline = $derived(latestThoughtHeadline(thoughts));
	const full = $derived(messages.length >= CONVERSATION_MESSAGE_CAP);

	// React to REAL route changes only (sidebar clicks, back/forward, hard loads).
	// replaceState after the first send changes the URL but not page.params, so it
	// never re-enters here — that's what keeps streaming state alive.
	let lastParam: string | null | undefined = undefined;
	$effect(() => {
		const param = page.params.id ?? null;
		if (param === lastParam) return;
		lastParam = param;
		viewGeneration += 1;
		activeId = param;
		errorMessage = null;
		streamingText = '';
		thoughts = '';
		phase = 'idle';
		messages = []; // clear immediately so a conversation switch never flashes the old thread
		notFound = false;
		if (param) void loadConversation(param);
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
		let truncated = false;
		try {
			const res = await fetch('/api/ai/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message: text, ...(activeId ? { conversationId: activeId } : {}) })
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
				phase = 'idle';
				return;
			}
			const remainingHeader = res.headers.get('x-bp-ai-remaining');
			if (remainingHeader !== null) {
				const n = Number(remainingHeader);
				if (Number.isFinite(n)) remaining = n;
			}
			const conversationId = res.headers.get('x-bp-conversation-id');
			const messageId = res.headers.get('x-bp-message-id');
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
			};
			for (;;) {
				const { done, value } = await reader.read();
				if (gen !== viewGeneration) {
					void reader.cancel();
					return;
				}
				if (done) break;
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
			if (!streamingText.trim()) {
				errorMessage = 'No answer came back — try again.';
				phase = 'idle';
				return;
			}
			messages = [
				...messages,
				{
					id: messageId ?? `local-${crypto.randomUUID()}`,
					role: 'assistant',
					content: streamingText,
					status: truncated ? 'truncated' : 'complete',
					feedback: null,
					createdAt: Date.now()
				}
			];
			if (truncated) errorMessage = 'The answer was cut short — try asking again.';
			streamingText = '';
			phase = 'idle';
			if (!activeId && conversationId) {
				activeId = conversationId;
				replaceState(`/ask/${conversationId}`, {});
				conversations.prepend({
					id: conversationId,
					title: deriveTitle(text),
					updatedAt: Date.now()
				});
			} else if (activeId) {
				conversations.touch(activeId, Date.now());
			}
			scrollToEnd();
		} catch {
			if (gen !== viewGeneration) return;
			if (streamingText) {
				messages = [
					...messages,
					{
						id: `local-${crypto.randomUUID()}`,
						role: 'assistant',
						content: streamingText,
						status: 'complete',
						feedback: null,
						createdAt: Date.now()
					}
				];
				errorMessage = 'The connection dropped mid-answer — what arrived is shown above.';
			} else {
				messages = messages.slice(0, -1);
				errorMessage = 'Network error — try again.';
			}
			streamingText = '';
			phase = 'idle';
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
						<button
							type="submit"
							aria-label="Send"
							disabled={phase === 'streaming' || input.trim().length < 3}
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
					</div>
				</div>
			</form>
		{/if}
	</div>
{/if}
