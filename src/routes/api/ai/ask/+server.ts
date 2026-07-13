import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AskPayloadSchema } from '$lib/ai/payload';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { AI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from '$lib/server/ai/config';
import { d1CacheStore, streamText } from '$lib/server/ai/gemini';
import { groundingFor } from '$lib/server/ai/grounding';
import { aiAvailable, consumeQuota, d1UsageStore } from '$lib/server/ai/guardrails';
import { buildAskPrompt, systemPolicy } from '$lib/server/ai/prompts';
import { aiAsks } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const env = event.platform?.env;
	if (!env || !aiAvailable(env)) error(503, 'AI features are currently offline');
	const parsed = AskPayloadSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid question');
	const rulesetId = parsed.data.rulesetId ?? DEFAULT_RULESET_ID;
	const grounding = groundingFor(rulesetId);
	if (!grounding) error(400, 'unknown ruleset');

	const db = event.locals.db;
	const decision = await consumeQuota(d1UsageStore(db), user.id, 'ask', Date.now());
	if (!decision.allowed) {
		error(
			429,
			decision.reason === 'user-cap'
				? 'Daily question limit reached — try again tomorrow'
				: 'The daily AI budget is used up — try again tomorrow'
		);
	}

	const geminiRequest = {
		apiKey: env.GEMINI_API_KEY!,
		store: d1CacheStore(db),
		rulesetId,
		systemPolicy: systemPolicy(rulesetId),
		grounding,
		taskPrompt: buildAskPrompt(parsed.data.prompt),
		generationConfig: {
			temperature: 0.3,
			maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
			// Owner decision 2026-07-13: thinking-depth tail variance at the
			// default-high ceiling produced multi-minute waits once
			// maxOutputTokens went to 65k. 'medium' is still adaptive (levels
			// are ceilings, not fixed budgets) but bounds the worst-case tail.
			thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true }
		}
	};

	// Q&A log for future quality analysis (owner decision): prompt + final answer only,
	// never the thinking summary. Logging must never break the answer, so failures are
	// swallowed after being reported.
	const askId = crypto.randomUUID();
	let answerText = '';
	let truncated = false;
	const logAsk = async (status: 'answered' | 'truncated' | 'error') => {
		try {
			await db.insert(aiAsks).values({
				id: askId,
				userId: user.id,
				rulesetId,
				model: GEMINI_MODEL,
				prompt: parsed.data.prompt,
				answer: status === 'error' ? null : answerText,
				status,
				createdAt: Date.now()
			});
		} catch (cause) {
			console.error('ask: failed to log Q&A', cause); // logging must never break the answer
		}
	};
	const observer = {
		onText: (t: string) => (answerText += t),
		onTruncated: () => (truncated = true),
		onClose: () => logAsk(truncated ? 'truncated' : 'answered')
	};

	// Spec: failure → one retry → apologetic error. Retries only help before the
	// stream opens; once streaming, the client renders whatever arrived.
	let stream: ReadableStream<Uint8Array>;
	try {
		stream = await streamText(geminiRequest, observer);
	} catch {
		try {
			stream = await streamText(geminiRequest, observer);
		} catch (cause) {
			console.error('ask: streamText failed after retry', cause);
			await logAsk('error');
			error(502, 'The rules assistant is unavailable right now — try again in a minute');
		}
	}

	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store',
			'x-bp-ai-remaining': String(decision.remaining)
		}
	});
};
