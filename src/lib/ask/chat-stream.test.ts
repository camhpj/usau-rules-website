import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatStream, MAX_CONCURRENT_STREAMS, type SendResult } from './chat-stream.svelte';
import { conversations } from './conversations.svelte';

// `chat-stream.svelte.ts` exports only the `chatStream` singleton usefully —
// `ChatStreamState` itself has no `export` keyword, so tests share one
// instance (see conversations.svelte.ts, which is a real singleton too) and
// must reset its mutable state by hand, the same way ask-page.test.ts does.
beforeEach(() => {
	chatStream.jobs.clear();
	chatStream.completed.clear();
	chatStream.remaining = null;
	conversations.reset();
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const encoder = new TextEncoder();

/** Drains pending microtasks (e.g. a mocked fetch's resolved-promise chain)
 * without depending on real elapsed time. Safe to call while fake timers are
 * active — Promise resolution isn't part of what vitest's fake timers fake. */
async function flush(times = 6): Promise<void> {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

/** A one-shot NDJSON body built from an explicit chunk array, so the test —
 * not the runtime — decides exactly where each chunk boundary falls. */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		}
	});
}

function ndjsonResponse(
	chunks: string[],
	init: { status?: number; headers?: Record<string, string> } = {}
): Response {
	return new Response(streamFromChunks(chunks), {
		status: init.status ?? 200,
		headers: init.headers
	});
}

/** A body the test can push into and close/error on its own schedule, for
 * cases that must observe state mid-stream: stall timers, stop(), drops. */
function controlledStream(): {
	body: ReadableStream<Uint8Array>;
	push: (chunk: string) => void;
	close: () => void;
	error: (err: unknown) => void;
} {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const body = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		}
	});
	return {
		body,
		push: (chunk) => controller.enqueue(encoder.encode(chunk)),
		close: () => controller.close(),
		error: (err) => controller.error(err)
	};
}

const errorResponse = (status: number, body: Record<string, unknown> | null = null): Response =>
	new Response(body ? JSON.stringify(body) : '', { status });

describe('send() pre-flight rejections', () => {
	it('refuses a second send for a conversation that already has one in flight', async () => {
		fetchMock.mockReturnValueOnce(new Promise(() => {})); // never settles
		void chatStream.send('first', { conversationId: 'conv-1', viewToken: Symbol() });

		const result = await chatStream.send('second', {
			conversationId: 'conv-1',
			viewToken: Symbol()
		});

		expect(result).toEqual<SendResult>({
			kind: 'rejected',
			message: 'This conversation is already answering — wait for it to finish.'
		});
		expect(fetchMock).toHaveBeenCalledTimes(1); // the second send never hit the network
	});

	it(`refuses a ${MAX_CONCURRENT_STREAMS + 1}th concurrent send once MAX_CONCURRENT_STREAMS is reached`, async () => {
		fetchMock.mockReturnValue(new Promise(() => {})); // keep every job "in flight"
		for (let i = 0; i < MAX_CONCURRENT_STREAMS; i++) {
			void chatStream.send(`msg ${i}`, { conversationId: `conv-${i}`, viewToken: Symbol() });
		}
		expect(chatStream.jobs.size).toBe(MAX_CONCURRENT_STREAMS);

		const result = await chatStream.send('one more', {
			conversationId: 'conv-extra',
			viewToken: Symbol()
		});

		expect(result).toEqual<SendResult>({
			kind: 'rejected',
			message: 'You have too many answers streaming — wait for one to finish.'
		});
		expect(chatStream.jobs.size).toBe(MAX_CONCURRENT_STREAMS); // the 4th never got a job
	});
});

describe('send() error status branches (verbatim user-facing strings)', () => {
	it.each([
		[429, 'Slow down — try again in a moment.'],
		[400, 'That question is too long.'],
		[409, 'This conversation already has an answer in flight.']
	])('status %i uses the server-provided message when present', async (status, serverMessage) => {
		fetchMock.mockResolvedValueOnce(errorResponse(status, { message: serverMessage }));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({ kind: 'failed', message: serverMessage });
	});

	it('falls back to a generic message for 429/400/409 when the server sends none', async () => {
		fetchMock.mockResolvedValueOnce(errorResponse(400));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({
			kind: 'failed',
			message: 'That message could not be sent.'
		});
	});

	it('503 reports the AI-offline message', async () => {
		fetchMock.mockResolvedValueOnce(errorResponse(503));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({
			kind: 'failed',
			message: 'AI features are offline right now.'
		});
	});

	it('401 reports the session-expired message', async () => {
		fetchMock.mockResolvedValueOnce(errorResponse(401));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({
			kind: 'failed',
			message: 'Your session expired — sign in again.'
		});
	});

	it('404 reports the conversation-not-found message', async () => {
		fetchMock.mockResolvedValueOnce(errorResponse(404));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({
			kind: 'failed',
			message: 'Conversation not found — start a new chat.'
		});
	});

	it('an unrecognized status falls back to the generic unavailable message', async () => {
		fetchMock.mockResolvedValueOnce(errorResponse(500));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({
			kind: 'failed',
			message: 'The rules assistant is unavailable — try again in a minute.'
		});
	});
});

