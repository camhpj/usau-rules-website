import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TIMED_DURATION_S, TIMED_GRACE_S, TimedFinishPayloadSchema } from '$lib/quiz/payload';
import { parseJsonBody, requireDb } from '$lib/server/http';
import { recordAttempt } from '$lib/server/quiz/record-attempt';
import { verifyRunToken } from '$lib/server/quiz/run-token';
import { bankById, recomputeTimed, verifyResponses } from '$lib/server/quiz/verify';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const payload = await parseJsonBody(
		event.request,
		TimedFinishPayloadSchema,
		'invalid timed payload'
	);

	const claims = await verifyRunToken(payload.token, event.platform!.env.BETTER_AUTH_SECRET);
	if (!claims || claims.userId !== user.id) error(400, 'invalid run token');
	if (claims.rulesetId !== payload.rulesetId) error(400, 'run token bound to a different ruleset');
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

	const db = requireDb(event.locals);
	const clientId = `timed:${claims.runId}`;
	const { duplicate, id } = await recordAttempt(db, {
		attemptId: crypto.randomUUID(),
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
		createdAt: now,
		responses: result.verified
	});
	if (duplicate) return json({ id, duplicate: true }, { status: 409 });
	return json({ score, bestStreak }, { status: 201 });
};
