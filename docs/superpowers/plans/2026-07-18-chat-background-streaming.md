# Chat Background Streaming & Real Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stop actually cancel server-side generation (what you see is what's saved), surface new conversations in the sidebar the moment they exist, and keep an in-flight answer streaming across route changes.

**Architecture:** Owner feedback on PR #3: stopping an answer then reloading later revealed the full AI response (the route's tee+drain deliberately finished generation after client disconnect), and new conversations only appeared in the sidebar after the stream ended. Fix: (1) server — remove the tee/drain; let client disconnect propagate as consumer cancellation into `streamText`, which reports a new `'cancelled'` outcome so the route persists exactly what was generated (partial → `truncated`, nothing → `error`), with `ctx.waitUntil` keeping the isolate alive for the D1 write; (2) client — move all send/stream state from the page component into a module-scope `chatStream` store (`chat-stream.svelte.ts`), so SPA navigation never aborts the fetch; only the Stop button (or leaving the app: reload/tab close) cancels. The store prepends the conversation to the sidebar as soon as response headers deliver the id; the page becomes a view that renders loaded messages plus the store's live exchange when it belongs to the current view.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes (module-scope `$state` store, same pattern as `conversations.svelte.ts`), Cloudflare Workers, Vitest 4, Playwright.

## Global Constraints

