import { json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import type { SyncState } from '$lib/quiz/payload';
import { questionResponses, quizAttempts } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

const MAX_RESPONSES = 2000; // mirrors the localStorage cap in $lib/quiz/storage

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const rulesetId = event.url.searchParams.get('ruleset') ?? DEFAULT_RULESET_ID;
	const db = event.locals.db;

	const rows = await db
		.select({
			questionId: questionResponses.questionId,
			sectionSlug: questionResponses.sectionSlug,
			correct: questionResponses.correct,
			at: questionResponses.at
		})
		.from(questionResponses)
		.where(and(eq(questionResponses.userId, user.id), eq(questionResponses.rulesetId, rulesetId)))
		.orderBy(desc(questionResponses.at), desc(questionResponses.id))
		.limit(MAX_RESPONSES);
	rows.reverse(); // chronological, as the local cache expects

	const bestRows = await db
		.select({
			score: quizAttempts.score,
			bestStreak: quizAttempts.bestStreak,
			createdAt: quizAttempts.createdAt
		})
		.from(quizAttempts)
		.where(
			and(
				eq(quizAttempts.userId, user.id),
				eq(quizAttempts.rulesetId, rulesetId),
				eq(quizAttempts.mode, 'timed')
			)
		)
		.orderBy(desc(quizAttempts.score), desc(quizAttempts.bestStreak))
		.limit(1);
	const best = bestRows[0];

	const state: SyncState = {
		responses: rows,
		timedBest: best
			? { score: best.score, bestStreak: best.bestStreak ?? 0, at: best.createdAt }
			: null
	};
	return json(state);
};
