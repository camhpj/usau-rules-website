# Chat Background Streaming & Real Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stop actually cancel server-side generation (what you see is what's saved), surface new conversations in the sidebar the moment they exist, and keep in-flight answers streaming across route changes — with support for multiple concurrent streams (one per conversation, capped app-wide).

**Architecture:** (1) Server — remove the chat route's tee/drain; client disconnect propagates as consumer cancellation into `streamText`, which reports a `'cancelled'` outcome so the route persists exactly what was generated (partial → `truncated`, nothing → `error`), with `ctx.waitUntil` keeping the isolate alive for the D1 write. (2) Client — send/stream state moves from the page component into a module-scope `chatStream` store (`chat-stream.svelte.ts`) holding a map of stream jobs keyed per conversation, so SPA navigation never aborts a fetch and several conversations can stream at once (at most one stream per conversation; app-wide cap `MAX_CONCURRENT_STREAMS`). The store prepends a new conversation to the sidebar as soon as response headers deliver its id; the page is a view that renders loaded messages plus the live job belonging to the current view, and picks up finished answers from a completed-map (dedup by message id).

**Tech Stack:** SvelteKit 2 / Svelte 5 runes (module-scope `$state` classes + `SvelteMap` from `svelte/reactivity`), Cloudflare Workers, Vitest 4, Playwright.

## Global Constraints

