# Chat Stream Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound runaway "thinking" in the ask chat with a server-side watchdog, persist accurate message status on every stream failure, and give the client a Stop button plus a stall hint.

**Architecture:** `streamText` in `src/lib/server/ai/gemini.ts` is rebuilt as a pump loop over the upstream SSE reader with an `AbortController` watchdog (no-answer timer + hard wall-clock cap). All terminal paths — clean finish, MAX_TOKENS, watchdog abort, upstream mid-stream failure — converge on one finalizer that emits an in-band `{"t":"error"}` NDJSON event when needed, invokes `observer.onClose(outcome)`, and closes the output stream *cleanly* (the output stream never errors). The chat route maps the outcome to a persisted message status via a pure helper. The client handles the new `error` event, adds a Stop button (client-side fetch abort), and shows a stall hint when no bytes arrive for 20s.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Cloudflare Workers (D1 via drizzle), Vitest 4 (fake timers), Playwright e2e.

**Superseded in part:** the stop/cancel semantics below were revised by [2026-07-18-chat-background-streaming.md](2026-07-18-chat-background-streaming.md) — Stop now cancels server-side generation and only generated text is persisted, the route's tee/drain was replaced by direct cancellation propagation, and no "Stopped." message is shown. Where the two plans disagree, the 2026-07-18 plan governs.

## Global Constraints

- No new dependencies. Node >= 22.
- Wire protocol stays NDJSON lines `{t: 'think'|'text'|'truncated'|'error', text?}` — existing `think`/`text`/`truncated` shapes must not change.
- The output `ReadableStream` returned by `streamText` must always close cleanly; failures are reported in-band via `{"t":"error"}`, never by erroring the stream (consumers depend on this).
- `observer.onClose(outcome)` fires exactly once per successfully-opened stream, before the output stream closes, and is awaited.
- Persisted assistant `status` values remain `'complete' | 'truncated' | 'error'` (schema unchanged; no migration).
- Server behavior spec (user-approved): stream with zero answer text (thoughts only, any outcome) persists as `error`; errored stream with partial answer text persists as `truncated`.
- ~~Client Stop is a client-side abort only; the server drain branch keeps consuming and persists the full answer. Accepted tradeoff, do not add a cancel endpoint.~~ *(superseded — see note above)*
- Copy strings (verbatim): stall hint "Taking longer than usual — you can stop and ask again."; server-error message "The assistant ran into a problem — try asking again." (the stop message was later removed — see note above)
- Verification commands: `npm run test` (vitest), `npm run check` (svelte-check), `npx playwright test e2e/ai.spec.ts` (e2e; requires the dev stack that `npm run test:e2e` normally provisions).
- Commit style: conventional commits (`feat:`/`fix:`/`test:`), match existing history.

## File Map

- Modify: `src/lib/server/ai/config.ts` — add two watchdog constants (Task 1)
- Modify: `src/lib/server/ai/gemini.ts` — signal threading, `StreamOutcome`, new `StreamObserver`, rebuilt `streamText` (Task 1)
- Modify: `src/lib/server/ai/gemini.test.ts` — rewrite `streamText` describe block (Task 1)
- Modify: `src/lib/server/ai/chat.ts` — add `statusForStream` (Task 2)
- Modify: `src/lib/server/ai/chat.test.ts` — tests for `statusForStream` (Task 2)
- Modify: `src/routes/api/ai/chat/+server.ts` — wire outcome → status (Task 2)
- Modify: `src/routes/ask/[[id]]/+page.svelte` — error event, Stop button, stall hint (Task 3)
- Modify: `e2e/ai.spec.ts` — error-event and Stop tests (Task 3)

---

### Task 1: Watchdog and in-band error events in `streamText`

**Files:**
- Modify: `src/lib/server/ai/config.ts`
- Modify: `src/lib/server/ai/gemini.ts`
- Test: `src/lib/server/ai/gemini.test.ts`

