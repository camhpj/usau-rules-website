import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { bookmarks, questionResponses, quizAttempts, user } from '$lib/server/db/schema';

/** Mirrors the localStorage cap in $lib/quiz/storage. */
export const MAX_RESPONSES = 2000;

export interface ResponseHistoryRow {
	questionId: string;
	sectionSlug: string;
	correct: boolean;
	at: number;
}

/**
 * Fetches up to `MAX_RESPONSES` of a user's question responses for a ruleset, oldest first.
 * Every caller (mastery computation, the local-cache sync payload) needs chronological order,
 * so this fetches newest-first (indexed by `question_responses_user_ruleset_at_idx`) and
 * reverses in memory rather than sorting ascending, which would require D1 to scan the full
 * set before the limit could trim it.
 */
export async function fetchResponseHistory(
	db: Db,
	userId: string,
	rulesetId: string
): Promise<ResponseHistoryRow[]> {
	const rows = await db
		.select({
			questionId: questionResponses.questionId,
			sectionSlug: questionResponses.sectionSlug,
			correct: questionResponses.correct,
			at: questionResponses.at
		})
		.from(questionResponses)
		.where(and(eq(questionResponses.userId, userId), eq(questionResponses.rulesetId, rulesetId)))
		.orderBy(desc(questionResponses.at), desc(questionResponses.id))
		.limit(MAX_RESPONSES);
	return rows.reverse();
}

export interface TimedBestRow {
	score: number;
	bestStreak: number | null;
	createdAt: number;
}

/**
 * Fetches a user's single best timed-mode attempt for a ruleset — highest score, ties broken
 * by streak — or null if they have none.
 */
export async function fetchTimedBest(
	db: Db,
	userId: string,
	rulesetId: string
): Promise<TimedBestRow | null> {
	const rows = await db
		.select({
			score: quizAttempts.score,
			bestStreak: quizAttempts.bestStreak,
			createdAt: quizAttempts.createdAt
		})
		.from(quizAttempts)
		.where(
			and(
				eq(quizAttempts.userId, userId),
				eq(quizAttempts.rulesetId, rulesetId),
				eq(quizAttempts.mode, 'timed')
			)
		)
		.orderBy(desc(quizAttempts.score), desc(quizAttempts.bestStreak))
		.limit(1);
	return rows[0] ?? null;
}

export interface BookmarkRow {
	rulesetId: string;
	ruleId: string;
	createdAt: number;
}

/** Fetches all of a user's bookmarks, across every ruleset, most recently created first. */
export async function fetchBookmarks(db: Db, userId: string): Promise<BookmarkRow[]> {
	return db
		.select({
			rulesetId: bookmarks.rulesetId,
			ruleId: bookmarks.ruleId,
			createdAt: bookmarks.createdAt
		})
		.from(bookmarks)
		.where(eq(bookmarks.userId, userId))
		.orderBy(desc(bookmarks.createdAt));
}

export interface DisplayNameState {
	displayName: string | null;
	name: string;
}

/** Fetches a user's stored display name and account name, or null if the user row is missing. */
export async function fetchDisplayNameState(
	db: Db,
	userId: string
): Promise<DisplayNameState | null> {
	const rows = await db
		.select({ displayName: user.displayName, name: user.name })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return rows[0] ?? null;
}
