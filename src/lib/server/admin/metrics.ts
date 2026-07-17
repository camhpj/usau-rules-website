import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { ASK_DAILY_PER_USER } from '$lib/server/ai/config';
import {
	aiConversations,
	aiMessages,
	aiQuestions,
	aiUsage,
	quizAttempts,
	user
} from '$lib/server/db/schema';
import { fillDailyBuckets, ratio, utcDay } from './metrics-math';

export type DashboardMetrics = {
	totals: { users: number; conversations: number; messages: number; quizAttempts: number };
	recent: { newUsers7d: number; quizAttempts7d: number; asksToday: number; asks7d: number };
	quizByMode: { mode: string; count: number }[];
	feedback: { up: number; down: number; downRatio: number };
	answerHealth: { truncatedRate: number; errorRate: number; assistantTotal: number };
	questionHealth: { fallbackRate: number; total: number };
	quotaHits7d: number;
	dailyAsks: { day: string; count: number }[];
	dailySignups: { day: string; count: number }[];
};

const DAY = 86_400_000;

export async function loadDashboardMetrics(db: Db, nowMs: number): Promise<DashboardMetrics> {
	const since7dMs = nowMs - 7 * DAY;
	const since14dMs = nowMs - 14 * DAY;
	const today = utcDay(nowMs);
	const since7dDay = utcDay(since7dMs);
	const since14dDay = utcDay(since14dMs);

	const one = async (q: Promise<{ c: number }[]>) => (await q)[0]?.c ?? 0;
	const c = (col = sql`*`) => ({ c: count(col) });

	const [
		users,
		conversations,
		messages,
		quizTotal,
		newUsers7d,
		quiz7d,
		quizByMode,
		fb,
		assistant,
		questions,
		usageRows,
		signupRows
	] = await Promise.all([
		one(db.select(c()).from(user)),
		one(db.select(c()).from(aiConversations)),
		one(db.select(c()).from(aiMessages)),
		one(db.select(c()).from(quizAttempts)),
		one(
			db
				.select(c())
				.from(user)
				.where(gte(user.createdAt, new Date(since7dMs)))
		),
		one(db.select(c()).from(quizAttempts).where(gte(quizAttempts.createdAt, since7dMs))),
		db
			.select({ mode: quizAttempts.mode, count: count() })
			.from(quizAttempts)
			.groupBy(quizAttempts.mode),
		db
			.select({ feedback: aiMessages.feedback, count: count() })
			.from(aiMessages)
			.where(sql`${aiMessages.feedback} is not null`)
			.groupBy(aiMessages.feedback),
		db
			.select({ status: aiMessages.status, count: count() })
			.from(aiMessages)
			.where(eq(aiMessages.role, 'assistant'))
			.groupBy(aiMessages.status),
		db
			.select({ status: aiQuestions.status, count: count() })
			.from(aiQuestions)
			.groupBy(aiQuestions.status),
		db
			.select({ day: aiUsage.day, total: sql<number>`sum(${aiUsage.count})` })
			.from(aiUsage)
			.where(and(eq(aiUsage.kind, 'ask'), gte(aiUsage.day, since14dDay)))
			.groupBy(aiUsage.day),
		db
			.select({
				day: sql<string>`strftime('%Y-%m-%d', ${user.createdAt} / 1000, 'unixepoch')`,
				total: count()
			})
			.from(user)
			.where(gte(user.createdAt, new Date(since14dMs)))
			.groupBy(sql`1`)
	]);

	// asks today / 7d from ai_usage (kind='ask')
	const [asksTodayRows, asks7dRows] = await Promise.all([
		db
			.select({ total: sql<number>`coalesce(sum(${aiUsage.count}), 0)` })
			.from(aiUsage)
			.where(and(eq(aiUsage.kind, 'ask'), eq(aiUsage.day, today))),
		db
			.select({ total: sql<number>`coalesce(sum(${aiUsage.count}), 0)` })
			.from(aiUsage)
			.where(and(eq(aiUsage.kind, 'ask'), gte(aiUsage.day, since7dDay)))
	]);

	// quota hits (7d): per-user-day ask rows at/over the cap
	const quotaHitsRows = await db
		.select({ c: count() })
		.from(aiUsage)
		.where(
			and(
				eq(aiUsage.kind, 'ask'),
				gte(aiUsage.day, since7dDay),
				gte(aiUsage.count, ASK_DAILY_PER_USER)
			)
		);

	const byStatus = (rows: { status: string | null; count: number }[], key: string) =>
		rows.find((r) => r.status === key)?.count ?? 0;
	const up = fb.find((r) => r.feedback === 'up')?.count ?? 0;
	const down = fb.find((r) => r.feedback === 'down')?.count ?? 0;
	const assistantTotal = assistant.reduce((s, r) => s + r.count, 0);
	const truncated = byStatus(assistant, 'truncated');
	const errored = byStatus(assistant, 'error');
	const qTotal = questions.reduce((s, r) => s + r.count, 0);
	const fallback = questions.find((r) => r.status === 'fallback')?.count ?? 0;

	const asksByDay: Record<string, number> = {};
	for (const r of usageRows) asksByDay[r.day] = Number(r.total);
	const signupsByDay: Record<string, number> = {};
	for (const r of signupRows) signupsByDay[r.day] = Number(r.total);

	return {
		totals: { users, conversations, messages, quizAttempts: quizTotal },
		recent: {
			newUsers7d,
			quizAttempts7d: quiz7d,
			asksToday: Number(asksTodayRows[0]?.total ?? 0),
			asks7d: Number(asks7dRows[0]?.total ?? 0)
		},
		quizByMode,
		feedback: { up, down, downRatio: ratio(down, up + down) },
		answerHealth: {
			truncatedRate: ratio(truncated, assistantTotal),
			errorRate: ratio(errored, assistantTotal),
			assistantTotal
		},
		questionHealth: { fallbackRate: ratio(fallback, qTotal), total: qTotal },
		quotaHits7d: quotaHitsRows[0]?.c ?? 0,
		dailyAsks: fillDailyBuckets(asksByDay, 14, nowMs),
		dailySignups: fillDailyBuckets(signupsByDay, 14, nowMs)
	};
}