**Interfaces:**
- Consumes: existing `SseTextExtractor`, `callWithCacheFallback`, `GeminiRequest` (unchanged).
- Produces (later tasks rely on these exact shapes):
  - `export type StreamOutcome = 'complete' | 'truncated' | 'error'` (in `gemini.ts`)
  - `export interface StreamObserver { onText?(text: string): void; onClose?(outcome: StreamOutcome): void | Promise<void>; }` — `onTruncated` is REMOVED; truncation arrives as `onClose('truncated')`.
  - New config exports: `AI_STREAM_NO_ANSWER_MAX_MS = 45_000`, `AI_STREAM_MAX_MS = 120_000`.
  - New wire event: `{"t":"error"}` NDJSON line emitted on watchdog abort or upstream mid-stream failure.

Note: `src/routes/api/ai/chat/+server.ts` still compiles against the new observer type in the interim (its `onClose` is zero-arg, which is assignable; its `onTruncated` is an inert extra property because the observer is a variable, not an inline literal). Task 2 rewires it properly. Do NOT touch `+server.ts` in this task.

- [ ] **Step 1: Add the watchdog constants to `src/lib/server/ai/config.ts`**

Append at the end of the file:

```ts
/** Watchdog: abort a stream that has produced no answer text (thoughts only) by this point. */
export const AI_STREAM_NO_ANSWER_MAX_MS = 45_000;
/** Watchdog: hard wall-clock cap on a single streaming response. */
export const AI_STREAM_MAX_MS = 120_000;
```

- [ ] **Step 2: Rewrite the `streamText` describe block in `src/lib/server/ai/gemini.test.ts` (failing tests)**

Replace the entire existing `describe('streamText', ...)` block (currently the last block in the file) with the code below. Also update the imports at the top of the file: add `afterEach` to the vitest import, add `AI_STREAM_MAX_MS, AI_STREAM_NO_ANSWER_MAX_MS` to the `./config` import (keeping `GEMINI_MODEL`), and remove nothing else. The `StreamObserver` import already exists.

