import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import {
	ChatPayloadSchema,
	ChatRetryPayloadSchema,
	CONVERSATION_MESSAGE_CAP,
	deriveTitle
} from '$lib/ai/payload';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import {
	pickRetryTarget,
	statusForStream,
	toGeminiTurns,
	type RetryTarget
} from '$lib/server/ai/chat';
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
	const db = event.locals.db;

	// Discriminate retry bodies ({conversationId, retry: true}) from normal sends.
	const raw = await event.request.json().catch(() => null);
	const retryParse = ChatRetryPayloadSchema.safeParse(raw);
	let userMessage: string | null = null; // null in retry mode
	let bodyRulesetId: string | undefined;
	let existingId: string | null;
	if (retryParse.success) {
		existingId = retryParse.data.conversationId;
	} else {
		const parsed = ChatPayloadSchema.safeParse(raw);
		if (!parsed.success) error(400, 'invalid message');
		userMessage = parsed.data.message;
		bodyRulesetId = parsed.data.rulesetId;
		existingId = parsed.data.conversationId ?? null;
	}

	// Resolve the conversation: existing (owner-scoped, not deleted) or new.
	let rulesetId: string;
	let priorTurns: { role: 'user' | 'model'; text: string }[] = [];
	let retryTarget: RetryTarget | null = null;
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
			.select({
				id: aiMessages.id,
				role: aiMessages.role,
				content: aiMessages.content,
				status: aiMessages.status
			})
			.from(aiMessages)
			.where(eq(aiMessages.conversationId, existingId))
			.orderBy(asc(aiMessages.createdAt));
		if (retryParse.success) {
			retryTarget = pickRetryTarget(prior);
			if (!retryTarget) error(400, 'Nothing to retry in this conversation');
			priorTurns = toGeminiTurns(retryTarget.prior);
		} else {
			if (prior.length >= CONVERSATION_MESSAGE_CAP)
				error(400, 'This conversation is full — start a new one');
			priorTurns = toGeminiTurns(prior);
		}
	} else {
		// A retry body always carries a conversationId, so a retry can never
		// reach this branch — userMessage is non-null by construction here.
		rulesetId = bodyRulesetId ?? DEFAULT_RULESET_ID;
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
	// so even a failed generation leaves an accurate transcript. A retry instead
	// deletes the failed row it's regenerating; persistAssistant below writes its
	// replacement under the same fresh id.
	const now = Date.now();
	const conversationId = existingId ?? crypto.randomUUID();
	if (retryTarget) {
		await db.delete(aiMessages).where(eq(aiMessages.id, retryTarget.errorRowId));
	} else {
		if (!existingId) {
			await db.insert(aiConversations).values({
				id: conversationId,
				userId: user.id,
				rulesetId,
				title: deriveTitle(userMessage!),
				createdAt: now,
				updatedAt: now
			});
		}
		await db.insert(aiMessages).values({
			id: crypto.randomUUID(),
			conversationId,
			role: 'user',
			content: userMessage!,
			createdAt: now
		});
	}

	const assistantMessageId = crypto.randomUUID();
	let answerText = '';
	// Persistence must never break the stream; failures are reported and swallowed.
	const persistAssistant = async (status: 'complete' | 'truncated' | 'error' | null) => {
		try {
			const at = Date.now();
			if (status !== null) {
				await db.insert(aiMessages).values({
					id: assistantMessageId,
					conversationId,
					role: 'assistant',
					content: status === 'error' ? '' : answerText,
					status,
					model: GEMINI_MODEL,
					createdAt: at
				});
			}
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
		onClose: (outcome: StreamOutcome) => {
			// A client disconnect cancels the stream mid-request; waitUntil keeps
			// the isolate alive until the transcript row is persisted.
			const persisted = persistAssistant(statusForStream(outcome, answerText));
			event.platform?.ctx?.waitUntil?.(persisted);
			return persisted;
		}
	};

	const geminiRequest = {
		apiKey: env.GEMINI_API_KEY!,
		store: d1CacheStore(db),
		rulesetId,
		systemPolicy: systemPolicy(rulesetId),
		grounding,
		priorTurns,
		taskPrompt: buildAskPrompt(retryTarget ? retryTarget.question : userMessage!),
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

	// The response body is the stream itself, so a client disconnect (Stop,
	// reload, tab close) propagates as cancellation: Gemini stops generating
	// and onClose persists only the text produced so far.
	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store',
			'x-bp-conversation-id': conversationId,
			'x-bp-message-id': assistantMessageId,
			'x-bp-ai-remaining': String(decision.remaining)
		}
	});
};
