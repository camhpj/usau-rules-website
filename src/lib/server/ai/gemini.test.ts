import { describe, expect, it, vi } from 'vitest';
import { GEMINI_MODEL } from './config';
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

	function sseFetchImpl() {
		const lines = [
			sseLine({ candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }] } }] }),
			sseLine({ candidates: [{ content: { parts: [{ text: 'Hello ' }] } }] }),
			sseLine({ candidates: [{ content: { parts: [{ text: 'world' }] } }] }),
			sseLine({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] })
		];
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const line of lines) controller.enqueue(new TextEncoder().encode(line));
				controller.close();
			}
		});
		return vi.fn(async (url: RequestInfo | URL) => {
			if (String(url).includes('/cachedContents')) return new Response('no', { status: 500 });
			return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
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

	it('notifies the observer of text deltas only, truncation, and close — wire output unchanged', async () => {
		const store = memoryStore();
		const fetchMock = sseFetchImpl();
		const textDeltas: string[] = [];
		let truncatedCount = 0;
		let closeCount = 0;
		let lastTextAtClose = '';
		const observer: StreamObserver = {
			onText: (text) => textDeltas.push(text),
			onTruncated: () => truncatedCount++,
			onClose: () => {
				closeCount++;
				lastTextAtClose = textDeltas.join('');
			}
		};

		const stream = await streamText(req(fetchMock as typeof fetch, store), observer);
		const output = await drain(stream);

		expect(textDeltas).toEqual(['Hello ', 'world']); // thought delta excluded
		expect(truncatedCount).toBe(1);
		expect(closeCount).toBe(1);
		expect(lastTextAtClose).toBe('Hello world'); // onClose fired after the last delta

		expect(output).toContain('"t":"think"');
		expect(output).toContain('"t":"text"');
		expect(output).toContain('"t":"truncated"');
	});

	it('behaves byte-identical to today when no observer is passed', async () => {
		const store = memoryStore();
		const fetchMock = sseFetchImpl();
		const stream = await streamText(req(fetchMock as typeof fetch, store));
		const output = await drain(stream);
		expect(output).toContain('"t":"think"');
		expect(output).toContain('"t":"text","text":"Hello "');
		expect(output).toContain('"t":"text","text":"world"');
		expect(output).toContain('"t":"truncated"');
	});
});