```ts
describe('streamText', () => {
	function sseLine(body: unknown) {
		return `data: ${JSON.stringify(body)}\n\n`;
	}
	const enc = (s: string) => new TextEncoder().encode(s);
	const thoughtChunk = sseLine({
		candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }] } }]
	});
	const textChunk = (t: string) => sseLine({ candidates: [{ content: { parts: [{ text: t }] } }] });
	const finishChunk = (reason: string) =>
		sseLine({ candidates: [{ content: { parts: [] }, finishReason: reason }] });

	function fetchWithBody(body: ReadableStream<Uint8Array>) {
		return vi.fn(async (url: RequestInfo | URL) => {
			if (String(url).includes('/cachedContents')) return new Response('no', { status: 500 });
			return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
		});
	}

	function closedBody(lines: string[]) {
		return new ReadableStream<Uint8Array>({
			start(controller) {
				for (const line of lines) controller.enqueue(enc(line));
				controller.close();
			}
		});
	}

	async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
		const decoder = new TextDecoder();
		const reader = stream.getReader();
		let out = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			out += decoder.decode(value, { stream: true });
		}
		return out;
	}

	function observing() {
		const seen = { textDeltas: [] as string[], outcomes: [] as string[] };
		const observer: StreamObserver = {
			onText: (text) => seen.textDeltas.push(text),
			onClose: (outcome) => {
				seen.outcomes.push(outcome);
			}
		};
		return { seen, observer };
	}

	it('streams deltas, reports a truncated outcome, and keeps the wire shapes', async () => {
		const { seen, observer } = observing();
		const fetchMock = fetchWithBody(
			closedBody([thoughtChunk, textChunk('Hello '), textChunk('world'), finishChunk('MAX_TOKENS')])
		);
		const stream = await streamText(req(fetchMock as typeof fetch, memoryStore()), observer);
		const output = await drain(stream);

		expect(seen.textDeltas).toEqual(['Hello ', 'world']); // thought delta excluded
		expect(seen.outcomes).toEqual(['truncated']); // exactly once, truncation folded into outcome
		expect(output).toContain('"t":"think"');
		expect(output).toContain('"t":"text","text":"Hello "');
		expect(output).toContain('"t":"truncated"');
		expect(output).not.toContain('"t":"error"');
	});

	it('reports a complete outcome on STOP and works without an observer', async () => {
		const { seen, observer } = observing();
		const stream = await streamText(
			req(
				fetchWithBody(closedBody([textChunk('done'), finishChunk('STOP')])) as typeof fetch,
				memoryStore()
			),
			observer
		);
		await drain(stream);
		expect(seen.outcomes).toEqual(['complete']);

		const bare = await streamText(
			req(
				fetchWithBody(closedBody([textChunk('done'), finishChunk('STOP')])) as typeof fetch,
				memoryStore()
			)
		);
		expect(await drain(bare)).toContain('"t":"text","text":"done"');
	});

	it('converts an upstream mid-stream failure into an in-band error event', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(enc(textChunk('partial ')));
				controller.error(new Error('upstream died'));
			}
		});
		const { seen, observer } = observing();
		const stream = await streamText(req(fetchWithBody(body) as typeof fetch, memoryStore()), observer);
		const output = await drain(stream); // resolves — the failure is in-band, the stream closes cleanly
		expect(output).toContain('"t":"text","text":"partial "');
		expect(output).toContain('"t":"error"');
		expect(seen.outcomes).toEqual(['error']);
	});

	describe('watchdog', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it('aborts a thoughts-only stream after AI_STREAM_NO_ANSWER_MAX_MS', async () => {
			vi.useFakeTimers();
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(enc(thoughtChunk)); // never closes: the runaway-thinking shape
				}
			});
			const { seen, observer } = observing();
			const stream = await streamText(req(fetchWithBody(body) as typeof fetch, memoryStore()), observer);
			const drained = drain(stream);
			await vi.advanceTimersByTimeAsync(AI_STREAM_NO_ANSWER_MAX_MS + 1);
			const output = await drained;
			expect(output).toContain('"t":"think"');
			expect(output).toContain('"t":"error"');
			expect(seen.outcomes).toEqual(['error']);
		});

		it('answer text disarms the no-answer timer; the hard cap still bounds the stream', async () => {
			vi.useFakeTimers();
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(enc(textChunk('early answer'))); // then hangs forever
				}
			});
			const { seen, observer } = observing();
			const stream = await streamText(req(fetchWithBody(body) as typeof fetch, memoryStore()), observer);
			let settled = false;
			const drained = drain(stream).then((out) => {
				settled = true;
				return out;
			});
			await vi.advanceTimersByTimeAsync(AI_STREAM_NO_ANSWER_MAX_MS + 1);
			expect(settled).toBe(false); // disarmed: answer text arrived before the no-answer deadline
			await vi.advanceTimersByTimeAsync(AI_STREAM_MAX_MS);
			const output = await drained;
			expect(settled).toBe(true);
			expect(output).toContain('"t":"error"');
			expect(seen.outcomes).toEqual(['error']);
		});
	});
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npm run test -- src/lib/server/ai/gemini.test.ts`
Expected: FAIL — the observer's `onClose` never receives an outcome string (`seen.outcomes` gets `[undefined]`), no `"t":"error"` events, watchdog tests time out or hang-abort assertions fail. (The two old streamText tests were replaced, so no stale passes.)

- [ ] **Step 4: Implement in `src/lib/server/ai/gemini.ts`**

4a. Update the config import (line 4) to include the new constants:

```ts
import {
	AI_STREAM_MAX_MS,
	AI_STREAM_NO_ANSWER_MAX_MS,
	CACHE_MIN_REMAINING_MS,
	CACHE_TTL_S,
	GEMINI_BASE,
	GEMINI_MODEL
} from './config';
```

4b. Thread an optional `AbortSignal` through `callGemini` and `callWithCacheFallback` (replace both functions):

```ts
function callGemini(
	req: GeminiRequest,
	endpoint: string,
	cacheName: string | null,
	signal?: AbortSignal
): Promise<Response> {
	const f = req.fetchImpl ?? fetch;
	return f(`${GEMINI_BASE}/models/${GEMINI_MODEL}:${endpoint}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
		body: JSON.stringify(buildBody(req, cacheName)),
		signal
	});
}

/**
 * A 4xx while using a cache usually means the cached content expired or was
 * evicted server-side: drop the registry row, recreate once, retry. Whatever
 * happens, the final attempt runs inline (uncached) so a cache problem can
 * never take the feature down.
 */
