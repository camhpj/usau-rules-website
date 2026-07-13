import { and, eq, sql, sum } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { aiUsage } from '$lib/server/db/schema';
import { AI_GLOBAL_DAILY, ASK_DAILY_PER_USER, SCENARIO_DAILY_PER_USER } from './config';

export type AiKind = 'ask' | 'scenario';

const DAILY_CAPS: Record<AiKind, number> = {
	ask: ASK_DAILY_PER_USER,
	scenario: SCENARIO_DAILY_PER_USER
};

export type QuotaDecision =
	{ allowed: true; remaining: number } | { allowed: false; reason: 'user-cap' | 'global-cap' };

export function utcDay(now: number): string {
	return new Date(now).toISOString().slice(0, 10);
}

/** Pure cap check; counts are from BEFORE the current request. */
export function evaluateQuota(kind: AiKind, userCount: number, globalCount: number): QuotaDecision {
	if (globalCount >= AI_GLOBAL_DAILY) return { allowed: false, reason: 'global-cap' };
	if (userCount >= DAILY_CAPS[kind]) return { allowed: false, reason: 'user-cap' };
	return { allowed: true, remaining: DAILY_CAPS[kind] - userCount - 1 };
}

export interface UsageStore {
	userCount(day: string, userId: string, kind: AiKind): Promise<number>;
	globalCount(day: string): Promise<number>;
	increment(day: string, userId: string, kind: AiKind): Promise<void>;
}

export function d1UsageStore(db: Db): UsageStore {
	return {
		async userCount(day, userId, kind) {
			const rows = await db
				.select({ count: aiUsage.count })
				.from(aiUsage)
				.where(and(eq(aiUsage.day, day), eq(aiUsage.userId, userId), eq(aiUsage.kind, kind)))
				.limit(1);
			return rows[0]?.count ?? 0;
		},
		async globalCount(day) {
			const rows = await db
				.select({ total: sum(aiUsage.count) })
				.from(aiUsage)
				.where(eq(aiUsage.day, day));
			return Number(rows[0]?.total ?? 0);
		},
		async increment(day, userId, kind) {
			await db
				.insert(aiUsage)
				.values({ day, userId, kind, count: 1 })
				.onConflictDoUpdate({
					target: [aiUsage.day, aiUsage.userId, aiUsage.kind],
					set: { count: sql`${aiUsage.count} + 1` }
				});
		}
	};
}

/**
 * Check caps, then record the request. Check-then-increment: a concurrent race
 * can overshoot a cap by at most the number of in-flight requests — acceptable
 * for a cost guardrail (the hard stop is the global budget + kill-switch).
 */
export async function consumeQuota(
	store: UsageStore,
	userId: string,
	kind: AiKind,
	now: number
): Promise<QuotaDecision> {
	const day = utcDay(now);
	const [userCount, globalCount] = await Promise.all([
		store.userCount(day, userId, kind),
		store.globalCount(day)
	]);
	const decision = evaluateQuota(kind, userCount, globalCount);
	if (decision.allowed) await store.increment(day, userId, kind);
	return decision;
}

/** Global kill-switch: AI is off when AI_DISABLED=1 or no key is configured. */
export function aiAvailable(env: App.Platform['env']): boolean {
	return env.AI_DISABLED !== '1' && Boolean(env.GEMINI_API_KEY);
}
