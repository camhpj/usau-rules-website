import { describe, expect, it } from 'vitest';
import { ASK_DAILY_PER_USER, AI_GLOBAL_DAILY } from './config';
import {
	aiAvailable,
	consumeQuota,
	evaluateQuota,
	utcDay,
	type AiKind,
	type UsageStore
} from './guardrails';

function memoryUsage(): UsageStore & { rows: Map<string, number> } {
	const rows = new Map<string, number>();
	const k = (day: string, userId: string, kind: string) => `${day}|${userId}|${kind}`;
	return {
		rows,
		async userCount(day, userId, kind) {
			return rows.get(k(day, userId, kind)) ?? 0;
		},
		async globalCount(day) {
			let total = 0;
			for (const [key, count] of rows) if (key.startsWith(`${day}|`)) total += count;
			return total;
		},
		async increment(day, userId, kind) {
			rows.set(k(day, userId, kind), (rows.get(k(day, userId, kind)) ?? 0) + 1);
		}
	};
}

describe('utcDay', () => {
	it('formats and rolls over on UTC midnight', () => {
		expect(utcDay(Date.UTC(2026, 6, 11, 23, 59, 59))).toBe('2026-07-11');
		expect(utcDay(Date.UTC(2026, 6, 12, 0, 0, 1))).toBe('2026-07-12');
	});
});

describe('evaluateQuota', () => {
	it('allows under the cap with a correct remaining count', () => {
		expect(evaluateQuota('ask', 0, 0)).toEqual({
			allowed: true,
			remaining: ASK_DAILY_PER_USER - 1
		});
	});
	it('blocks at the per-user cap and at the global budget', () => {
		expect(evaluateQuota('ask', ASK_DAILY_PER_USER, 50)).toEqual({
			allowed: false,
			reason: 'user-cap'
		});
		expect(evaluateQuota('ask', 0, AI_GLOBAL_DAILY)).toEqual({
			allowed: false,
			reason: 'global-cap'
		});
	});
});

describe('consumeQuota', () => {
	it('increments only when allowed', async () => {
		const store = memoryUsage();
		const now = Date.UTC(2026, 6, 11, 12);
		const first = await consumeQuota(store, 'u1', 'ask' as AiKind, now);
		expect(first).toEqual({ allowed: true, remaining: ASK_DAILY_PER_USER - 1 });
		expect(await store.userCount(utcDay(now), 'u1', 'ask')).toBe(1);
		for (let i = 1; i < ASK_DAILY_PER_USER; i++) await consumeQuota(store, 'u1', 'ask', now);
		const over = await consumeQuota(store, 'u1', 'ask', now);
		expect(over).toEqual({ allowed: false, reason: 'user-cap' });
		expect(await store.userCount(utcDay(now), 'u1', 'ask')).toBe(ASK_DAILY_PER_USER); // denied → not incremented
	});
});

describe('aiAvailable', () => {
	const env = (over: Record<string, string | undefined>) =>
		({ GEMINI_API_KEY: 'k', ...over }) as App.Platform['env'];
	it('requires a key and no kill-switch', () => {
		expect(aiAvailable(env({}))).toBe(true);
		expect(aiAvailable(env({ AI_DISABLED: '1' }))).toBe(false);
		expect(aiAvailable(env({ GEMINI_API_KEY: undefined }))).toBe(false);
	});
});