async function callWithCacheFallback(
	req: GeminiRequest,
	endpoint: string,
	signal?: AbortSignal
): Promise<Response> {
	const cacheName = await ensureGroundingCache(req);
	let res = await callGemini(req, endpoint, cacheName, signal);
	if (cacheName && !res.ok && res.status >= 400 && res.status < 500) {
		await req.store.del(cacheKey(req.rulesetId));
		const fresh = await ensureGroundingCache(req);
		res = await callGemini(req, endpoint, fresh, signal);
	}
	return res;
}
```

(`generateText` keeps calling `callWithCacheFallback(req, 'generateContent')` with no signal — unchanged.)

4c. Replace the `StreamObserver` interface and the whole `streamText` function (delete `onTruncated`; `SseEvent`/`SseTextExtractor` stay as they are):

```ts
export type StreamOutcome = 'complete' | 'truncated' | 'error';

export interface StreamObserver {
	onText?(text: string): void; // answer deltas only — never thought deltas
	/** Fires exactly once, before the output stream ends; awaited. */
	onClose?(outcome: StreamOutcome): void | Promise<void>;
}

/**
 * Streaming call; resolves once the upstream stream is open. Throws pre-stream.
 *
 * Post-stream, the returned stream NEVER errors: watchdog aborts and upstream
 * failures are reported in-band as a `{"t":"error"}` line followed by a clean
 * close, so downstream consumers (the route's tee/drain persistence) always
 * run to completion. Watchdog: a model stuck generating thoughts never emits
 * answer text, so thought-only time is capped separately from the wall clock.
 */
export async function streamText(
	req: GeminiRequest,
	observer?: StreamObserver
): Promise<ReadableStream<Uint8Array>> {
	const abort = new AbortController();
	const res = await callWithCacheFallback(req, 'streamGenerateContent?alt=sse', abort.signal);
	if (!res.ok || !res.body) {
		throw new Error(`${res.status} from Gemini: ${(await res.text()).slice(0, 300)}`);
	}
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	const extractor = new SseTextExtractor();
	const encoder = new TextEncoder();
	const line = (obj: unknown) => encoder.encode(JSON.stringify(obj) + '\n');

	let outcome: StreamOutcome = 'complete';
	let noAnswerTimer: ReturnType<typeof setTimeout> | null = setTimeout(
		() => abort.abort(new Error('watchdog: no answer text within budget')),
		AI_STREAM_NO_ANSWER_MAX_MS
	);
	const hardTimer = setTimeout(
		() => abort.abort(new Error('watchdog: stream exceeded max duration')),
		AI_STREAM_MAX_MS
	);
	const clearTimers = () => {
		if (noAnswerTimer) clearTimeout(noAnswerTimer);
		noAnswerTimer = null;
		clearTimeout(hardTimer);
	};
	// A test-seam fetch body may ignore the abort signal; racing read() against
	// the signal guarantees the pump loop unblocks on abort regardless.
	const aborted = new Promise<never>((_, reject) => {
		abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
	});

	return new ReadableStream<Uint8Array>({
		async start(controller) {
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
							controller.enqueue(line({ t: event.thought ? 'think' : 'text', text: event.text }));
						} else if (event.reason === 'MAX_TOKENS') {
							console.error('gemini stream truncated: MAX_TOKENS');
							outcome = 'truncated';
							controller.enqueue(line({ t: 'truncated' }));
						} else if (event.reason !== 'STOP') {
							console.error(`gemini stream finished with unexpected reason: ${event.reason}`);
						}
					}
				}
			} catch (cause) {
				console.error('gemini stream failed mid-answer', cause);
				outcome = 'error';
				controller.enqueue(line({ t: 'error' }));
				void reader.cancel().catch(() => {});
			} finally {
				clearTimers();
				await observer?.onClose?.(outcome);
				controller.close();
			}
		},
		cancel() {
			clearTimers();
			void reader.cancel().catch(() => {});
		}
	});
}
```

- [ ] **Step 5: Run the full unit suite and typecheck**

Run: `npm run test -- src/lib/server/ai/gemini.test.ts` then `npm run test` then `npm run check`
Expected: all PASS. (`+server.ts` still typechecks — see the note at the top of this task.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/ai/config.ts src/lib/server/ai/gemini.ts src/lib/server/ai/gemini.test.ts
git commit -m "feat: watchdog and in-band error events for the Gemini chat stream"
```

---

### Task 2: Persist accurate status for every stream outcome