describe('send() parses the NDJSON body', () => {
	// THE MOST VALUABLE TEST: a single JSON line delivered across two chunks,
	// split mid-string (after `{"t":"te`), must parse exactly once. A
	// line-splitter that assumes each chunk is a whole line fails this — see
	// task-2-report.md Step 3 for the failure message a mutation produced.
	it('parses a JSON line split across two chunk boundaries exactly once', async () => {
		fetchMock.mockResolvedValueOnce(ndjsonResponse(['{"t":"te', 'xt","text":"Hello world"}\n']));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({ kind: 'done', message: null });
		const completed = chatStream.completed.get('conv-1');
		expect(completed?.content).toBe('Hello world');
		expect(completed?.status).toBe('complete');
	});

	// Case 2: the opposite edge of the same buffering logic — a trailing line
	// with no newline terminator, only ever handled after the read loop ends.
	it('handles a trailing line with no newline terminator at stream end', async () => {
		fetchMock.mockResolvedValueOnce(ndjsonResponse(['{"t":"text","text":"partial"}']));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({ kind: 'done', message: null });
		expect(chatStream.completed.get('conv-1')?.content).toBe('partial');
	});

	it('ignores malformed JSON and unrecognized message types, keeping "think" text separate from the answer', async () => {
		fetchMock.mockResolvedValueOnce(
			ndjsonResponse([
				// Three lines land in one chunk, exercising the while-loop's
				// multi-line-per-chunk split, not just the single-line case above.
				'not json at all\n{"t":"think","text":"pondering"}\n{"t":"mystery","text":"nope"}\n',
				'{"t":"text","text":"answer"}\n'
			])
		);

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({ kind: 'done', message: null });
		expect(chatStream.completed.get('conv-1')?.content).toBe('answer');
	});

	it('a {t:"truncated"} fragment surfaces as truncated, not success', async () => {
		fetchMock.mockResolvedValueOnce(
			ndjsonResponse(['{"t":"text","text":"partial"}\n', '{"t":"truncated"}\n'])
		);

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({
			kind: 'done',
			message: 'The answer was cut short — try asking again.'
		});
		expect(chatStream.completed.get('conv-1')).toMatchObject({
			status: 'truncated',
			content: 'partial'
		});
	});

	it('a server-signaled error after partial text finishes as truncated, with a try-again message', async () => {
		fetchMock.mockResolvedValueOnce(
			ndjsonResponse(['{"t":"text","text":"partial"}\n', '{"t":"error"}\n'])
		);

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({
			kind: 'done',
			message: 'The assistant ran into a problem — try asking again.'
		});
		expect(chatStream.completed.get('conv-1')).toMatchObject({
			status: 'truncated',
			content: 'partial'
		});
	});

	it('a server-signaled error with no text finishes as an error bubble with no composer message', async () => {
		fetchMock.mockResolvedValueOnce(ndjsonResponse(['{"t":"error"}\n']));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({ kind: 'done', message: null });
		expect(chatStream.completed.get('conv-1')).toMatchObject({ status: 'error', content: '' });
	});

	it('an empty stream with no error and no text still finishes as an error bubble', async () => {
		fetchMock.mockResolvedValueOnce(ndjsonResponse([]));

		const result = await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(result).toEqual<SendResult>({ kind: 'done', message: null });
		expect(chatStream.completed.get('conv-1')).toMatchObject({ status: 'error', content: '' });
	});
});

describe('send() applies response headers', () => {
	it('resolves a new conversation to the id/message-id headers and adopts the remaining-quota header', async () => {
		fetchMock.mockResolvedValueOnce(
			ndjsonResponse(['{"t":"text","text":"hi"}\n'], {
				headers: {
					'x-bp-ai-remaining': '7',
					'x-bp-conversation-id': 'conv-new',
					'x-bp-message-id': 'srv-msg-1'
				}
			})
		);

		const result = await chatStream.send('Hello', { conversationId: null, viewToken: Symbol() });

		expect(result).toEqual<SendResult>({ kind: 'done', message: null });
		expect(chatStream.remaining).toBe(7);
		const completed = chatStream.completed.get('conv-new');
		expect(completed?.id).toBe('srv-msg-1');
		expect(completed?.content).toBe('hi');
		// The optimistic `new-<uuid>` sidebar entry was swapped for the real id.
		expect(conversations.list.some((c) => c.id === 'conv-new')).toBe(true);
		expect(conversations.list.some((c) => c.id.startsWith('new-'))).toBe(false);
	});

	it('touches an existing conversation instead of resolving one, when the id was already known', async () => {
		conversations.list = [{ id: 'conv-1', title: 'Existing', updatedAt: 0 }];
		fetchMock.mockResolvedValueOnce(
			ndjsonResponse(['{"t":"text","text":"hi"}\n'], {
				headers: { 'x-bp-conversation-id': 'conv-1' }
			})
		);

		await chatStream.send('Hello', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(conversations.list[0].id).toBe('conv-1');
		expect(conversations.list[0].updatedAt).toBeGreaterThan(0);
	});

	it('ignores an unparsable ai-remaining header instead of corrupting existing state', async () => {
		chatStream.remaining = 42;
		fetchMock.mockResolvedValueOnce(
			ndjsonResponse(['{"t":"text","text":"hi"}\n'], {
				headers: { 'x-bp-ai-remaining': 'not-a-number' }
			})
		);

		await chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });

		expect(chatStream.remaining).toBe(42);
	});
});

