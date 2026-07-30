import { and, asc, count, desc, eq, gt, lt, or } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import {
	aiConversations,
	aiMessages,
	aiUsage,
	questionResponses,
	quizAttempts,
	user
} from '$lib/server/db/schema';
import { pageRows } from '$lib/server/ai/history';

/** Opaque paging cursor: the sort-column value(s) of the last row on the previous page, in
 *  the same order as the dataset's ORDER BY. Callers pass back whatever `next` they got. */
export type Cursor = readonly unknown[];

export type DatasetDef = {
	label: string;
	columns: string[];
	rows: (
		db: Db,
		after: Cursor | null,
		limit: number
	) => Promise<{ rows: unknown[][]; next: Cursor | null }>;
	count: (db: Db) => Promise<number>;
};

const total = async (db: Db, table: Parameters<Db['select']>[0] extends never ? never : any) =>
	((await db.select({ c: count() }).from(table))[0]?.c ?? 0) as number;

export const DATASETS: Record<string, DatasetDef> = {
	conversations: {
		label: 'Conversations',
		columns: ['id', 'userId', 'rulesetId', 'title', 'createdAt', 'updatedAt', 'deletedAt'],
		// Sorted by (updated_at, id), not created_at: ai_conversations has no created_at
		// index. Task 4 built ai_conversations_updated_id_idx (updated_at, id) for the admin
		// feed's cursor, and updated_at — last-message time — is a reasonable "most recent
		// activity" ordering for an export too, so this reuses that index rather than sorting
		// on an unindexed column.
		//
		// Hazard unique to this dataset: updated_at is mutable, unlike every other dataset's
		// sort column. If a conversation still ahead of the cursor gets a new message while an
		// export is streaming, its updated_at jumps past the cursor into the already-emitted
		// region, and that run misses it silently — a concurrent write on the other five
		// datasets only ever lands at the head, past whatever the export has already read.
		// Accepted: the export window is seconds, this is a single-admin tool, and sorting by
		// created_at instead would mean a full scan and sort per page on the one table that
		// can't be indexed for it without touching schema.ts.
		rows: async (db, after, limit) => {
			const cursor = after as readonly [number, string] | null;
			const raw = await db
				.select()
				.from(aiConversations)
				.where(
					cursor
						? or(
								lt(aiConversations.updatedAt, cursor[0]),
								and(eq(aiConversations.updatedAt, cursor[0]), lt(aiConversations.id, cursor[1]))
							)!
						: undefined
				)
				.orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
				.limit(limit + 1);
			const { items, hasMore } = pageRows(raw, limit);
			const last = items.at(-1);
			return {
				rows: items.map((r) => [
					r.id,
					r.userId,
					r.rulesetId,
					r.title,
					r.createdAt,
					r.updatedAt,
					r.deletedAt
				]),
				next: hasMore && last ? [last.updatedAt, last.id] : null
			};
		},
		count: (db) => total(db, aiConversations)
	},
	messages: {
		label: 'Messages',
		columns: [
			'id',
			'conversationId',
			'role',
			'content',
			'status',
			'model',
			'feedback',
			'createdAt'
		],
		// Sorted by (created_at, id). ai_messages_created_idx (created_at) makes the sort
		// seekable; id only needs to break ties among rows sharing a millisecond, which the
		// planner resolves as a residual filter over that (typically tiny) slice.
		rows: async (db, after, limit) => {
			const cursor = after as readonly [number, string] | null;
			const raw = await db
				.select()
				.from(aiMessages)
				.where(
					cursor
						? or(
								lt(aiMessages.createdAt, cursor[0]),
								and(eq(aiMessages.createdAt, cursor[0]), lt(aiMessages.id, cursor[1]))
							)!
						: undefined
				)
				.orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
				.limit(limit + 1);
			const { items, hasMore } = pageRows(raw, limit);
			const last = items.at(-1);
			return {
				rows: items.map((r) => [
					r.id,
					r.conversationId,
					r.role,
					r.content,
					r.status,
					r.model,
					r.feedback,
					r.createdAt
				]),
				next: hasMore && last ? [last.createdAt, last.id] : null
			};
		},
		count: (db) => total(db, aiMessages)
	},
	'quiz-attempts': {
		label: 'Quiz attempts',
		columns: [
			'id',
			'userId',
			'rulesetId',
			'mode',
			'sectionSlug',
			'score',
			'total',
			'bestStreak',
			'startedAt',
			'durationS',
			'createdAt'
		],
		// Sorted by (created_at, id), seekable via quiz_attempts_created_idx.
		rows: async (db, after, limit) => {
			const cursor = after as readonly [number, string] | null;
			const raw = await db
				.select()
				.from(quizAttempts)
				.where(
					cursor
						? or(
								lt(quizAttempts.createdAt, cursor[0]),
								and(eq(quizAttempts.createdAt, cursor[0]), lt(quizAttempts.id, cursor[1]))
							)!
						: undefined
				)
				.orderBy(desc(quizAttempts.createdAt), desc(quizAttempts.id))
				.limit(limit + 1);
			const { items, hasMore } = pageRows(raw, limit);
			const last = items.at(-1);
			return {
				rows: items.map((r) => [
					r.id,
					r.userId,
					r.rulesetId,
					r.mode,
					r.sectionSlug,
					r.score,
					r.total,
					r.bestStreak,
					r.startedAt,
					r.durationS,
					r.createdAt
				]),
				next: hasMore && last ? [last.createdAt, last.id] : null
			};
		},
		count: (db) => total(db, quizAttempts)
	},
	'question-responses': {
		label: 'Question responses',
		columns: [
			'id',
			'attemptId',
			'userId',
			'rulesetId',
			'questionId',
			'sectionSlug',
			'choiceIndex',
			'correct',
			'at'
		],
		// Sorted by (at, id), seekable via question_responses_at_idx.
		rows: async (db, after, limit) => {
			const cursor = after as readonly [number, number] | null;
			const raw = await db
				.select()
				.from(questionResponses)
				.where(
					cursor
						? or(
								lt(questionResponses.at, cursor[0]),
								and(eq(questionResponses.at, cursor[0]), lt(questionResponses.id, cursor[1]))
							)!
						: undefined
				)
				.orderBy(desc(questionResponses.at), desc(questionResponses.id))
				.limit(limit + 1);
			const { items, hasMore } = pageRows(raw, limit);
			const last = items.at(-1);
			return {
				rows: items.map((r) => [
					r.id,
					r.attemptId,
					r.userId,
					r.rulesetId,
					r.questionId,
					r.sectionSlug,
					r.choiceIndex,
					r.correct,
					r.at
				]),
				next: hasMore && last ? [last.at, last.id] : null
			};
		},
		count: (db) => total(db, questionResponses)
	},
	users: {
		label: 'Users',
		columns: ['id', 'email', 'name', 'displayName', 'createdAt'],
		// Sorted by (created_at, id), seekable via user_created_idx. created_at is a
		// timestamp_ms column (JS Date), so the cursor carries a Date, not a number.
		rows: async (db, after, limit) => {
			const cursor = after as readonly [Date, string] | null;
			const raw = await db
				.select({
					id: user.id,
					email: user.email,
					name: user.name,
					displayName: user.displayName,
					createdAt: user.createdAt
				})
				.from(user)
				.where(
					cursor
						? or(
								lt(user.createdAt, cursor[0]),
								and(eq(user.createdAt, cursor[0]), lt(user.id, cursor[1]))
							)!
						: undefined
				)
				.orderBy(desc(user.createdAt), desc(user.id))
				.limit(limit + 1);
			const { items, hasMore } = pageRows(raw, limit);
			const last = items.at(-1);
			return {
				rows: items.map((r) => [r.id, r.email, r.name, r.displayName, r.createdAt?.getTime()]),
				next: hasMore && last ? [last.createdAt, last.id] : null
			};
		},
		count: (db) => total(db, user)
	},
	'ai-usage': {
		label: 'AI usage (daily counters)',
		columns: ['day', 'userId', 'kind', 'count'],
		// ai_usage has no single-column primary key — its key is (day, user_id, kind) — so the
		// tie-break needs both remaining key columns, not just one. Sorted by day desc (newest
		// first, seekable via ai_usage_day_idx), then user_id/kind ascending purely to give
		// same-day rows a total, deterministic order.
		rows: async (db, after, limit) => {
			const cursor = after as readonly [string, string, 'ask' | 'scenario'] | null;
			const raw = await db
				.select()
				.from(aiUsage)
				.where(
					cursor
						? or(
								lt(aiUsage.day, cursor[0]),
								and(eq(aiUsage.day, cursor[0]), gt(aiUsage.userId, cursor[1])),
								and(
									eq(aiUsage.day, cursor[0]),
									eq(aiUsage.userId, cursor[1]),
									gt(aiUsage.kind, cursor[2])
								)
							)!
						: undefined
				)
				.orderBy(desc(aiUsage.day), asc(aiUsage.userId), asc(aiUsage.kind))
				.limit(limit + 1);
			const { items, hasMore } = pageRows(raw, limit);
			const last = items.at(-1);
			return {
				rows: items.map((r) => [r.day, r.userId, r.kind, r.count]),
				next: hasMore && last ? [last.day, last.userId, last.kind] : null
			};
		},
		count: (db) => total(db, aiUsage)
	}
};

export type DatasetCount = { slug: string; label: string; count: number };

/** The six dataset row counts, run in parallel. Callers on a hot path (the export page loads
 *  this on every view) should cache the result — see admin/export/+page.server.ts. */
export async function listDatasetCounts(db: Db): Promise<DatasetCount[]> {
	return Promise.all(
		Object.entries(DATASETS).map(async ([slug, def]) => ({
			slug,
			label: def.label,
			count: await def.count(db)
		}))
	);
}
