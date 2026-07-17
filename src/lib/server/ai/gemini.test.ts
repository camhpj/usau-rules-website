import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_STREAM_MAX_MS, AI_STREAM_NO_ANSWER_MAX_MS, GEMINI_MODEL } from './config';
import {
	ensureGroundingCache,
	generateText,
	SseTextExtractor,
	streamText,
	type CacheStore,
	type GeminiRequest,
	type StreamObserver
} from './gemini';

function memoryStore(): CacheStore & { rows: Map<string, { name: string; expiresAt: number }> } {
	const rows = new Map<string, { name: string; expiresAt: number }>();
	return {
		rows,
		async get(key) {
			return rows.get(key) ?? null;
		},
		async put(key, name, expiresAt) {
			rows.set(key, { name, expiresAt });
		},
		async del(key) {
			rows.delete(key);
		}
	};
}

const okJson = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});

const geminiAnswer = (text: string) =>
	okJson({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

function req(fetchImpl: typeof fetch, store: CacheStore, now = 1_000_000): GeminiRequest {
	return {
		apiKey: 'k',
		store,
		rulesetId: 'r',
		systemPolicy: 'POLICY',
		grounding: 'RULEBOOK [1.A] text',
		taskPrompt: 'TASK',
		generationConfig: { temperature: 0 },
		fetchImpl,
		now: () => now
	};
}

describe('ensureGroundingCache', () => {
	it('creates and registers a cache, then reuses it while fresh', async () => {
		const store = memoryStore();
		const fetchMock = vi.fn().mockResolvedValue(okJson({ name: 'cachedContents/abc' }));
		expect(await ensureGroundingCache(req(fetchMock as typeof fetch, store))).toBe(
			'cachedContents/abc'
		);
		expect(store.rows.get(`${GEMINI_MODEL}|r`)?.name).toBe('cachedContents/abc');
		expect(await ensureGroundingCache(req(fetchMock as typeof fetch, store))).toBe(
			'cachedContents/abc'
		);
		expect(fetchMock).toHaveBeenCalledTimes(1); // second call reused the registry row
	});
	it('recreates a stale registration and returns null when creation fails', async () => {
		const store = memoryStore();
		store.rows.set(`${GEMINI_MODEL}|r`, { name: 'cachedContents/old', expiresAt: 1_000_100 }); // < 5 min left
		const fetchMock = vi.fn().mockResolvedValue(okJson({ name: 'cachedContents/new' }));
		expect(await ensureGroundingCache(req(fetchMock as typeof fetch, store))).toBe(
			'cachedContents/new'
		);
		const failing = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
		store.rows.clear();
		expect(await ensureGroundingCache(req(failing as typeof fetch, store))).toBeNull();
	});
});

describe('generateText', () => {
	it('uses the cache, and falls back to inline grounding when cache creation fails', async () => {
		const store = memoryStore();
		const calls: { url: string; body: string }[] = [];
		const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(url), body: String(init?.body ?? '') });
			if (String(url).includes('cachedContents')) return new Response('no', { status: 429 });
			return geminiAnswer('answer [1.A]');
		});
		const text = await generateText(req(fetchMock as typeof fetch, store));
		expect(text).toBe('answer [1.A]');
		const generateCall = calls.find((c) => c.url.includes(':generateContent'));
		expect(generateCall!.body).toContain('RULEBOOK [1.A] text'); // inline fallback carries grounding
		expect(generateCall!.body).not.toContain('cachedContent":');
	});
	it('drops a vanished cache, recreates once, and succeeds', async () => {
		const store = memoryStore();
		store.rows.set(`${GEMINI_MODEL}|r`, { name: 'cachedContents/gone', expiresAt: 999_000_000 });
		let generateCalls = 0;
		const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
			if (String(url).includes('/cachedContents')) return okJson({ name: 'cachedContents/fresh' });
			generateCalls++;
			return generateCalls === 1
				? new Response('{"error":{"message":"cached content not found"}}', { status: 403 })
				: geminiAnswer('recovered');
		});
		expect(await generateText(req(fetchMock as typeof fetch, store))).toBe('recovered');
		expect(store.rows.get(`${GEMINI_MODEL}|r`)?.name).toBe('cachedContents/fresh');
	});
	it('throws on non-STOP finish and on empty text', async () => {
		const store = memoryStore();
		const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
			if (String(url).includes('/cachedContents')) return okJson({ name: 'cachedContents/x' });
			return okJson({
				candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'MAX_TOKENS' }]
			});
		});
		await expect(generateText(req(fetchMock as typeof fetch, store))).rejects.toThrow(/MAX_TOKENS/);
	});
});