- Branch: `chat-stream-reliability` (PR #3). Commit locally; do NOT push — the owner verifies locally first.
- No new dependencies. No schema changes; persisted assistant `status` stays `'complete' | 'truncated' | 'error'`.
- Semantics (owner-driven): client abort = real cancel. Server persists partial answer text as `truncated`, or an `error` row (content `''`) when no answer text was generated.
- Concurrency (owner-driven): multiple streams allowed — at most ONE per conversation, capped app-wide by `MAX_CONCURRENT_STREAMS = 3` (exported constant in the store; changing the cap is a one-line edit).
- Comment hygiene (owner-driven): code comments must describe the code as it is — no references to prior in-PR states, removed mechanisms, decision dates, or "owner decision" attributions.
- Wire protocol unchanged: NDJSON `{t: 'think'|'text'|'truncated'|'error', text?}`.
- `observer.onClose(outcome)` still fires exactly once per successfully-opened stream (including consumer cancellation) and the output stream never errors.
- Copy strings (verbatim): stall hint "Taking longer than usual — you can stop and ask again."; server-error "The assistant ran into a problem — try asking again."; no message on stop; post-headers drop with no text "The connection dropped — reload to see what was saved."; same-conversation guard "This conversation is already answering — wait for it to finish."; cap guard "You have too many answers streaming — wait for one to finish."
- All 13 existing `e2e/ai.spec.ts` tests are the regression net and must pass (plus the two new ones).
- Verification: `npm run test`, `npm run check`, `npx playwright test e2e/ai.spec.ts`, `npm run lint` (run `npm run format` if needed).
- Top-nav accessible link names (verified): "Rules", "Quiz", "Ask". Sidebar nav is `role=navigation` name "Conversations".

## File Map

- Modify: `src/lib/server/ai/gemini.ts` — `'cancelled'` outcome, cancel-aware pump finalization (Task 1 — DONE, commit 868fca8)
- Modify: `src/lib/server/ai/gemini.test.ts` — consumer-cancel test (Task 1 — DONE)
- Modify: `src/lib/server/ai/chat.ts` + `chat.test.ts` — `statusForStream` handles `'cancelled'` (Task 1 — DONE)
- Modify: `src/routes/api/ai/chat/+server.ts` — drop tee/drain, waitUntil persistence (Task 1 — DONE)
- Create: `src/lib/ask/chat-stream.svelte.ts` — module-scope multi-stream store (Task 2)
- Modify: `src/routes/ask/[[id]]/+page.svelte` — page becomes a view over the store (Task 2)
- Modify: `e2e/ai.spec.ts` — background-continuation + concurrency tests (Task 2)

---

### Task 1: Server — client disconnect is a real cancel

**COMPLETE** (commit 868fca8; reviewed and approved). Preserved here for reference: `StreamOutcome` gained `'cancelled'`; the pump's `cancel()` hook sets the outcome and cancels the upstream reader; enqueues go through a guarded `push`; `controller.close()` is guarded; `statusForStream('cancelled', text)` → text ? `'truncated'` : `'error'`; the route returns the stream directly and wraps the persistence promise from `onClose` in `event.platform?.ctx?.waitUntil`.

---

### Task 2: Client — multi-stream store, immediate sidebar, navigation-proof streams

**Files:**
- Create: `src/lib/ask/chat-stream.svelte.ts`
- Modify: `src/routes/ask/[[id]]/+page.svelte`
- Test: `e2e/ai.spec.ts`

**Interfaces:**
- Consumes: `conversations` store (`prepend`/`touch`), `deriveTitle`, `ChatMessage`, wire events incl. `{"t":"error"}`.
- Produces: singleton `chatStream` with:
  - `jobs: SvelteMap<string, StreamJob>` — live streams; `StreamJob` exposes `$state` fields `conversationId`, `viewToken`, `streamingText`, `thoughts`, `stalled`
  - `completed: SvelteMap<string, ChatMessage>` — finished assistant messages keyed by conversation id, awaiting pickup
  - `remaining: number | null`
  - `jobFor(conversationId)`, `jobForView(activeId, viewToken)`, `atCap` getter
  - `send(text, {conversationId, viewToken}): Promise<SendResult>` where `SendResult = { kind: 'done'; message: string | null } | { kind: 'failed'; message: string } | { kind: 'rejected'; message: string }`
  - `stop(job)`, `consumeCompleted(conversationId)`
  - exported `MAX_CONCURRENT_STREAMS = 3`

Behavior spec:
1. Send state lives in the store; SPA navigation neither aborts fetches nor loses answers. Only `stop(job)` aborts (a real cancel server-side per Task 1).
2. Multiple conversations may stream concurrently. Hard rules: one stream per conversation (`'rejected'` with the same-conversation copy string), app-wide cap of `MAX_CONCURRENT_STREAMS` (`'rejected'` with the cap copy string). The composer's Send is disabled when the current view's conversation is streaming or the cap is reached; the Stop button appears only on a view whose exchange is streaming.
3. A new conversation appears in the sidebar (and the URL becomes `/ask/<id>` when the initiating blank view is still mounted) as soon as response headers deliver the id.
4. A stream finishing while its conversation isn't being viewed parks the assistant bubble in `completed`; the conversation view picks it up on mount, deduping by message id (the server row may already be in the loaded transcript).
5. Error/status messages: the transient `errorMessage` is page-local, set from the send result only when the view that initiated the send is still current; background outcomes are conveyed by the bubble's own status (`truncated` → "cut short" note, `error` → unavailable note). Stop remains silent. A post-headers connection drop with no text returns done-with-message "The connection dropped — reload to see what was saved." and does NOT restore the input (the exchange is persisted server-side; retrying would duplicate it). A pre-headers failure returns `'failed'`: the page rolls back the optimistic bubble and restores the input.

- [ ] **Step 1: Add the two failing e2e tests**

In `e2e/ai.spec.ts`, inside `test.describe('ask the rules (chat)', ...)` after the stop-button test:

```ts
	test('an in-flight answer survives navigating away and back', async ({ page }) => {
		await signUpTestUser(page, 'chat-bg');
		await page.route('**/api/ai/chat', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			await route.fulfill(CHAT_STREAM('mock-convo-bg', 'mock-msg-bg')).catch(() => {});
		});
		await page.route('**/api/ai/conversations/mock-convo-bg', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'mock-convo-bg',
					title: 'Is it a stall at ten?',
					rulesetId: 'usau-official-2026-27',
					messages: [
						{
							id: 'mock-user-bg',
							role: 'user',
							content: 'Is it a stall at ten?',
							status: null,
							feedback: null,
							createdAt: Date.now()
						}
					]
				})
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		// Leave while the request is still pending — SPA navigation keeps the fetch alive.
		await page.getByRole('link', { name: 'Quiz' }).first().click();
		await expect(page).toHaveURL(/\/quiz/);
		// Come back: the conversation is in the sidebar and the finished answer is there.
		await page.getByRole('link', { name: 'Ask' }).first().click();
		const sidebar = page.getByRole('navigation', { name: 'Conversations' });
		await expect(sidebar.getByText(/is it a stall at ten\?/i)).toBeVisible({ timeout: 10_000 });
		await sidebar.getByText(/is it a stall at ten\?/i).click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
	});

	test('two conversations can stream concurrently', async ({ page }) => {
		await signUpTestUser(page, 'chat-multi');
		let calls = 0;
		await page.route('**/api/ai/chat', async (route) => {
			calls += 1;
			if (calls === 1) {
				await new Promise((resolve) => setTimeout(resolve, 4000));
				await route.fulfill(CHAT_STREAM('mock-convo-m1', 'mock-msg-m1')).catch(() => {});
			} else {
				await route.fulfill(CHAT_STREAM('mock-convo-m2', 'mock-msg-m2'));
			}
		});
		await page.route('**/api/ai/conversations/mock-convo-m1', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'mock-convo-m1',
					title: 'First question about stalls',
					rulesetId: 'usau-official-2026-27',
					messages: [
						{
							id: 'mock-user-m1',
							role: 'user',
							content: 'First question about stalls',
							status: null,
							feedback: null,
							createdAt: Date.now()
						}
					]
				})
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('First question about stalls');
		await page.getByRole('button', { name: /^send$/i }).click();
		// Start a second conversation from a fresh blank view while the first is pending.
		await page.getByRole('link', { name: 'Quiz' }).first().click();
		await page.getByRole('link', { name: 'Ask' }).first().click();
		await page.getByRole('textbox', { name: 'Your message' }).fill('Second question about fouls');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
		await expect(page).toHaveURL(/\/ask\/mock-convo-m2$/);
		const sidebar = page.getByRole('navigation', { name: 'Conversations' });
		await expect(sidebar.getByText(/first question about stalls/i)).toBeVisible({ timeout: 10_000 });
		await sidebar.getByText(/first question about stalls/i).click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
	});
```

(If a nav link's accessible name differs — links in `src/lib/components/Nav.svelte` are `Rules` / `Quiz` / `Ask` — adjust only the `getByRole('link', ...)` names.)

- [ ] **Step 2: Run them to verify failure**

Run: `npx playwright test e2e/ai.spec.ts -g "survives navigating|stream concurrently"`
Expected: both FAIL — today navigation aborts the fetch and the composer forbids a second concurrent send.

- [ ] **Step 3: Create `src/lib/ask/chat-stream.svelte.ts`**

```ts
import { SvelteMap } from 'svelte/reactivity';
import { deriveTitle, type ChatMessage } from '$lib/ai/payload';
import { conversations } from './conversations.svelte';

/** No bytes for this long while streaming → show the stall hint. */
const STALL_HINT_MS = 20_000;

/** App-wide ceiling on simultaneous streams (each also holds a daily-quota unit). */
export const MAX_CONCURRENT_STREAMS = 3;

/** One in-flight exchange. Alive only while streaming; removed on settle. */
export class StreamJob {
	/** Set once response headers arrive; null while a new conversation's id is pending. */
	conversationId = $state<string | null>(null);
	/** Identifies the view instance that initiated the send (URL-adoption ownership). */
	viewToken = $state<symbol | null>(null);
	streamingText = $state('');
	thoughts = $state('');
	stalled = $state(false);
	readonly controller = new AbortController();
	stallTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		readonly key: string,
		conversationId: string | null,
		viewToken: symbol
	) {
		this.conversationId = conversationId;
		this.viewToken = viewToken;
	}
}

export type SendResult =
	| { kind: 'done'; message: string | null }
	| { kind: 'failed'; message: string }
	| { kind: 'rejected'; message: string };

/**
 * Module-scope chat streaming state. Lives outside the page component so
 * in-flight sends keep streaming across route changes — leaving the page never
 * interrupts a request. Only stop() aborts, and the server treats a client
 * abort as a real cancel: Gemini stops and only generated text is persisted.
 * Multiple conversations may stream at once (one stream per conversation,
 * MAX_CONCURRENT_STREAMS overall).
 */
class ChatStreamState {
	/** Live streams by job key (conversation id, or a temp key until headers arrive). */
	jobs = new SvelteMap<string, StreamJob>();
	/** Finished assistant messages by conversation id, awaiting pickup by that view. */
	completed = new SvelteMap<string, ChatMessage>();
	remaining = $state<number | null>(null);

	jobFor(conversationId: string | null): StreamJob | null {
		if (!conversationId) return null;
		for (const job of this.jobs.values()) {
			if (job.conversationId === conversationId) return job;
		}
		return null;
	}

	/** The job belonging to what a view shows: its conversation, or a send it initiated. */
	jobForView(activeId: string | null, viewToken: symbol): StreamJob | null {
		for (const job of this.jobs.values()) {
			if (job.conversationId !== null && job.conversationId === activeId) return job;
			if (job.viewToken === viewToken) return job;
		}
		return null;
	}

	get atCap(): boolean {
		return this.jobs.size >= MAX_CONCURRENT_STREAMS;
	}

	stop(job: StreamJob): void {
		job.controller.abort();
	}

	consumeCompleted(conversationId: string): void {
		this.completed.delete(conversationId);
	}

	#armStall(job: StreamJob): void {
		if (job.stallTimer) clearTimeout(job.stallTimer);
		job.stalled = false;
		job.stallTimer = setTimeout(() => (job.stalled = true), STALL_HINT_MS);
	}

	#settle(job: StreamJob): void {
		if (job.stallTimer) clearTimeout(job.stallTimer);
		job.stallTimer = null;
		this.jobs.delete(job.key);
	}

	/** Park the finished assistant bubble for pickup and bump the sidebar. */
	#finish(job: StreamJob, status: 'complete' | 'truncated' | 'error', messageId: string | null): void {
		if (job.conversationId) {
			this.completed.set(job.conversationId, {
				id: messageId ?? `local-${crypto.randomUUID()}`,
				role: 'assistant',
				content: status === 'error' ? '' : job.streamingText,
				status,
				feedback: null,
				createdAt: Date.now()
			});
			conversations.touch(job.conversationId, Date.now());
		}
		this.#settle(job);
	}

	async send(
		text: string,
		opts: { conversationId: string | null; viewToken: symbol }
	): Promise<SendResult> {
		if (this.jobFor(opts.conversationId)) {
			return {
				kind: 'rejected',
				message: 'This conversation is already answering — wait for it to finish.'
			};
		}
		if (this.atCap) {
			return {
				kind: 'rejected',
				message: 'You have too many answers streaming — wait for one to finish.'
			};
		}
		const key = opts.conversationId ?? `new-${crypto.randomUUID()}`;
		const job = new StreamJob(key, opts.conversationId, opts.viewToken);
		this.jobs.set(key, job);
		let truncated = false;
		let serverError = false;
		let messageId: string | null = null;
		try {
			const res = await fetch('/api/ai/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					message: text,
					...(opts.conversationId ? { conversationId: opts.conversationId } : {})
				}),
				signal: job.controller.signal
			});
			if (!res.ok || !res.body) {
				const serverMessage = (await res.json().catch(() => null))?.message;
				this.#settle(job);
				return {
					kind: 'failed',
					message:
						res.status === 429 || res.status === 400
							? (serverMessage ?? 'That message could not be sent.')
							: res.status === 503
								? 'AI features are offline right now.'
								: res.status === 401
									? 'Your session expired — sign in again.'
									: res.status === 404
										? 'Conversation not found — start a new chat.'
										: 'The rules assistant is unavailable — try again in a minute.'
				};
			}
			const remainingHeader = res.headers.get('x-bp-ai-remaining');
			if (remainingHeader !== null) {
				const n = Number(remainingHeader);
				if (Number.isFinite(n)) this.remaining = n;
			}
			const cid = res.headers.get('x-bp-conversation-id');
			messageId = res.headers.get('x-bp-message-id');
			if (cid && !opts.conversationId) {
				// The server has persisted the conversation — surface it immediately.
				job.conversationId = cid;
				conversations.prepend({ id: cid, title: deriveTitle(text), updatedAt: Date.now() });
			} else if (cid) {
				conversations.touch(cid, Date.now());
			}
			this.#armStall(job);
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
				if (msg.t === 'think') job.thoughts += msg.text ?? '';
				else if (msg.t === 'text') job.streamingText += msg.text ?? '';
				else if (msg.t === 'truncated') truncated = true;
				else if (msg.t === 'error') serverError = true;
			};
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				this.#armStall(job);
				lineBuffer += decoder.decode(value, { stream: true });
				let newline: number;
				while ((newline = lineBuffer.indexOf('\n')) !== -1) {
					handleLine(lineBuffer.slice(0, newline));
					lineBuffer = lineBuffer.slice(newline + 1);
				}
			}
			lineBuffer += decoder.decode();
			handleLine(lineBuffer);
			if (serverError) {
				this.#finish(job, job.streamingText.trim() ? 'truncated' : 'error', messageId);
				return { kind: 'done', message: 'The assistant ran into a problem — try asking again.' };
			}
			if (!job.streamingText.trim()) {
				this.#finish(job, 'error', messageId);
				return { kind: 'done', message: 'No answer came back — try again.' };
			}
			this.#finish(job, truncated ? 'truncated' : 'complete', messageId);
			return {
				kind: 'done',
				message: truncated ? 'The answer was cut short — try asking again.' : null
			};
		} catch {
			const wasStopped = job.controller.signal.aborted;
			if (job.streamingText.trim()) {
				// Keep the partial — it matches what the server persisted (truncated).
				this.#finish(job, 'truncated', messageId);
				return {
					kind: 'done',
					message: wasStopped
						? null
						: 'The connection dropped mid-answer — what arrived is shown above.'
				};
			}
			this.#settle(job);
			if (wasStopped) return { kind: 'done', message: null };
			if (messageId) {
				// Headers arrived, so the exchange is persisted server-side; restoring
				// the input would invite a duplicate retry.
				return { kind: 'done', message: 'The connection dropped — reload to see what was saved.' };
			}
			return { kind: 'failed', message: 'Network error — try again.' };
		}
	}
}

export const chatStream = new ChatStreamState();
```

- [ ] **Step 4: Rewrite `src/routes/ask/[[id]]/+page.svelte`**

4a. Replace the entire `<script lang="ts">` block with:

```svelte
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
	// The server row may already be in the loaded transcript — dedupe by id.
	$effect(() => {
		if (!activeId) return;
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
```

4b. Template updates (structure otherwise unchanged):
- Messages section: every `phase === 'streaming'` condition becomes `activeJob`; `streamingText` → `activeJob.streamingText`; `stalled` → `activeJob.stalled`. Inside the `{#if activeJob}` block the thinking-indicator branch is `{#if !activeJob.streamingText}` and the streaming branch renders `<AskAnswer answer={activeJob.streamingText} streaming={true} />`. `thoughtHeadline` usage unchanged.
- Empty-state condition `messages.length === 0 && phase === 'idle'` (both occurrences) becomes `messages.length === 0 && !activeJob`.
- Composer buttons: Stop renders when `activeJob` with `onclick={() => activeJob && chatStream.stop(activeJob)}`; otherwise Send renders with `disabled={chatStream.atCap || input.trim().length < 3}` (the `activeJob` case is covered because Stop replaces Send).
- `errorMessage` and `remaining` render as before (`errorMessage` page-local; `remaining` → `chatStream.remaining`).

- [ ] **Step 5: Verify**

Run: `npm run check`, then `npx playwright test e2e/ai.spec.ts`, then `npm run test`
Expected: 0 type errors; ALL 15 e2e tests pass (13 existing + 2 new); unit suite untouched and green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ask/chat-stream.svelte.ts src/routes/ask/[[id]]/+page.svelte e2e/ai.spec.ts
git commit -m "feat: concurrent background chat streams with immediate sidebar entry and real stop"
```

---

## Final verification (after all tasks)

- [ ] `npm run test` — full unit suite passes
- [ ] `npm run check` — no svelte-check errors
- [ ] `npm run lint` — prettier clean
- [ ] `npx playwright test e2e/ai.spec.ts` — 15/15
- [ ] Comment-hygiene pass over the whole branch diff vs origin/main (no intra-PR history references)
- [ ] Do NOT push — owner verifies locally (real-Gemini manual check of: stop mid-thinking → reload shows no materialized answer; send → sidebar entry appears immediately; navigate away/back mid-answer → answer completes; two conversations streaming at once)
