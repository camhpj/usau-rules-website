import { count, desc } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import {
	aiConversations,
	aiMessages,
	aiUsage,
	questionResponses,
	quizAttempts,
	user
} from '$lib/server/db/schema';

export const EXPORT_MAX_ROWS = 10_000;

export type DatasetDef = {
	label: string;
	columns: string[];
	rows: (db: Db, limit: number) => Promise<unknown[][]>;
	count: (db: Db) => Promise<number>;
};

const total = async (db: Db, table: Parameters<Db['select']>[0] extends never ? never : any) =>
	((await db.select({ c: count() }).from(table))[0]?.c ?? 0) as number;

export const DATASETS: Record<string, DatasetDef> = {
	conversations: {
		label: 'Conversations',
		columns: ['id', 'userId', 'rulesetId', 'title', 'createdAt', 'updatedAt', 'deletedAt'],
		rows: (db, limit) =>
			db
				.select()
				.from(aiConversations)
				.orderBy(desc(aiConversations.createdAt))
				.limit(limit)
				.then((rs) =>
					rs.map((r) => [
						r.id,
						r.userId,
						r.rulesetId,
						r.title,
						r.createdAt,
						r.updatedAt,
						r.deletedAt
					])
				),
		count: (db) => total(db, aiConversations)
	},
	messages: {
		label: 'Messages (with feedback)',
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
		rows: (db, limit) =>
			db
				.select()
				.from(aiMessages)
				.orderBy(desc(aiMessages.createdAt))
				.limit(limit)
				.then((rs) =>
					rs.map((r) => [
						r.id,
						r.conversationId,
						r.role,
						r.content,
						r.status,
						r.model,
						r.feedback,
						r.createdAt
					])
				),
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
		rows: (db, limit) =>
			db
				.select()
				.from(quizAttempts)
				.orderBy(desc(quizAttempts.createdAt))
				.limit(limit)
				.then((rs) =>
					rs.map((r) => [
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
					])
				),
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
		rows: (db, limit) =>
			db
				.select()
				.from(questionResponses)
				.orderBy(desc(questionResponses.at))
				.limit(limit)
				.then((rs) =>
					rs.map((r) => [
						r.id,
						r.attemptId,
						r.userId,
						r.rulesetId,
						r.questionId,
						r.sectionSlug,
						r.choiceIndex,
						r.correct,
						r.at
					])
				),
		count: (db) => total(db, questionResponses)
	},
	users: {
		label: 'Users',
		columns: ['id', 'email', 'name', 'displayName', 'createdAt'],
		rows: (db, limit) =>
			db
				.select({
					id: user.id,
					email: user.email,
					name: user.name,
					displayName: user.displayName,
					createdAt: user.createdAt
				})
				.from(user)
				.orderBy(desc(user.createdAt))
				.limit(limit)
				.then((rs) =>
					rs.map((r) => [r.id, r.email, r.name, r.displayName, r.createdAt?.getTime()])
				),
		count: (db) => total(db, user)
	},
	'ai-usage': {
		label: 'AI usage (daily counters)',
		columns: ['day', 'userId', 'kind', 'count'],
		rows: (db, limit) =>
			db
				.select()
				.from(aiUsage)
				.orderBy(desc(aiUsage.day))
				.limit(limit)
				.then((rs) => rs.map((r) => [r.day, r.userId, r.kind, r.count])),
		count: (db) => total(db, aiUsage)
	}
};
