import { describe, expect, it } from 'vitest';
import { LeaderboardResponseSchema } from './payload';

describe('LeaderboardResponseSchema', () => {
	const entry = { rank: 1, displayName: 'Sam K.', score: 124, bestStreak: 38, at: 1783950000000 };
	it('accepts a board with and without me', () => {
		expect(LeaderboardResponseSchema.safeParse({ entries: [entry], me: null }).success).toBe(true);
		expect(
			LeaderboardResponseSchema.safeParse({ entries: [], me: { ...entry, rank: 23 } }).success
		).toBe(true);
	});
	it('rejects malformed entries', () => {
		expect(
			LeaderboardResponseSchema.safeParse({ entries: [{ rank: 'x' }], me: null }).success
		).toBe(false);
	});
});
