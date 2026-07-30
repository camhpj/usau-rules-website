import { and, eq, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { utcDay } from '$lib/time';
import type { Db } from '$lib/server/db';
import { aiUsage } from '$lib/server/db/schema';
import { ASK_DAILY_PER_USER, SCENARIO_DAILY_PER_USER } from './config';

export type AiKind = 'ask' | 'scenario';

const DAILY_CAPS: Record<AiKind, number> = {
	ask: ASK_DAILY_PER_USER,
	scenario: SCENARIO_DAILY_PER_USER
};

export type QuotaDecision =
	{ allowed: true; remaining: number } | { allowed: false; reason: 'user-cap' };

/** Pure cap check; `userCount` is from BEFORE the current request. */
export function evaluateQuota(kind: AiKind, userCount: number): QuotaDecision {
	if (userCount >= DAILY_CAPS[kind]) return { allowed: false, reason: 'user-cap' };
	return { allowed: true, remaining: DAILY_CAPS[kind] - userCount - 1 };
}

export interface UsageStore {
	userCount(day: string, userId: string, kind: AiKind): Promise<number>;
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
 * can overshoot the per-user cap by at most the number of in-flight requests —
 * acceptable for a cost guardrail.
 */
export async function consumeQuota(
	store: UsageStore,
	userId: string,
	kind: AiKind,
	now: number
): Promise<QuotaDecision> {
	const day = utcDay(now);
	const userCount = await store.userCount(day, userId, kind);
	const decision = evaluateQuota(kind, userCount);
	if (decision.allowed) await store.increment(day, userId, kind);
	return decision;
}

/** Global kill-switch: AI is off when AI_DISABLED=1 or no key is configured. */
export function aiAvailable(env: App.Platform['env']): boolean {
	return env.AI_DISABLED !== '1' && Boolean(env.GEMINI_API_KEY);
}

/** Each route's exact user-facing 429 message, copied verbatim. */
export const QUOTA_MESSAGE: Record<AiKind, string> = {
	ask: 'Daily question limit reached — try again tomorrow',
	scenario: 'Daily scenario limit reached — try again tomorrow'
};

/**
 * Quota preflight shared by the chat and scenario routes: checks the
 * per-user daily cap via `consumeQuota` (recording the request when it's
 * allowed) and throws 429 with the route's own message when it's not.
 */
export async function requireAiQuota(
	store: UsageStore,
	userId: string,
	kind: AiKind,
	now: number
): Promise<{ remaining: number; day: string }> {
	const day = utcDay(now);
	const decision = await consumeQuota(store, userId, kind, now);
	if (!decision.allowed) throw error(429, QUOTA_MESSAGE[kind]);
	return { remaining: decision.remaining, day };
}
