import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { questionResponses, quizAttempts } from '$lib/server/db/schema';
import type { VerifiedResponse } from '$lib/server/quiz/verify';

export interface RecordAttemptInput {
	attemptId: string;
	userId: string;
	clientId: string;
	rulesetId: string;
	mode: 'quick' | 'mastery' | 'timed';
	sectionSlug: string | null;
	score: number;
	total: number;
	bestStreak: number | null;
	startedAt: number;
	durationS: number;
	createdAt: number;
	responses: VerifiedResponse[];
}

export interface RecordAttemptResult {
	id: string;
	duplicate: boolean;
}

async function findByClientId(db: Db, clientId: string): Promise<{ id: string } | null> {
	const rows = await db
		.select({ id: quizAttempts.id })
		.from(quizAttempts)
		.where(eq(quizAttempts.clientId, clientId))
		.limit(1);
	return rows[0] ?? null;
}

function buildWrites(db: Db, input: RecordAttemptInput) {
	return [
		db.insert(quizAttempts).values({
			id: input.attemptId,
			userId: input.userId,
			clientId: input.clientId,
			rulesetId: input.rulesetId,
			mode: input.mode,
			sectionSlug: input.sectionSlug,
			score: input.score,
			total: input.total,
			bestStreak: input.bestStreak,
			startedAt: input.startedAt,
			durationS: input.durationS,
			createdAt: input.createdAt
		}),
		db.insert(questionResponses).values(
			input.responses.map((r) => ({
				attemptId: input.attemptId,
				userId: input.userId,
				rulesetId: input.rulesetId,
				questionId: r.questionId,
				sectionSlug: r.sectionSlug,
				choiceIndex: r.choiceIndex,
				correct: r.correct,
				at: r.at
			}))
		)
	] as const;
}

/**
 * Insert an attempt and its responses, tolerating a duplicate submission.
 *
 * `quiz_attempts.client_id` is unique, but the dedup select and the insert are
 * two round-trips, so concurrent submissions of the same run can both pass the
 * pre-check. The insert loser is resolved by re-querying rather than by
 * matching on the error text: any error from `batch` triggers a re-query, and
 * a found row is treated as the race winner. If no row is found, the original
 * error propagates — a genuine D1 failure must still surface as a failure,
 * not be swallowed as a duplicate.
 *
 * Callers own everything about trust and timing: this helper does not
 * validate `startedAt`/response timestamps against clock skew or any other
 * bound. `/api/attempts` polices client-supplied timestamps against
 * `CLOCK_SKEW_MS` before calling in; `/api/timed/finish` bounds run
 * wall-clock against its signed token's `claims.startedAt` before calling in.
 * Neither check belongs here.
 */
export async function recordAttempt(
	db: Db,
	input: RecordAttemptInput
): Promise<RecordAttemptResult> {
	const existing = await findByClientId(db, input.clientId);
	if (existing) return { id: existing.id, duplicate: true };

	try {
		await db.batch(buildWrites(db, input));
	} catch (err) {
		const winner = await findByClientId(db, input.clientId);
		if (winner) return { id: winner.id, duplicate: true };
		throw err;
	}
	return { id: input.attemptId, duplicate: false };
}
