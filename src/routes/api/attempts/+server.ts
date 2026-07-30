import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AttemptPayloadSchema } from '$lib/quiz/payload';
import { parseJsonBody, requireDb } from '$lib/server/http';
import { recordAttempt } from '$lib/server/quiz/record-attempt';
import { bankById, verifyResponses } from '$lib/server/quiz/verify';
import { requireUser } from '$lib/server/session';

// Clock skew allowance for a client whose time runs ahead of the server's.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const payload = await parseJsonBody(
		event.request,
		AttemptPayloadSchema,
		'invalid attempt payload'
	);

	const now = Date.now();
	if (payload.startedAt > now + CLOCK_SKEW_MS) error(400, 'startedAt is in the future');
	if (payload.responses.some((r) => r.at > now + CLOCK_SKEW_MS)) {
		error(400, 'response timestamp is in the future');
	}

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

	const db = requireDb(event.locals);
	const score = result.verified.filter((r) => r.correct).length;
	const { id, duplicate } = await recordAttempt(db, {
		attemptId: crypto.randomUUID(),
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
		createdAt: Date.now(),
		responses: result.verified
	});
	if (duplicate) return json({ id, duplicate: true }, { status: 409 });
	return json({ id }, { status: 201 });
};
