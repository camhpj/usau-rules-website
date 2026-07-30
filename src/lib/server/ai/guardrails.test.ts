import { describe, expect, it } from 'vitest';
import { utcDay } from '$lib/time';
import { ASK_DAILY_PER_USER } from './config';
import {
	aiAvailable,
	consumeQuota,
	evaluateQuota,
	requireAiQuota,
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
		async increment(day, userId, kind) {
			rows.set(k(day, userId, kind), (rows.get(k(day, userId, kind)) ?? 0) + 1);
		}
	};
}

describe('evaluateQuota', () => {
	it('allows under the cap with a correct remaining count', () => {
		expect(evaluateQuota('ask', 0)).toEqual({
			allowed: true,
			remaining: ASK_DAILY_PER_USER - 1
		});
	});
	it('blocks at the per-user cap', () => {
		expect(evaluateQuota('ask', ASK_DAILY_PER_USER)).toEqual({
			allowed: false,
			reason: 'user-cap'
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

describe('requireAiQuota', () => {
	it('returns remaining and the bucket day when under the cap, and records the request', async () => {
		const store = memoryUsage();
		const now = Date.UTC(2026, 6, 11, 12);
		const result = await requireAiQuota(store, 'u1', 'ask', now);
		expect(result).toEqual({ remaining: ASK_DAILY_PER_USER - 1, day: utcDay(now) });
		expect(await store.userCount(utcDay(now), 'u1', 'ask')).toBe(1);
	});
	it('throws 429 with the per-user message once the cap is reached', async () => {
		const store = memoryUsage();
		const now = Date.UTC(2026, 6, 11, 12);
		for (let i = 0; i < ASK_DAILY_PER_USER; i++) await requireAiQuota(store, 'u1', 'ask', now);
		await expect(requireAiQuota(store, 'u1', 'ask', now)).rejects.toMatchObject({
			status: 429,
			body: { message: 'Daily question limit reached — try again tomorrow' }
		});
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