- Branch: `chat-stream-reliability` (PR #3). Commit locally; do NOT push — the owner verifies locally first.
- No new dependencies. No schema changes; persisted assistant `status` stays `'complete' | 'truncated' | 'error'`.
- Semantics (owner-driven): client abort = real cancel. Server persists partial answer text as `truncated`, or an `error` row (content `''`) when no answer text was generated. The old "persist the full answer after client disconnect" behavior is REMOVED on purpose.
- One in-flight stream at a time, app-wide (composer disabled elsewhere while streaming).
- Wire protocol unchanged: NDJSON `{t: 'think'|'text'|'truncated'|'error', text?}`.
- `observer.onClose(outcome)` still fires exactly once per successfully-opened stream (now also on consumer cancellation) and the output stream never errors.
- Copy strings stay verbatim (stall hint "Taking longer than usual — you can stop and ask again."; server-error "The assistant ran into a problem — try asking again."; no message on stop). One NEW copy string: post-headers connection drop with no text → "The connection dropped — reload to see what was saved."
- All 13 existing `e2e/ai.spec.ts` tests are the regression net and must pass (plus the new one).
- Verification: `npm run test`, `npm run check`, `npx playwright test e2e/ai.spec.ts`, `npm run lint` (run `npm run format` if needed).
- Top-nav accessible link names (verified): "Rules", "Quiz", "Ask". Sidebar nav is `role=navigation` name "Conversations".

## File Map

- Modify: `src/lib/server/ai/gemini.ts` — `'cancelled'` outcome, cancel-aware pump finalization (Task 1)
- Modify: `src/lib/server/ai/gemini.test.ts` — consumer-cancel test (Task 1)
- Modify: `src/lib/server/ai/chat.ts` + `chat.test.ts` — `statusForStream` handles `'cancelled'` (Task 1)
- Modify: `src/routes/api/ai/chat/+server.ts` — drop tee/drain, waitUntil persistence (Task 1)
- Create: `src/lib/ask/chat-stream.svelte.ts` — module-scope streaming store (Task 2)
- Modify: `src/routes/ask/[[id]]/+page.svelte` — page becomes a view over the store (Task 2)
- Modify: `e2e/ai.spec.ts` — background-continuation test (Task 2)

---

### Task 1: Server — client disconnect is a real cancel

**Files:**
- Modify: `src/lib/server/ai/gemini.ts`
- Modify: `src/lib/server/ai/chat.ts`
- Modify: `src/routes/api/ai/chat/+server.ts`
- Test: `src/lib/server/ai/gemini.test.ts`, `src/lib/server/ai/chat.test.ts`

**Interfaces:**
- Consumes: existing pump-loop `streamText`, `statusForStream`, route observer.
- Produces: `StreamOutcome` union gains `'cancelled'`; consumer cancellation of the returned stream → upstream abort + `onClose('cancelled')`; `statusForStream('cancelled', text)` → `'truncated'` if text else `'error'`; route returns the stream directly (no tee) and wraps the persistence promise in `ctx.waitUntil`.

- [ ] **Step 1: Failing tests**

1a. In `src/lib/server/ai/gemini.test.ts`, append inside `describe('streamText', ...)` (after the throwing-observer test, before the `watchdog` describe):

```ts
	it('consumer cancellation aborts upstream, reports cancelled, and never errors', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(enc(textChunk('partial ')));
				// never closes — cancellation must come from the consumer side
			}
		});
		const { seen, observer } = observing();
		const stream = await streamText(req(fetchWithBody(body) as typeof fetch, memoryStore()), observer);
		const reader = stream.getReader();
		await reader.read(); // first NDJSON line delivered
		await reader.cancel(); // client went away (stop / reload / tab close)
		await vi.waitFor(() => expect(seen.outcomes).toEqual(['cancelled']));
		expect(seen.textDeltas).toEqual(['partial ']);
	});
```

1b. In `src/lib/server/ai/chat.test.ts`, extend the `statusForStream` describe with:

```ts
	it('treats a cancelled stream like an errored one', () => {
		expect(statusForStream('cancelled', 'partial answer')).toBe('truncated'); // keep what the user saw
		expect(statusForStream('cancelled', '')).toBe('error');
		expect(statusForStream('cancelled', '   ')).toBe('error');
	});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/server/ai/gemini.test.ts src/lib/server/ai/chat.test.ts`
Expected: FAIL — `'cancelled'` is not assignable to `StreamOutcome` (type error) and/or the cancel test times out with `seen.outcomes` = `[]` or `['complete']`.

- [ ] **Step 3: Implement in `gemini.ts`**

3a. Widen the outcome union:

```ts
export type StreamOutcome = 'complete' | 'truncated' | 'error' | 'cancelled';
```

3b. In `streamText`, the closure state and the returned stream change as follows (the fetch/reader/extractor/timer setup above them is untouched). Add a `consumerCancelled` flag next to `outcome`:

```ts
	let outcome: StreamOutcome = 'complete';
	let consumerCancelled = false;
```

3c. Replace the returned `new ReadableStream<Uint8Array>({ ... })` with:

```ts
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			// After the consumer cancels, enqueue/close throw; keep pumping only to finalize.
			const push = (chunk: Uint8Array) => {
				if (consumerCancelled) return;
				try {
					controller.enqueue(chunk);
				} catch {
					consumerCancelled = true;
				}
			};
			try {
				for (;;) {
					const next = reader.read();
					next.catch(() => {}); // the race may abandon this promise; keep its rejection handled
					const { done, value } = await Promise.race([next, aborted]);
					if (done) break;
					for (const event of extractor.feed(value)) {
						if (event.kind === 'delta') {
							if (!event.thought) {
								if (noAnswerTimer) clearTimeout(noAnswerTimer);
								noAnswerTimer = null;
								observer?.onText?.(event.text);
							}
							push(line({ t: event.thought ? 'think' : 'text', text: event.text }));
						} else if (event.reason === 'MAX_TOKENS') {
							console.error('gemini stream truncated: MAX_TOKENS');
							outcome = 'truncated';
							push(line({ t: 'truncated' }));
						} else if (event.reason !== 'STOP') {
							console.error(`gemini stream finished with unexpected reason: ${event.reason}`);
						}
					}
				}
			} catch (cause) {
				console.error('gemini stream failed mid-answer', cause);
				if (outcome !== 'cancelled') outcome = 'error';
				push(line({ t: 'error' }));
				void reader.cancel().catch(() => {});
			} finally {
				clearTimers();
				try {
					await observer?.onClose?.(outcome);
				} catch (cause) {
					console.error('gemini stream observer onClose failed', cause);
				}
				try {
					controller.close();
				} catch {
					// consumer already cancelled the stream
				}
			}
		},
		cancel() {
			// The client is gone (Stop, reload, tab close): this is a real cancel.
			// Abort upstream so Gemini stops generating; the pump's pending read
			// resolves done and the finally block reports the cancelled outcome.
			consumerCancelled = true;
			outcome = 'cancelled';
			clearTimers();
			void reader.cancel().catch(() => {});
		}
	});
```

(Deltas from the current code: `push` wrapper instead of raw `enqueue`, `consumerCancelled` flag, `outcome !== 'cancelled'` guard in the catch, guarded `controller.close()`, and the `cancel()` hook now sets the outcome instead of only cleaning up. The docblock above `streamText` should note that consumer cancellation reports `'cancelled'` via `onClose`.)

- [ ] **Step 4: Implement in `chat.ts`**

Replace `statusForStream` (and its doc comment) with:

```ts
/**
 * DB status for a finished stream. Partial answers are worth keeping — an
 * errored or cancelled stream that produced text persists as truncated; a
 * stream with no answer text at all (thoughts only) is an error row
 * regardless of how it ended. Cancelled = the client went away (Stop,
 * reload); by owner decision the transcript keeps only what was generated.
 */
export function statusForStream(
	outcome: StreamOutcome,
	answerText: string
): 'complete' | 'truncated' | 'error' {
	if (!answerText.trim()) return 'error';
	if (outcome === 'error' || outcome === 'cancelled') return 'truncated';
	return outcome;
}
```

- [ ] **Step 5: Run the unit tests**

Run: `npm run test -- src/lib/server/ai/gemini.test.ts src/lib/server/ai/chat.test.ts`
Expected: PASS (17 in gemini.test.ts, all in chat.test.ts).

- [ ] **Step 6: Rewire `src/routes/api/ai/chat/+server.ts`**

6a. Replace the `observer` object with:

```ts
	const observer = {
		onText: (t: string) => (answerText += t),
		onClose: (outcome: StreamOutcome) => {
			// A client disconnect cancels the stream mid-request; waitUntil keeps
			// the isolate alive until the transcript row is persisted.
			const persisted = persistAssistant(statusForStream(outcome, answerText));
			event.platform?.ctx?.waitUntil?.(persisted);
			return persisted;
		}
	};
```

6b. Delete the tee/drain block:

```ts
	// Tee so the upstream Gemini stream is always fully consumed server-side:
	// flush()/onClose persistence must run even if the client disconnects mid-answer.
	const [clientBranch, drainBranch] = stream.tee();
	const drained = drainBranch.pipeTo(new WritableStream()).catch(() => {});
	event.platform?.ctx?.waitUntil?.(drained);

	return new Response(clientBranch, {
```

becomes:

```ts
	// No tee/drain: a client disconnect must propagate as cancellation so the
	// server stops Gemini and persists only what was generated (owner decision
	// 2026-07-18 — stopping an answer must not produce a full transcript later).
	return new Response(stream, {
```

(headers object unchanged).

- [ ] **Step 7: Full verification**

Run: `npm run test` then `npm run check`
Expected: all PASS, 0 type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/ai/gemini.ts src/lib/server/ai/gemini.test.ts src/lib/server/ai/chat.ts src/lib/server/ai/chat.test.ts src/routes/api/ai/chat/+server.ts
git commit -m "feat: treat client disconnect as a real cancel that persists only generated text"
```

---

### Task 2: Client — module-scope streaming store, immediate sidebar, navigation-proof streams

**Files:**
- Create: `src/lib/ask/chat-stream.svelte.ts`
- Modify: `src/routes/ask/[[id]]/+page.svelte`
- Test: `e2e/ai.spec.ts`

**Interfaces:**
- Consumes: `conversations` store (`prepend`/`touch`), `deriveTitle`, `ChatMessage`, wire events incl. `{"t":"error"}`.
- Produces: singleton `chatStream` with `$state` fields `phase`, `conversationId`, `viewToken`, `streamingText`, `thoughts`, `stalled`, `remaining`, `errorMessage`, `failedText`, `completed` and methods `send(text, {conversationId, viewToken}): Promise<'done' | 'failed'>`, `stop()`, `consumeCompleted()`.

Behavior spec:
1. Send state lives in the store; SPA navigation neither aborts the fetch nor loses the answer. Only `stop()` aborts (server now treats that as a real cancel per Task 1).
2. The conversation appears in the sidebar (and the URL becomes `/ask/<id>` when the initiating blank view is still mounted) as soon as response headers deliver the id — not when the stream ends.
3. When a stream finishes while its conversation is not being viewed, the finished assistant bubble is held in `completed`; the conversation view picks it up on mount (dedup by message id, since the server row may already be in the loaded transcript).
4. One stream at a time: the composer's Send is disabled app-wide while streaming; the Stop button appears only on the view whose exchange is streaming.
5. Stop remains silent (no message). New: a post-headers connection drop with no text shows "The connection dropped — reload to see what was saved." and does NOT restore the input (the exchange is persisted server-side; a retry would duplicate it). A pre-headers failure still rolls back the optimistic bubble and restores the input.

- [ ] **Step 1: Add the failing e2e test**

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
```

(If a nav link's accessible name differs — check `src/lib/components/Nav.svelte`, links are `Rules` / `Quiz` / `Ask` — adjust the `getByRole('link', ...)` names, nothing else.)

- [ ] **Step 2: Run it to verify failure**

Run: `npx playwright test e2e/ai.spec.ts -g "survives navigating"`
Expected: FAIL — today the page teardown aborts the fetch on navigation, so the conversation never completes and the sidebar entry never appears.

- [ ] **Step 3: Create `src/lib/ask/chat-stream.svelte.ts`**

```ts
import { deriveTitle, type ChatMessage } from '$lib/ai/payload';
import { conversations } from './conversations.svelte';

/** No bytes for this long while streaming → show the stall hint. */
const STALL_HINT_MS = 20_000;

export interface CompletedExchange {
	conversationId: string;
	message: ChatMessage;
}

export type SendResult = 'done' | 'failed';

/**
 * Module-scope chat streaming state. Lives outside the page component so an
 * in-flight send keeps streaming across route changes — leaving the page never
 * interrupts a request. Only stop() aborts, and the server treats a client
 * abort as a real cancel: Gemini stops and only generated text is persisted.
 * One stream at a time, app-wide.
 */
class ChatStreamState {
	phase = $state<'idle' | 'streaming'>('idle');
	/** Set once response headers arrive; null while a new conversation's id is pending. */
	conversationId = $state<string | null>(null);
	/** Identifies the view instance that initiated the current send (URL-adoption ownership). */
	viewToken = $state<symbol | null>(null);
	streamingText = $state('');
	thoughts = $state('');
	stalled = $state(false);
	remaining = $state<number | null>(null);
	errorMessage = $state<string | null>(null);
	/** Composer text to restore after a send that persisted nothing. */
	failedText = $state<string | null>(null);
	/** Finished assistant message awaiting pickup by the conversation view. */
	completed = $state<CompletedExchange | null>(null);

	#controller: AbortController | null = null;
	#stallTimer: ReturnType<typeof setTimeout> | null = null;

	stop(): void {
		this.#controller?.abort();
	}

	consumeCompleted(): void {
		this.completed = null;
	}

	#armStall(): void {
		if (this.#stallTimer) clearTimeout(this.#stallTimer);
		this.stalled = false;
		this.#stallTimer = setTimeout(() => (this.stalled = true), STALL_HINT_MS);
	}

	#clearStall(): void {
		if (this.#stallTimer) clearTimeout(this.#stallTimer);
		this.#stallTimer = null;
		this.stalled = false;
	}

	#settle(): void {
		this.#clearStall();
		this.#controller = null;
		this.streamingText = '';
		this.thoughts = '';
		this.viewToken = null;
		this.phase = 'idle';
	}

	/** Hold the finished assistant bubble for pickup and bump the sidebar. */
	#finish(status: 'complete' | 'truncated' | 'error', messageId: string | null): void {
		if (this.conversationId) {
			this.completed = {
				conversationId: this.conversationId,
				message: {
					id: messageId ?? `local-${crypto.randomUUID()}`,
					role: 'assistant',
					content: status === 'error' ? '' : this.streamingText,
					status,
					feedback: null,
					createdAt: Date.now()
				}
			};
			conversations.touch(this.conversationId, Date.now());
		}
		this.#settle();
	}

	async send(
		text: string,
		opts: { conversationId: string | null; viewToken: symbol }
	): Promise<SendResult> {
		if (this.phase === 'streaming') return 'done';
		this.phase = 'streaming';
		this.errorMessage = null;
		this.failedText = null;
		this.completed = null;
		this.streamingText = '';
		this.thoughts = '';
		this.conversationId = opts.conversationId;
		this.viewToken = opts.viewToken;
		const controller = new AbortController();
		this.#controller = controller;
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
				signal: controller.signal
			});
			if (!res.ok || !res.body) {
				const serverMessage = (await res.json().catch(() => null))?.message;
				this.errorMessage =
					res.status === 429 || res.status === 400
						? (serverMessage ?? 'That message could not be sent.')
						: res.status === 503
							? 'AI features are offline right now.'
							: res.status === 401
								? 'Your session expired — sign in again.'
								: res.status === 404
									? 'Conversation not found — start a new chat.'
									: 'The rules assistant is unavailable — try again in a minute.';
				this.failedText = text;
				this.#settle();
				return 'failed';
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
				this.conversationId = cid;
				conversations.prepend({ id: cid, title: deriveTitle(text), updatedAt: Date.now() });
			} else if (cid) {
				conversations.touch(cid, Date.now());
			}
			this.#armStall();
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
				if (msg.t === 'think') this.thoughts += msg.text ?? '';
				else if (msg.t === 'text') this.streamingText += msg.text ?? '';
				else if (msg.t === 'truncated') truncated = true;
				else if (msg.t === 'error') serverError = true;
			};
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				this.#armStall();
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
				this.errorMessage = 'The assistant ran into a problem — try asking again.';
				this.#finish(this.streamingText.trim() ? 'truncated' : 'error', messageId);
			} else if (!this.streamingText.trim()) {
				this.errorMessage = 'No answer came back — try again.';
				this.#finish('error', messageId);
			} else {
				if (truncated) this.errorMessage = 'The answer was cut short — try asking again.';
				this.#finish(truncated ? 'truncated' : 'complete', messageId);
			}
			return 'done';
		} catch {
			const wasStopped = controller.signal.aborted;
			if (this.streamingText.trim()) {
				// Keep the partial — it matches what the server persisted (truncated).
				if (!wasStopped)
					this.errorMessage = 'The connection dropped mid-answer — what arrived is shown above.';
				this.#finish('truncated', messageId);
				return 'done';
			}
			if (wasStopped) {
				this.#settle(); // silent: composer returns, the user bubble stays
				return 'done';
			}
			this.#settle();
			if (messageId) {
				// Headers arrived, so the exchange is persisted server-side; restoring
				// the input would invite a duplicate retry.
				this.errorMessage = 'The connection dropped — reload to see what was saved.';
				return 'done';
			}
			this.errorMessage = 'Network error — try again.';
			this.failedText = text;
			return 'failed';
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
	let loadingConvo = $state(false);
	let notFound = $state(false);
	let activeId = $state<string | null>(null);
	let scrollEl = $state<HTMLElement | null>(null);
	/** Regenerated per view session; ties a send to the view that initiated it. */
	let myToken = $state<symbol>(Symbol());

	// Guards page-local mutations (bubble rollback, load results) against view
	// changes. Stream continuations live in chatStream and need no guard.
	let viewGeneration = 0;

	const thoughtHeadline = $derived(latestThoughtHeadline(chatStream.thoughts));
	const full = $derived(messages.length >= CONVERSATION_MESSAGE_CAP);
	/** The store's live exchange belongs to what this view is showing. */
	const streamVisible = $derived(
		chatStream.phase === 'streaming' &&
			(chatStream.conversationId !== null
				? chatStream.conversationId === activeId
				: chatStream.viewToken === myToken)
	);

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
		chatStream.errorMessage = null;
		messages = []; // clear immediately so a conversation switch never flashes the old thread
		notFound = false;
		if (param) void loadConversation(param);
	});

	// Adopt the conversation id once headers arrive for a send initiated from
	// THIS view's blank composer: morph the URL and sidebar-selection in place.
	$effect(() => {
		const cid = chatStream.conversationId;
		if (!cid || activeId !== null || chatStream.viewToken !== myToken) return;
		activeId = cid;
		replaceState(`/ask/${cid}`, {});
		lastParam = cid; // replaceState doesn't update page.params; resync so the route effect still fires on the next real navigation
	});

	// Pick up an exchange that finished (possibly while this view was unmounted).
	// The server row may already be in the loaded transcript — dedupe by id.
	$effect(() => {
		const done = chatStream.completed;
		if (!done || done.conversationId !== activeId) return;
		if (!messages.some((m) => m.id === done.message.id)) {
			messages = [...messages, done.message];
			scrollToEnd();
		}
		chatStream.consumeCompleted();
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
			chatStream.errorMessage = "Couldn't load this conversation — try again.";
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
		if (text.length < 3 || chatStream.phase === 'streaming' || full) return;
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
		if (result === 'failed') {
			messages = messages.slice(0, -1); // roll back the optimistic user bubble
			input = chatStream.failedText ?? text; // keep the message for retry
			chatStream.failedText = null;
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
```

4b. Template updates (structure unchanged otherwise):
- Every template reference to `phase === 'streaming'` in the MESSAGES section becomes `streamVisible`; `streamingText` → `chatStream.streamingText`; `stalled` → `chatStream.stalled`; `errorMessage` → `chatStream.errorMessage`; `remaining` → `chatStream.remaining`. `thoughtHeadline` stays (now derived from the store).
- The empty-state condition `messages.length === 0 && phase === 'idle'` (both occurrences) becomes `messages.length === 0 && !streamVisible`.
- Composer buttons: Stop shows when `chatStream.phase === 'streaming' && streamVisible` with `onclick={() => chatStream.stop()}`; otherwise the Send branch renders with `disabled={chatStream.phase === 'streaming' || input.trim().length < 3}` (streaming elsewhere = visible but disabled Send).

- [ ] **Step 5: Verify**

Run: `npm run check`, then `npx playwright test e2e/ai.spec.ts`, then `npm run test`
Expected: 0 type errors; ALL 14 e2e tests pass (13 existing + the new background test); unit suite untouched and green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ask/chat-stream.svelte.ts src/routes/ask/[[id]]/+page.svelte e2e/ai.spec.ts
git commit -m "feat: background chat streaming with immediate sidebar entry and real stop"
```

---

## Final verification (after all tasks)

- [ ] `npm run test` — full unit suite passes
- [ ] `npm run check` — no svelte-check errors
- [ ] `npm run lint` — prettier clean
- [ ] `npx playwright test e2e/ai.spec.ts` — 14/14
- [ ] Do NOT push — owner verifies locally (real-Gemini manual check of: stop mid-thinking → reload shows no materialized answer; send → sidebar entry appears immediately; navigate away/back mid-answer → answer completes)
