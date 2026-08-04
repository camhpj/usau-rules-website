import {
	CONVERSATION_MESSAGE_CAP,
	type ChatMessage,
	type ConversationDetail
} from '$lib/ai/payload';
import { chatStream, type StreamJob } from './chat-stream.svelte';

export interface AskPageCallbacks {
	/** Called right after a mutation that reveals new content, to scroll the transcript into view. */
	scrollToEnd: () => void;
	/** Morphs the URL in place once a blank-composer send resolves to a real conversation id. */
	adoptUrl: (conversationId: string) => void;
}

/**
 * Orchestration for `/ask/[[id]]`: loading a conversation's transcript,
 * sending and retrying a message, and the race guards that keep a response
 * from a superseded view from landing on the view that replaced it.
 *
 * Per-page-mount: construct one instance per component mount, the way the
 * page does (`new AskPageState(...)` in its `<script>`). A singleton would
 * carry one visit's generation counter and view token into the next, so a
 * stale response could land against a freshly mounted page — see
 * `createSessionGate` in `$lib/auth-gate.svelte` for the same reasoning
 * applied to session state.
 *
 * Must not import `$app/state` or `$app/navigation`, so it stays testable
 * under `environment: 'node'`. Anything from those two — the route's initial
 * conversation id, `replaceState` — comes in through the constructor.
 */
export class AskPageState {
	messages = $state<ChatMessage[]>([]);
	input = $state('');
	errorMessage = $state<string | null>(null);
	loadingConvo = $state(false);
	notFound = $state(false);

	/** The conversation this view shows, or null for a blank composer. */
	#activeId = $state<string | null>(null);
	/** Regenerated per view session; ties a send to the view that initiated it. */
	#myToken = $state<symbol>(Symbol());
	/**
	 * Guards page-local mutations (bubble rollback, load results) against view
	 * changes. Stream continuations live in `chatStream` and need no guard —
	 * only this page's own reaction to them does. Deliberately not `$state`:
	 * nothing renders it, and nothing should ever derive from it reactively —
	 * it is read only inside the async functions it protects, at the point
	 * where they'd otherwise apply a stale result.
	 */
	#viewGeneration = 0;

	readonly #scrollToEnd: () => void;
	readonly #adoptUrl: (conversationId: string) => void;

	constructor(initialId: string | null, callbacks: AskPageCallbacks) {
		this.#activeId = initialId;
		this.#scrollToEnd = callbacks.scrollToEnd;
		this.#adoptUrl = callbacks.adoptUrl;
		// This component only mounts once the auth check in +layout.svelte resolves
		// (an async session fetch), which is always after SvelteKit's one-time
		// hydration "enter" callback for a hard navigation has already fired and
		// been missed — the page's afterNavigate would never run for it. So a hard
		// navigation straight to /ask/<id> (page reload, deep link, shared URL)
		// needs its own load, using the id the caller seeded from the route params.
		if (initialId) void this.#loadConversation(initialId);
	}

	get activeId(): string | null {
		return this.#activeId;
	}

	get full(): boolean {
		return this.messages.length >= CONVERSATION_MESSAGE_CAP;
	}