**Files:**
- Modify: `src/lib/server/ai/chat.ts`
- Modify: `src/routes/api/ai/chat/+server.ts`
- Test: `src/lib/server/ai/chat.test.ts`

**Interfaces:**
- Consumes: `StreamOutcome` type from `./gemini` (Task 1).
- Produces: `export function statusForStream(outcome: StreamOutcome, answerText: string): 'complete' | 'truncated' | 'error'` in `src/lib/server/ai/chat.ts`.

- [ ] **Step 1: Write failing tests in `src/lib/server/ai/chat.test.ts`**

Add `statusForStream` to the existing `./chat` import and append this describe block:

```ts
describe('statusForStream', () => {
	it('passes outcomes through when answer text exists, downgrading error to truncated', () => {
		expect(statusForStream('complete', 'full answer')).toBe('complete');
		expect(statusForStream('truncated', 'partial answer')).toBe('truncated');
		expect(statusForStream('error', 'partial answer')).toBe('truncated'); // partial answers are kept
	});
	it('persists any stream with no answer text as an error row', () => {
		expect(statusForStream('complete', '')).toBe('error'); // thoughts-only "success"
		expect(statusForStream('complete', '   ')).toBe('error');
		expect(statusForStream('truncated', '')).toBe('error');
		expect(statusForStream('error', '')).toBe('error');
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- src/lib/server/ai/chat.test.ts`
Expected: FAIL with `statusForStream` not exported.

- [ ] **Step 3: Implement `statusForStream` in `src/lib/server/ai/chat.ts`**

Add at the end of the file (plus `import type { StreamOutcome } from './gemini';` at the top):

```ts
/**
 * DB status for a finished stream. Partial answers are worth keeping — an
 * errored stream that produced text persists as truncated; a stream that
 * produced no answer text at all (thoughts only) is an error row regardless
 * of how it ended.
 */
export function statusForStream(
	outcome: StreamOutcome,
	answerText: string
): 'complete' | 'truncated' | 'error' {
	if (!answerText.trim()) return 'error';
	return outcome === 'error' ? 'truncated' : outcome;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/lib/server/ai/chat.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `src/routes/api/ai/chat/+server.ts`**

Three small edits:

5a. Import changes: add `statusForStream` to the `$lib/server/ai/chat` import and add the outcome type import:

```ts
import { statusForStream, toGeminiTurns } from '$lib/server/ai/chat';
import { d1CacheStore, streamText, type StreamOutcome } from '$lib/server/ai/gemini';
```

5b. Delete the line `let truncated = false;` (currently just below `let answerText = '';`).

5c. Replace the `observer` object (currently `{ onText, onTruncated, onClose }`) with:

```ts
	const observer = {
		onText: (t: string) => (answerText += t),
		onClose: (outcome: StreamOutcome) => persistAssistant(statusForStream(outcome, answerText))
	};
```

Everything else in the route — quota, persistence order, retry, tee/drain, headers — stays exactly as is.

- [ ] **Step 6: Full verification**

Run: `npm run test` then `npm run check`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/ai/chat.ts src/lib/server/ai/chat.test.ts src/routes/api/ai/chat/+server.ts
git commit -m "feat: persist accurate assistant message status for every stream outcome"
```

---

### Task 3: Client — error handling, Stop button, stall hint

**Files:**
- Modify: `src/routes/ask/[[id]]/+page.svelte`
- Test: `e2e/ai.spec.ts`

**Interfaces:**
- Consumes: NDJSON `{"t":"error"}` event (Task 1); `ChatMessage.status` union (unchanged); `ChatMessageRow` renders `status === 'error'` as "No answer — the assistant was unavailable." and `status === 'truncated'` with a "This answer was cut short." note (both already exist).
- Produces: UI behavior only — no new exports.

Behavior spec for this task:
1. `{"t":"error"}` received: if partial answer text exists, keep it as a `truncated` bubble; else push an `error` bubble. Either way show "The assistant ran into a problem — try asking again." and run conversation bookkeeping (URL/sidebar) since the server persisted the exchange.
2. Stop button replaces Send while streaming; clicking aborts the fetch. Partial text is kept as a `truncated` bubble (no error message); with no text yet, the user bubble stays (the server has it) and "Stopped." is shown. Bookkeeping runs with whatever headers arrived.
3. Stall hint: if no bytes arrive for 20s while streaming, show "Taking longer than usual — you can stop and ask again." — cleared as soon as data flows again.
4. A clean stream that produced no answer text now pushes an `error` bubble and runs bookkeeping (previously it desynced from the server).