describe('priorTurns', () => {
	it('inserts prior turns before the task prompt in the cached body', async () => {
		const store = memoryStore();
		const bodies: Record<string, unknown>[] = [];
		const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			if (String(url).includes('cachedContents')) return okJson({ name: 'cachedContents/abc' });
			return geminiAnswer('ok [1.A]');
		});
		const request = {
			...req(fetchMock as typeof fetch, store),
			priorTurns: [
				{ role: 'user' as const, text: 'Q1' },
				{ role: 'model' as const, text: 'A1' }
			]
		};
		await generateText(request);
		const call = bodies.find((b) => 'cachedContent' in b)!;
		expect(call.contents).toEqual([
			{ role: 'user', parts: [{ text: 'Q1' }] },
			{ role: 'model', parts: [{ text: 'A1' }] },
			{ role: 'user', parts: [{ text: 'TASK' }] }
		]);
	});
});

describe('SseTextExtractor', () => {
	const event = (text: string) =>
		`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;
	it('extracts deltas from complete events', () => {
		const x = new SseTextExtractor();
		expect(x.feed(event('Hello ') + event('world'))).toEqual([
			{ kind: 'delta', text: 'Hello ', thought: false },
			{ kind: 'delta', text: 'world', thought: false }
		]);
	});
	it('buffers events split across chunks (and CRLF)', () => {
		const x = new SseTextExtractor();
		const whole = event('split-safe').replace(/\n/g, '\r\n');
		expect(x.feed(whole.slice(0, 25))).toEqual([]);
		expect(x.feed(whole.slice(25))).toEqual([
			{ kind: 'delta', text: 'split-safe', thought: false }
		]);
	});
	it('marks thought parts and skips non-data lines', () => {
		const x = new SseTextExtractor();
		const chunk =
			': keep-alive\n' +
			`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'shown' }] } }] })}\n\n`;
		expect(x.feed(chunk)).toEqual([
			{ kind: 'delta', text: 'hidden', thought: true },
			{ kind: 'delta', text: 'shown', thought: false }
		]);
	});
	it('emits a finish event after deltas when finishReason is present', () => {
		const x = new SseTextExtractor();
		const chunk = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'MAX_TOKENS' }] })}\n\n`;
		expect(x.feed(chunk)).toEqual([
			{ kind: 'delta', text: 'partial', thought: false },
			{ kind: 'finish', reason: 'MAX_TOKENS' }
		]);
	});
});

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

	it('a throwing onClose observer does not error the output stream', async () => {
		const observer: StreamObserver = {
			onClose: () => {
				throw new Error('persistence exploded');
			}
		};
		const stream = await streamText(
			req(
				fetchWithBody(closedBody([textChunk('done'), finishChunk('STOP')])) as typeof fetch,
				memoryStore()
			),
			observer
		);
		expect(await drain(stream)).toContain('"t":"text","text":"done"'); // drain resolves — stream closed cleanly
	});

	it('converts an upstream mid-stream failure into an in-band error event', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(enc(textChunk('partial ')));
				// Deferred to a macrotask: per the streams spec, error() resets the
				// internal queue, so calling it in the same synchronous tick as
				// enqueue() (before any reader exists) discards the chunk outright —
				// not the "data arrived, then the connection later failed" case this
				// test means to exercise.
				setTimeout(() => controller.error(new Error('upstream died')), 0);
			}
		});
		const { seen, observer } = observing();
		const stream = await streamText(
			req(fetchWithBody(body) as typeof fetch, memoryStore()),
			observer
		);
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
			const stream = await streamText(
				req(fetchWithBody(body) as typeof fetch, memoryStore()),
				observer
			);
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
			const stream = await streamText(
				req(fetchWithBody(body) as typeof fetch, memoryStore()),
				observer
			);
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
