import { and, count, eq, gte, sql } from 'drizzle-orm';
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

	const [
		users,
		quizTotal,
		newUsers,
		quizByMode,
		quizUserIds,
		usageUserIds,
		asksAllRows,
		quizWindow,
		usageWindow,
		signupRows,
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
		// Active users (all-time): distinct user ids across quiz play + AI usage
		db.selectDistinct({ userId: quizAttempts.userId }).from(quizAttempts),
		db.selectDistinct({ userId: aiUsage.userId }).from(aiUsage),
		// Questions asked (all-time): summed ask counters
		db
			.select({ total: sql<number>`coalesce(sum(${aiUsage.count}), 0)` })
			.from(aiUsage)
			.where(eq(aiUsage.kind, 'ask')),
		// Windowed activity rows — drive window active users, daily active, asks range/today, quiz recent
		db
			.select({ userId: quizAttempts.userId, createdAt: quizAttempts.createdAt })
			.from(quizAttempts)
			.where(gte(quizAttempts.createdAt, sinceMs)),
		db
			.select({
				userId: aiUsage.userId,
				day: aiUsage.day,
				kind: aiUsage.kind,
				count: aiUsage.count
			})
			.from(aiUsage)
			.where(gte(aiUsage.day, sinceDay)),
		db
			.select({ createdAt: user.createdAt })
			.from(user)
			.where(gte(user.createdAt, new Date(sinceMs))),
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

	// Active users — all-time distinct union
	const allActive = new Set<string>();
	for (const r of quizUserIds) allActive.add(r.userId);
	for (const r of usageUserIds) allActive.add(r.userId);

	// Active users — windowed + daily (distinct users active per day, quiz OR any AI usage)
	const activeWindow = new Set<string>();
	const dailyActiveSets: Record<string, Set<string>> = {};
	const markActive = (day: string, userId: string) => {
		activeWindow.add(userId);
		(dailyActiveSets[day] ??= new Set()).add(userId);
	};
	for (const r of quizWindow) markActive(utcDay(r.createdAt), r.userId);
	for (const r of usageWindow) markActive(r.day, r.userId);
	const dailyActive: Record<string, number> = {};
	for (const [day, set] of Object.entries(dailyActiveSets)) dailyActive[day] = set.size;

	// Asks — range + today, from the windowed ask counters
	let asksRange = 0;
	let asksToday = 0;
	for (const r of usageWindow) {
		if (r.kind !== 'ask') continue;
		asksRange += r.count;
		if (r.day === today) asksToday += r.count;
	}

	// Sign-ups per day
	const signupsByDay: Record<string, number> = {};
	for (const r of signupRows) {
		const day = utcDay(r.createdAt.getTime());
		signupsByDay[day] = (signupsByDay[day] ?? 0) + 1;
	}

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
			activeUsers: allActive.size,
			quizAttempts: quizTotal,
			asks: Number(asksAllRows[0]?.total ?? 0)
		},
		recent: {
			newUsers,
			activeUsers: activeWindow.size,
			quizAttempts: quizWindow.length,
			asks: asksRange,
			asksToday
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
		dailyActive: fillDailyBuckets(dailyActive, rangeDays, nowMs),
		dailySignups: fillDailyBuckets(signupsByDay, rangeDays, nowMs)
	};
}