describe('send() stall watchdog (fake timers — no real elapsed time)', () => {
	it('fires after no data arrives within the stall budget', async () => {
		vi.useFakeTimers();
		const { body, push, close } = controlledStream();
		fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));

		const pending = chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });
		await flush();
		const job = chatStream.jobFor('conv-1');
		expect(job).not.toBeNull();
		expect(job!.stalled).toBe(false);

		await vi.advanceTimersByTimeAsync(20_000);
		expect(job!.stalled).toBe(true);

		push('{"t":"text","text":"hi"}\n');
		close();
		await pending;
	});

	it('does not fire while data keeps arriving before the budget elapses', async () => {
		vi.useFakeTimers();
		const { body, push, close } = controlledStream();
		fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));

		const pending = chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });
		await flush();
		const job = chatStream.jobFor('conv-1')!;

		await vi.advanceTimersByTimeAsync(19_000);
		expect(job.stalled).toBe(false);

		push('{"t":"text","text":"a"}\n'); // rearms the 20s timer
		await flush();

		await vi.advanceTimersByTimeAsync(19_000); // 38s total, but the timer was rearmed at 19s
		expect(job.stalled).toBe(false);

		close();
		await flush();
		await pending;
	});
});

describe('send() abort and connection drops', () => {
	it('stop() mid-stream leaves partial text and reports a stopped-by-user outcome, not an error', async () => {
		const { body, push, error } = controlledStream();
		fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));

		const pending = chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });
		await flush();
		const job = chatStream.jobFor('conv-1')!;

		push('{"t":"text","text":"partial answer"}\n');
		await flush();
		chatStream.stop(job);
		// A real fetch ties the body's reads to the abort signal; this fetch is
		// mocked, so the abort is simulated by erroring the body directly. The
		// source only inspects `job.controller.signal.aborted`, not the error.
		error(new Error('stream aborted'));

		const result = await pending;

		expect(result).toEqual<SendResult>({ kind: 'done', message: null });
		expect(chatStream.completed.get('conv-1')).toMatchObject({
			status: 'truncated',
			content: 'partial answer'
		});
	});

	it('stop() before any text arrives settles quietly with no message and no parked bubble', async () => {
		const { body, error } = controlledStream();
		fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));

		const pending = chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });
		await flush();
		const job = chatStream.jobFor('conv-1')!;

		chatStream.stop(job);
		error(new Error('stream aborted'));

		const result = await pending;

		expect(result).toEqual<SendResult>({ kind: 'done', message: null });
		expect(chatStream.completed.has('conv-1')).toBe(false);
	});

	it('a connection drop mid-stream after partial text keeps what arrived, without discarding it as an error', async () => {
		const { body, push, error } = controlledStream();
		fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));

		const pending = chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });
		await flush();
		push('{"t":"text","text":"partial"}\n');
		await flush();
		error(new Error('mid-stream drop')); // not preceded by stop(): signal stays un-aborted

		const result = await pending;

		expect(result).toEqual<SendResult>({
			kind: 'done',
			message: 'The connection dropped mid-answer — what arrived is shown above.'
		});
		expect(chatStream.completed.get('conv-1')).toMatchObject({
			status: 'truncated',
			content: 'partial'
		});
	});

	it('a connection drop right after headers, before any text, asks the user to reload', async () => {
		const { body, error } = controlledStream();
		fetchMock.mockResolvedValueOnce(
			new Response(body, { status: 200, headers: { 'x-bp-message-id': 'srv-msg-1' } })
		);

		const pending = chatStream.send('Hi', { conversationId: 'conv-1', viewToken: Symbol() });
		await flush();
		error(new Error('mid-stream drop'));

		const result = await pending;

		expect(result).toEqual<SendResult>({
			kind: 'done',
			message: 'The connection dropped — reload to see what was saved.'
		});
	});

	it('a network error before the fetch resolves reports a generic failure and rolls back the optimistic sidebar entry', async () => {
		fetchMock.mockRejectedValueOnce(new Error('offline'));

		const result = await chatStream.send('Hi', { conversationId: null, viewToken: Symbol() });

		expect(result).toEqual<SendResult>({ kind: 'failed', message: 'Network error — try again.' });
		expect(conversations.list).toHaveLength(0);
	});
});
