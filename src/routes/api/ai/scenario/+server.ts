import { error, json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { ScenarioRequestSchema } from '$lib/ai/payload';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { ruleIdSet } from '$lib/content/rule-id-sets';
import { listQuestions } from '$lib/quiz/bank';
import { AI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from '$lib/server/ai/config';
import { d1CacheStore, generateText } from '$lib/server/ai/gemini';
import { groundingFor } from '$lib/server/ai/grounding';
import { aiAvailable, consumeQuota, d1UsageStore } from '$lib/server/ai/guardrails';
import { systemPolicy } from '$lib/server/ai/prompts';
import { buildScenarioPrompt, draftToQuestion, validateScenario } from '$lib/server/ai/scenario';
import { aiQuestions } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const env = event.platform?.env;
	if (!env || !aiAvailable(env)) error(503, 'AI features are currently offline');
	const parsed = ScenarioRequestSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid scenario request');
	const rulesetId = parsed.data.rulesetId ?? DEFAULT_RULESET_ID;
	const grounding = groundingFor(rulesetId);
	const ruleIds = ruleIdSet(rulesetId);
	const bank = listQuestions(rulesetId);
	if (!grounding || ruleIds.size === 0 || bank.length === 0) error(400, 'unknown ruleset');

	const db = event.locals.db;
	const decision = await consumeQuota(d1UsageStore(db), user.id, 'scenario', Date.now());
	if (!decision.allowed) {
		error(
			429,
			decision.reason === 'user-cap'
				? 'Daily scenario limit reached — try again tomorrow'
				: 'The daily AI budget is used up — try again tomorrow'
		);
	}

	// Variety nudge: avoid this user's recent scenarios (their own rows only).
	const recent = await db
		.select({ question: aiQuestions.question })
		.from(aiQuestions)
		.where(
			and(
				eq(aiQuestions.userId, user.id),
				eq(aiQuestions.status, 'served'),
				eq(aiQuestions.rulesetId, rulesetId)
			)
		)
		.orderBy(desc(aiQuestions.createdAt))
		.limit(8);
	const avoid = recent.flatMap((row) => {
		try {
			return [(JSON.parse(row.question ?? '') as { prompt: string }).prompt];
		} catch {
			return [];
		}
	});

	const geminiRequest = {
		apiKey: env.GEMINI_API_KEY!,
		store: d1CacheStore(db),
		rulesetId,
		systemPolicy: systemPolicy(rulesetId),
		grounding,
		taskPrompt: buildScenarioPrompt(parsed.data.difficulty, avoid),
		generationConfig: {
			responseMimeType: 'application/json',
			temperature: 0.9,
			maxOutputTokens: AI_MAX_OUTPUT_TOKENS
		}
	};

	const reasons: string[] = [];
	for (let attempt = 0; attempt < 2; attempt++) {
		let raw: unknown;
		try {
			raw = JSON.parse(await generateText(geminiRequest));
		} catch (cause) {
			reasons.push(`attempt ${attempt + 1}: ${(cause as Error).message.slice(0, 200)}`);
			continue;
		}
		const result = validateScenario(raw, ruleIds);
		if (!result.ok) {
			reasons.push(`attempt ${attempt + 1}: ${result.reason}`);
			continue;
		}
		const question = draftToQuestion(result.draft, rulesetId);
		await db.insert(aiQuestions).values({
			id: question.id.slice('ai-'.length),
			userId: user.id,
			rulesetId,
			model: GEMINI_MODEL,
			status: 'served',
			question: JSON.stringify(question),
			rejectedReasons: reasons.length > 0 ? reasons.join(' | ') : null,
			requestedDifficulty: parsed.data.difficulty ?? null,
			createdAt: Date.now()
		});
		return json({ source: 'ai', question, remaining: decision.remaining });
	}

	// Both attempts failed — fall back to the bank (spec: validate → retry → fallback).
	const pool = parsed.data.difficulty
		? bank.filter((q) => q.difficulty === parsed.data.difficulty)
		: bank;
	const candidates = pool.length > 0 ? pool : bank;
	const fallback = candidates[Math.floor(Math.random() * candidates.length)];
	await db.insert(aiQuestions).values({
		id: crypto.randomUUID(),
		userId: user.id,
		rulesetId,
		model: GEMINI_MODEL,
		status: 'fallback',
		question: null,
		rejectedReasons: reasons.join(' | '),
		requestedDifficulty: parsed.data.difficulty ?? null,
		createdAt: Date.now()
	});
	return json({ source: 'fallback', question: fallback, remaining: decision.remaining });
};
