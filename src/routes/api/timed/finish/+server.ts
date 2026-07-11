import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { TIMED_DURATION_S, TIMED_GRACE_S, TimedFinishPayloadSchema } from '$lib/quiz/payload';
import { questionResponses, quizAttempts } from '$lib/server/db/schema';
import { verifyRunToken } from '$lib/server/quiz/run-token';
import { bankById, recomputeTimed, verifyResponses } from '$lib/server/quiz/verify';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const parsed = TimedFinishPayloadSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid timed payload');
	const payload = parsed.data;

	const claims = await verifyRunToken(payload.token, event.platform!.env.BETTER_AUTH_SECRET);
	if (!claims || claims.userId !== user.id) error(400, 'invalid run token');
	const now = Date.now();
	const elapsedMs = now - claims.startedAt;
	if (elapsedMs < 1000 || elapsedMs > (TIMED_DURATION_S + TIMED_GRACE_S) * 1000) {
		error(400, 'run outside the time window');
	}

	const bank = bankById(payload.rulesetId);
	if (bank.size === 0) error(400, 'unknown ruleset');
	const result = verifyResponses(payload.responses, bank, now);
	if (!result.ok) error(400, result.reason);
	const { score, bestStreak } = recomputeTimed(result.verified);

	const db = event.locals.db;
	const clientId = `timed:${claims.runId}`;
	const dup = await db
		.select({ id: quizAttempts.id })
		.from(quizAttempts)
		.where(eq(quizAttempts.clientId, clientId))
		.limit(1);
	if (dup.length > 0) return json({ id: dup[0].id, duplicate: true }, { status: 409 });

	const id = crypto.randomUUID();
	try {
		await db.batch([
			db.insert(quizAttempts).values({
				id,
				userId: user.id,
				clientId,
				rulesetId: payload.rulesetId,
				mode: 'timed',
				sectionSlug: null,
				score,
				total: result.verified.length,
				bestStreak,
				startedAt: claims.startedAt,
				durationS: Math.min(TIMED_DURATION_S, Math.round(elapsedMs / 1000)),
				createdAt: now
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
	} catch (err) {
		// Two concurrent finishes for the same run can both pass the dup check
		// above; the loser trips the unique index on quiz_attempts.client_id.
		// Re-check for the winner's row and surface the contract's 409 instead
		// of letting the raw insert error bubble up as a 500.
		const raceDup = await db
			.select({ id: quizAttempts.id })
			.from(quizAttempts)
			.where(eq(quizAttempts.clientId, clientId))
			.limit(1);
		if (raceDup.length > 0) {
			return json({ id: raceDup[0].id, duplicate: true }, { status: 409 });
		}
		throw err;
	}
	return json({ score, bestStreak }, { status: 201 });
};