	/** The live stream belonging to what this view shows, if any. */
	get activeJob(): StreamJob | null {
		return chatStream.jobForView(this.#activeId, this.#myToken);
	}

	get lastMessage(): ChatMessage | null {
		return this.messages[this.messages.length - 1] ?? null;
	}

	get canRetry(): boolean {
		return (
			!this.activeJob &&
			this.#activeId !== null &&
			this.lastMessage?.role === 'assistant' &&
			this.lastMessage?.status === 'error'
		);
	}

	/**
	 * Reset the view for a completed navigation — including same-URL ones,
	 * like clicking "New chat" while already on a blank /ask with a send in
	 * flight (a params compare would miss those). The caller wires this to
	 * `afterNavigate`; it covers every navigation that happens once this
	 * instance exists — the hard-navigation entry case is the constructor's
	 * own load, above. URL adoption (`checkUrlAdoption`) does not go through
	 * this: it uses `replaceState`, not a navigation, so adopting an id never
	 * resets the view.
	 */
	handleNavigate(param: string | null): void {
		this.#viewGeneration += 1;
		this.#myToken = Symbol(); // a background send from the old view must not adopt this view's URL
		this.#activeId = param;
		this.errorMessage = null;
		this.messages = []; // clear immediately so a conversation switch never flashes the old thread
		this.notFound = false;
		this.loadingConvo = false;
		if (param) void this.#loadConversation(param);
	}

	/**
	 * Adopt the conversation id once headers arrive for a send initiated from
	 * THIS view's blank composer: morph the URL and selection in place. Has no
	 * effect if there is nothing to adopt, so the caller can invoke it freely
	 * (from a `$effect` watching `chatStream`'s jobs) without its own guard.
	 */
	checkUrlAdoption(): void {
		if (this.#activeId !== null) return;
		const cid = chatStream.jobForView(null, this.#myToken)?.conversationId ?? null;
		if (!cid) return;
		this.#activeId = cid;
		this.#adoptUrl(cid);
	}

	/**
	 * Pick up an exchange that finished, possibly while this view was
	 * unmounted. The caller should defer this until the transcript load
	 * settles (`loadingConvo`) — checked here too, so it never races
	 * `#loadConversation`'s own assignment. The server row may already be in
	 * the loaded transcript, so dedupe by id.
	 */
	consumeCompletedIfReady(): void {
		if (!this.#activeId || this.loadingConvo) return;
		const done = chatStream.completed.get(this.#activeId);
		if (!done) return;
		if (!this.messages.some((m) => m.id === done.id)) {
			this.messages = [...this.messages, done];
			this.#scrollToEnd();
		}
		chatStream.consumeCompleted(this.#activeId);
	}

	async #loadConversation(id: string): Promise<void> {
		const gen = this.#viewGeneration;
		this.loadingConvo = true;
		this.notFound = false;
		try {
			const res = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}`);
			if (gen !== this.#viewGeneration) return;
			if (res.status === 404) {
				this.notFound = true;
				this.messages = [];
				return;
			}
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as ConversationDetail;
			if (gen !== this.#viewGeneration) return;
			this.messages = data.messages;
			this.#scrollToEnd();
		} catch {
			if (gen !== this.#viewGeneration) return;
			this.errorMessage = "Couldn't load this conversation — try again.";
		} finally {
			if (gen === this.#viewGeneration) this.loadingConvo = false; // a stale load must not clear the new load's skeleton
		}
	}

	async send(): Promise<void> {
		const text = this.input.trim();
		if (text.length < 3 || this.activeJob || this.full) return;
		const gen = this.#viewGeneration;
		this.messages = [
			...this.messages,
			{
				id: `local-${crypto.randomUUID()}`,
				role: 'user',
				content: text,
				status: null,
				feedback: null,
				createdAt: Date.now()
			}
		];
		this.input = '';
		this.#scrollToEnd();
		const result = await chatStream.send(text, {
			conversationId: this.#activeId,
			viewToken: this.#myToken
		});
		if (gen !== this.#viewGeneration) return;
		if (result.kind === 'failed' || result.kind === 'rejected') {
			this.messages = this.messages.slice(0, -1); // roll back the optimistic user bubble
			this.input = text; // keep the message for retry
		}
		this.errorMessage = result.message;
	}

	async retry(): Promise<void> {
		if (!this.canRetry || !this.#activeId) return;
		const gen = this.#viewGeneration;
		const failedRow = this.messages[this.messages.length - 1];
		// The server deletes the failed row before regenerating — mirror it here.
		this.messages = this.messages.slice(0, -1);
		this.errorMessage = null;
		const result = await chatStream.send('', {
			conversationId: this.#activeId,
			viewToken: this.#myToken,
			retry: true
		});
		if (gen !== this.#viewGeneration) return;
		if (result.kind === 'failed' || result.kind === 'rejected') {
			this.messages = [...this.messages, failedRow]; // the send never started; the row is still persisted
		}
		this.errorMessage = result.message;
	}
}
