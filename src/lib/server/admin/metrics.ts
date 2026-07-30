import { and, count, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { aiMessages, aiQuestions, aiUsage, quizAttempts, user } from '$lib/server/db/schema';
import { fillDailyBuckets, ratio, utcDay } from './metrics-math';

export type DashboardMetrics = {
	rangeDays: number;
	// Same four metrics in both columns: audience, engaged audience, and the two features.
	totals: { users: number; activeUsers: number; quizAttempts: number; asks: number };
	recent: {
		newUsers: number;
		activeUsers: number;
		quizAttempts: number;
		asks: number;
		asksToday: number;
	};
	quizByMode: { mode: string; count: number }[];
	// All four are bad-outcome rates over the range window; lower is better.
	aiQuality: {
		down: number;
		downRate: number;
		errorRate: number;
		truncatedRate: number;
		answerTotal: number;
		fallback: number;
		fallbackRate: number;
		questionTotal: number;
	};
	dailyActive: { day: string; count: number }[];
	dailySignups: { day: string; count: number }[];
};

const DAY = 86_400_000;

// Both app tables store plain epoch-ms integers; `user.created_at` is drizzle
// `timestamp_ms`, which is the same storage, so this expression buckets both.
const dayBucket = (column: string) =>
	sql.raw(`strftime('%Y-%m-%d', "${column}" / 1000, 'unixepoch')`);

export async function loadDashboardMetrics(
	db: Db,
	nowMs: number,
	rangeDays: number
): Promise<DashboardMetrics> {
	const sinceMs = nowMs - rangeDays * DAY;
	const today = utcDay(nowMs);
	const sinceDay = utcDay(sinceMs);

	const one = async (q: Promise<{ c: number }[]>) => (await q)[0]?.c ?? 0;
	const c = (col = sql`*`) => ({ c: count(col) });
	const total = async (q: Promise<{ total: number }[]>) => Number((await q)[0]?.total ?? 0);
	const askSum = (dayFilter: SQL) =>
		db
			.select({ total: sql<number>`coalesce(sum(${aiUsage.count}), 0)` })
			.from(aiUsage)
			.where(and(eq(aiUsage.kind, 'ask'), dayFilter));

	const [
		users,
		quizTotal,
		newUsers,
		quizByMode,
		activeAll,
		activeWindow,
		dailyActiveRows,
		dailySignupRows,
		recentQuizAttempts,
		asksAllRows,
		asksRangeTotal,
		asksTodayTotal,
		assistant,
		down,
		questions
	] = await Promise.all([
		// Totals
		one(db.select(c()).from(user)),
		one(db.select(c()).from(quizAttempts)),
		one(
			db
				.select(c())
				.from(user)
				.where(gte(user.createdAt, new Date(sinceMs)))
		),
		db
			.select({ mode: quizAttempts.mode, count: count() })
			.from(quizAttempts)
			.groupBy(quizAttempts.mode),
		// Active users (all-time): distinct user ids across quiz play + AI usage.
		// `union` (not `union all`) does the deduping SQLite-side.
		db.get<{ c: number }>(sql`
			select count(*) as c from (
				select "user_id" from "quiz_attempts"
				union
				select "user_id" from "ai_usage"
			)
		`),
		// Active users (windowed): same union, restricted to the range.
		db.get<{ c: number }>(sql`
			select count(*) as c from (
				select "user_id" from "quiz_attempts" where "created_at" >= ${sinceMs}
				union
				select "user_id" from "ai_usage" where "day" >= ${sinceDay}
			)
		`),
		// Daily active: distinct (day, user) pairs across both sources, grouped by day.
		// Rows outside `rangeDays` (this window can start mid-day) are dropped by
		// fillDailyBuckets below — a pre-existing quirk this rewrite preserves.
		db.all<{ day: string; c: number }>(sql`
			select "day", count(*) as c from (
				select ${dayBucket('created_at')} as "day", "user_id"
				from "quiz_attempts" where "created_at" >= ${sinceMs}
				union
				select "day", "user_id" from "ai_usage" where "day" >= ${sinceDay}
			)
			group by "day"
		`),
		// Sign-ups per day.
		db.all<{ day: string; c: number }>(sql`
			select ${dayBucket('created_at')} as "day", count(*) as c
			from "user"
			where "created_at" >= ${sinceMs}
			group by "day"
		`),
		one(db.select(c()).from(quizAttempts).where(gte(quizAttempts.createdAt, sinceMs))),
		// Questions asked (all-time): summed ask counters
		db
			.select({ total: sql<number>`coalesce(sum(${aiUsage.count}), 0)` })
			.from(aiUsage)
			.where(eq(aiUsage.kind, 'ask')),
		total(askSum(gte(aiUsage.day, sinceDay))),
		total(askSum(eq(aiUsage.day, today))),
		// AI quality (windowed)
		db
			.select({ status: aiMessages.status, count: count() })
			.from(aiMessages)
			.where(and(eq(aiMessages.role, 'assistant'), gte(aiMessages.createdAt, sinceMs)))
			.groupBy(aiMessages.status),
		one(
			db
				.select(c())
				.from(aiMessages)
				.where(
					and(
						eq(aiMessages.role, 'assistant'),
						eq(aiMessages.feedback, 'down'),
						gte(aiMessages.createdAt, sinceMs)
					)
				)
		),
		db
			.select({ status: aiQuestions.status, count: count() })
			.from(aiQuestions)
			.where(gte(aiQuestions.createdAt, sinceMs))
			.groupBy(aiQuestions.status)
	]);

	const toRecord = (rows: { day: string; c: number }[]) =>
		Object.fromEntries(rows.map((r) => [r.day, r.c]));

	// AI quality tallies
	const byStatus = (rows: { status: string | null; count: number }[], key: string) =>
		rows.find((r) => r.status === key)?.count ?? 0;
	const answerTotal = assistant.reduce((s, r) => s + r.count, 0);
	const truncated = byStatus(assistant, 'truncated');
	const errored = byStatus(assistant, 'error');
	const questionTotal = questions.reduce((s, r) => s + r.count, 0);
	const fallback = questions.find((r) => r.status === 'fallback')?.count ?? 0;

	return {
		rangeDays,
		totals: {
			users,
			activeUsers: activeAll?.c ?? 0,
			quizAttempts: quizTotal,
			asks: Number(asksAllRows[0]?.total ?? 0)
		},
		recent: {
			newUsers,
			activeUsers: activeWindow?.c ?? 0,
			quizAttempts: recentQuizAttempts,
			asks: asksRangeTotal,
			asksToday: asksTodayTotal
		},
		quizByMode,
		aiQuality: {
			down,
			downRate: ratio(down, answerTotal),
			errorRate: ratio(errored, answerTotal),
			truncatedRate: ratio(truncated, answerTotal),
			answerTotal,
			fallback,
			fallbackRate: ratio(fallback, questionTotal),
			questionTotal
		},
		dailyActive: fillDailyBuckets(toRecord(dailyActiveRows), rangeDays, nowMs),
		dailySignups: fillDailyBuckets(toRecord(dailySignupRows), rangeDays, nowMs)
	};
}
