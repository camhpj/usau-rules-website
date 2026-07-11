import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { AttemptPayloadSchema } from '$lib/quiz/payload';
import { questionResponses, quizAttempts } from '$lib/server/db/schema';
import { bankById, verifyResponses } from '$lib/server/quiz/verify';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const parsed = AttemptPayloadSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid attempt payload');
	const payload = parsed.data;

	const bank = bankById(payload.rulesetId);
	if (bank.size === 0) error(400, 'unknown ruleset');
	const result = verifyResponses(payload.responses, bank);
	if (!result.ok) error(400, result.reason);

	if (
		payload.sectionSlug !== null &&
		result.verified.some((r) => r.sectionSlug !== payload.sectionSlug)
	) {
		error(400, 'sectionSlug does not match the answered questions');
	}

	const db = event.locals.db;
	const dup = await db
		.select({ id: quizAttempts.id })
		.from(quizAttempts)
		.where(eq(quizAttempts.clientId, payload.clientId))
		.limit(1);
	if (dup.length > 0) return json({ id: dup[0].id, duplicate: true }, { status: 409 });

	const id = crypto.randomUUID();
	const score = result.verified.filter((r) => r.correct).length;
	await db.batch([
		db.insert(quizAttempts).values({
			id,
			userId: user.id,
			clientId: payload.clientId,
			rulesetId: payload.rulesetId,
			mode: payload.mode,
			sectionSlug: payload.sectionSlug,
			score,
			total: result.verified.length,
			bestStreak: null,
			startedAt: payload.startedAt,
			durationS: payload.durationS,
			createdAt: Date.now()
		}),
		db.insert(questionResponses).values(
			result.verified.map((r) => ({
				attemptId: id,
				userId: user.id,
				rulesetId: payload.rulesetId,
				questionId: r.questionId,
				sectionSlug: r.sectionSlug,
				choiceIndex: r.choiceIndex,
				correct: r.correct,
				at: r.at
			}))
		)
	]);
	return json({ id }, { status: 201 });
};