- [ ] **Step 1: Add failing e2e tests to `e2e/ai.spec.ts`**

Add inside the existing `test.describe('ask the rules (chat)', ...)` block, after the `'Enter sends...'` test:

```ts
	test('mid-stream error event keeps the partial answer and shows a retryable error', async ({
		page
	}) => {
		await signUpTestUser(page, 'chat-err');
		await page.route('**/api/ai/chat', (route) =>
			route.fulfill({
				...CHAT_STREAM('mock-convo-err', 'mock-msg-err'),
				body: '{"t":"text","text":"Partial answer per [15.D]. "}\n{"t":"error"}\n'
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/partial answer per/i)).toBeVisible();
		await expect(page.getByText(/this answer was cut short/i)).toBeVisible();
		await expect(page.getByText(/ran into a problem/i)).toBeVisible();
		await expect(page).toHaveURL(/\/ask\/mock-convo-err$/); // bookkeeping still ran
	});

	test('error event with no answer text shows the unavailable bubble', async ({ page }) => {
		await signUpTestUser(page, 'chat-err-empty');
		await page.route('**/api/ai/chat', (route) =>
			route.fulfill({
				...CHAT_STREAM('mock-convo-err2', 'mock-msg-err2'),
				body: '{"t":"think","text":"**Stuck**"}\n{"t":"error"}\n'
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/no answer — the assistant was unavailable/i)).toBeVisible();
		await expect(page.getByText(/ran into a problem/i)).toBeVisible();
	});

	test('stop button aborts the stream and settles back to idle', async ({ page }) => {
		await signUpTestUser(page, 'chat-stop');
		await page.route('**/api/ai/chat', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 3000));
			// The client may have aborted while we slept — fulfilling then throws; ignore it.
			await route.fulfill(CHAT_STREAM('mock-convo-stop', 'mock-msg-stop')).catch(() => {});
		});
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
		await expect(stopButton).toBeVisible();
		await stopButton.click();
		await expect(page.getByText('Stopped.')).toBeVisible();
		await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible();
		await expect(page.getByText('Is it a stall at ten?')).toBeVisible(); // user bubble kept
	});
```

- [ ] **Step 2: Run the new e2e tests to verify they fail**

Run: `npx playwright test e2e/ai.spec.ts -g "error event|stop button"`
Expected: FAIL — no Stop button exists, error events are ignored so no error copy renders.

- [ ] **Step 3: Rewrite the `+page.svelte` script section**

Replace the entire `<script lang="ts">` block of `src/routes/ask/[[id]]/+page.svelte` with:

```svelte
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
				errorMessage = 'Stopped.';
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
```

- [ ] **Step 4: Update the template — stall hint and Stop button**

4a. In the `{#if phase === 'streaming'}` block of the messages section, add the stall hint after the existing thinking-indicator/`AskAnswer` conditional (i.e. just before that block's `{/if}`):

```svelte
			{#if stalled}
				<p class="text-xs text-navy/50 italic">Taking longer than usual — you can stop and ask again.</p>
			{/if}
```

4b. Replace the submit `<button type="submit" ...>...</button>` element in the form with a streaming-aware pair (the Send branch is the existing button with `phase === 'streaming'` dropped from its `disabled` expression, since Send is not rendered while streaming):

```svelte
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
```

- [ ] **Step 5: Verify**

Run: `npm run check` then `npx playwright test e2e/ai.spec.ts`
Expected: no type errors; ALL ai.spec tests pass — the three new ones and every pre-existing one (regression check on the send flow refactor).

- [ ] **Step 6: Commit**

```bash
git add src/routes/ask/[[id]]/+page.svelte e2e/ai.spec.ts
git commit -m "feat: chat stop button, stall hint, and in-band stream error handling"
```

---

## Final verification (after all tasks)

- [ ] `npm run test` — full unit suite passes
- [ ] `npm run check` — no svelte-check errors
- [ ] `npm run lint` — prettier clean (run `npm run format` if not)
- [ ] `npx playwright test e2e/ai.spec.ts` — chat e2e green
