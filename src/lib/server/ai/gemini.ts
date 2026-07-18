import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { aiCache } from '$lib/server/db/schema';
import {
	AI_STREAM_MAX_MS,
	AI_STREAM_NO_ANSWER_MAX_MS,
	CACHE_MIN_REMAINING_MS,
	CACHE_TTL_S,
	GEMINI_BASE,
	GEMINI_MODEL
} from './config';

/**
 * Thin Gemini REST client with explicit context caching for the rulebook prefix.
 * The cache holds systemInstruction + the full grounding text; per-request contents
 * carry only the task prompt, so the ~46k-token rulebook is billed at the cached
 * rate (~1/10 of standard input). Every path degrades safely: cache-create failure
 * or a vanished cache falls back to sending the grounding inline (correct, pricier).
 */

export interface CacheStore {
	get(key: string): Promise<{ name: string; expiresAt: number } | null>;
	put(key: string, name: string, expiresAt: number): Promise<void>;
	del(key: string): Promise<void>;
}

export function d1CacheStore(db: Db): CacheStore {
	return {
		async get(key) {
			const rows = await db
				.select({ name: aiCache.name, expiresAt: aiCache.expiresAt })
				.from(aiCache)
				.where(eq(aiCache.key, key))
				.limit(1);
			return rows[0] ?? null;
		},
		async put(key, name, expiresAt) {
			await db
				.insert(aiCache)
				.values({ key, name, expiresAt })
				.onConflictDoUpdate({ target: aiCache.key, set: { name, expiresAt } });
		},
		async del(key) {
			await db.delete(aiCache).where(eq(aiCache.key, key));
		}
	};
}

export interface GeminiRequest {
	apiKey: string;
	store: CacheStore;
	rulesetId: string;
	systemPolicy: string;
	grounding: string;
	taskPrompt: string;
	generationConfig: Record<string, unknown>;
	/** Prior conversation turns, oldest first; sent before taskPrompt. */
	priorTurns?: { role: 'user' | 'model'; text: string }[];
	fetchImpl?: typeof fetch; // test seam
	now?: () => number; // test seam
}

const cacheKey = (rulesetId: string) => `${GEMINI_MODEL}|${rulesetId}`;
const userText = (text: string) => ({ role: 'user', parts: [{ text }] });

async function createCache(
	req: GeminiRequest
): Promise<{ name: string; expiresAt: number } | null> {
	const f = req.fetchImpl ?? fetch;
	const now = req.now?.() ?? Date.now();
	const res = await f(`${GEMINI_BASE}/cachedContents`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
		body: JSON.stringify({
			model: `models/${GEMINI_MODEL}`,
			displayName: cacheKey(req.rulesetId),
			systemInstruction: { parts: [{ text: req.systemPolicy }] },
			contents: [userText(req.grounding)],
			ttl: `${CACHE_TTL_S}s`
		})
	}).catch(() => null);
	if (!res?.ok) return null;
	const data = (await res.json()) as { name?: string };
	if (!data.name) return null;
	return { name: data.name, expiresAt: now + CACHE_TTL_S * 1000 };
}

/** Resolve a usable cached-rulebook name, creating/refreshing as needed. Null → call inline. */
export async function ensureGroundingCache(req: GeminiRequest): Promise<string | null> {
	const key = cacheKey(req.rulesetId);
	const now = req.now?.() ?? Date.now();
	const existing = await req.store.get(key);
	if (existing && existing.expiresAt - now > CACHE_MIN_REMAINING_MS) return existing.name;
	const created = await createCache(req);
	if (!created) return null;
	await req.store.put(key, created.name, created.expiresAt);
	return created.name;
}

function buildBody(req: GeminiRequest, cacheName: string | null): Record<string, unknown> {
	const turns = (req.priorTurns ?? []).map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
	// With a cache, systemInstruction/grounding live IN the cache and must not repeat here.
	return cacheName
		? {
				cachedContent: cacheName,
				contents: [...turns, userText(req.taskPrompt)],
				generationConfig: req.generationConfig
			}
		: {
				systemInstruction: { parts: [{ text: req.systemPolicy }] },
				contents: [userText(req.grounding), ...turns, userText(req.taskPrompt)],
				generationConfig: req.generationConfig
			};
}

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

interface GeminiJson {
	candidates?: {
		content?: { parts?: { text?: string; thought?: boolean }[] };
		finishReason?: string;
	}[];
}

/** Non-streaming call; returns the model text. Throws on any upstream failure. */
export async function generateText(req: GeminiRequest): Promise<string> {
	const res = await callWithCacheFallback(req, 'generateContent');
	if (!res.ok) throw new Error(`${res.status} from Gemini: ${(await res.text()).slice(0, 300)}`);
	const data = (await res.json()) as GeminiJson;
	const candidate = data.candidates?.[0];
	const text =
		candidate?.content?.parts
			?.filter((p) => !p.thought)
			.map((p) => p.text ?? '')
			.join('') ?? '';
	if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
		throw new Error(`Gemini stopped with finishReason=${candidate.finishReason}`);
	}
	if (!text) throw new Error('empty response from Gemini');
	return text;
}

export type SseEvent =
	{ kind: 'delta'; text: string; thought: boolean } | { kind: 'finish'; reason: string };

/** Incremental parser for Gemini's `alt=sse` stream: feed raw chunks, get typed events. */
export class SseTextExtractor {
	private buffer = '';

	feed(chunk: string): SseEvent[] {
		this.buffer += chunk;
		const events: SseEvent[] = [];
		let newline: number;
		while ((newline = this.buffer.indexOf('\n')) !== -1) {
			const line = this.buffer.slice(0, newline).replace(/\r$/, '');
			this.buffer = this.buffer.slice(newline + 1);
			if (!line.startsWith('data:')) continue;
			const payload = line.slice(5).trim();
			if (!payload || payload === '[DONE]') continue;
			let data: GeminiJson;
			try {
				data = JSON.parse(payload) as GeminiJson;
			} catch {
				continue; // only complete lines are parsed, so this is a non-JSON data line
			}
			const candidate = data.candidates?.[0];
			for (const part of candidate?.content?.parts ?? []) {
				if (part.text)
					events.push({ kind: 'delta', text: part.text, thought: Boolean(part.thought) });
			}
			if (candidate?.finishReason) events.push({ kind: 'finish', reason: candidate.finishReason });
		}
		return events;
	}
}

export type StreamOutcome = 'complete' | 'truncated' | 'error' | 'cancelled';

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
 * close, so downstream consumers always run to completion. Watchdog: a model
 * stuck generating thoughts never emits answer text, so thought-only time is
 * capped separately from the wall clock. Consumer cancellation (client Stop,
 * reload, tab close) aborts the upstream Gemini request and reports the
 * `'cancelled'` outcome via `onClose`, same as any other stream end.
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
	let consumerCancelled = false;
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
}
