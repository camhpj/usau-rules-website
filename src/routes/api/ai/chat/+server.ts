import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { ChatPayloadSchema, CONVERSATION_MESSAGE_CAP, deriveTitle } from '$lib/ai/payload';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { statusForStream, toGeminiTurns } from '$lib/server/ai/chat';
import { AI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from '$lib/server/ai/config';
import { d1CacheStore, streamText, type StreamOutcome } from '$lib/server/ai/gemini';
import { groundingFor } from '$lib/server/ai/grounding';
import { aiAvailable, consumeQuota, d1UsageStore } from '$lib/server/ai/guardrails';
import { buildAskPrompt, systemPolicy } from '$lib/server/ai/prompts';
import { aiConversations, aiMessages } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const env = event.platform?.env;
	if (!env || !aiAvailable(env)) error(503, 'AI features are currently offline');
	const parsed = ChatPayloadSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid message');
	const db = event.locals.db;

	// Resolve the conversation: existing (owner-scoped, not deleted) or new.
	let rulesetId: string;
	let priorTurns: { role: 'user' | 'model'; text: string }[] = [];
	const existingId = parsed.data.conversationId ?? null;
	if (existingId) {
		const convos = await db
			.select({ id: aiConversations.id, rulesetId: aiConversations.rulesetId })
			.from(aiConversations)
			.where(
				and(
					eq(aiConversations.id, existingId),
					eq(aiConversations.userId, user.id),
					isNull(aiConversations.deletedAt)
				)
			)
			.limit(1);
		if (!convos[0]) error(404, 'conversation not found'); // no existence oracle
		rulesetId = convos[0].rulesetId; // body rulesetId is ignored for existing conversations
		const prior = await db
			.select({ role: aiMessages.role, content: aiMessages.content, status: aiMessages.status })
			.from(aiMessages)
			.where(eq(aiMessages.conversationId, existingId))
			.orderBy(asc(aiMessages.createdAt));
		if (prior.length >= CONVERSATION_MESSAGE_CAP)
			error(400, 'This conversation is full — start a new one');
		priorTurns = toGeminiTurns(prior);
	} else {
		rulesetId = parsed.data.rulesetId ?? DEFAULT_RULESET_ID;
	}
	const grounding = groundingFor(rulesetId);
	if (!grounding) error(400, 'unknown ruleset');

	const decision = await consumeQuota(d1UsageStore(db), user.id, 'ask', Date.now());
	if (!decision.allowed) {
		error(
			429,
			decision.reason === 'user-cap'
				? 'Daily question limit reached — try again tomorrow'
				: 'The daily AI budget is used up — try again tomorrow'
		);
	}

	// Persist the conversation (if new) and the user message BEFORE calling Gemini,
	// so even a failed generation leaves an accurate transcript.
	const now = Date.now();
	const conversationId = existingId ?? crypto.randomUUID();
	if (!existingId) {
		await db.insert(aiConversations).values({
			id: conversationId,
			userId: user.id,
			rulesetId,
			title: deriveTitle(parsed.data.message),
			createdAt: now,
			updatedAt: now
		});
	}
	await db.insert(aiMessages).values({
		id: crypto.randomUUID(),
		conversationId,
		role: 'user',
		content: parsed.data.message,
		createdAt: now
	});

	const assistantMessageId = crypto.randomUUID();
	let answerText = '';
	// Persistence must never break the stream; failures are reported and swallowed.
	const persistAssistant = async (status: 'complete' | 'truncated' | 'error') => {
		try {
			const at = Date.now();
			await db.insert(aiMessages).values({
				id: assistantMessageId,
				conversationId,
				role: 'assistant',
				content: status === 'error' ? '' : answerText,
				status,
				model: GEMINI_MODEL,
				createdAt: at
			});
			await db
				.update(aiConversations)
				.set({ updatedAt: at })
				.where(eq(aiConversations.id, conversationId));
		} catch (cause) {
			console.error('chat: failed to persist assistant message', cause);
		}
	};
	const observer = {
		onText: (t: string) => (answerText += t),
		onClose: (outcome: StreamOutcome) => persistAssistant(statusForStream(outcome, answerText))
	};

	const geminiRequest = {
		apiKey: env.GEMINI_API_KEY!,
		store: d1CacheStore(db),
		rulesetId,
		systemPolicy: systemPolicy(rulesetId),
		grounding,
		priorTurns,
		taskPrompt: buildAskPrompt(parsed.data.message),
		generationConfig: {
			temperature: 0.3,
			maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
			// See the 2026-07-13 owner decision on the old ask endpoint: 'medium' bounds
			// worst-case thinking-tail latency while staying adaptive.
			thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true }
		}
	};

	// Spec: failure → one retry → apologetic error. Retries only help before the stream opens.
	let stream: ReadableStream<Uint8Array>;
	try {
		stream = await streamText(geminiRequest, observer);
	} catch {
		try {
			stream = await streamText(geminiRequest, observer);
		} catch (cause) {
			console.error('chat: streamText failed after retry', cause);
			await persistAssistant('error');
			error(502, 'The rules assistant is unavailable right now — try again in a minute');
		}
	}

	// Tee so the upstream Gemini stream is always fully consumed server-side:
	// flush()/onClose persistence must run even if the client disconnects mid-answer.
	const [clientBranch, drainBranch] = stream.tee();
	const drained = drainBranch.pipeTo(new WritableStream()).catch(() => {});
	event.platform?.ctx?.waitUntil?.(drained);

	return new Response(clientBranch, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store',
			'x-bp-conversation-id': conversationId,
			'x-bp-message-id': assistantMessageId,
			'x-bp-ai-remaining': String(decision.remaining)
		}
	});
};
