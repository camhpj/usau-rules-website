import { describe, expect, it } from 'vitest';
import { buildLeaderboardResult, rankAgainstBoard, type RankedRow } from './leaderboard';

// Fixtures stand in for rows fetched from D1 (see the `best` CTE in leaderboard.ts). Order
// is deliberately scrambled in most cases to prove buildLeaderboardResult does the sorting,
// not the caller.
function mkRow(
	userId: string,
	displayName: string,
	score: number,
	bestStreak: number,
	at: number
): RankedRow {
	return { user_id: userId, display_name: displayName, score, best_streak: bestStreak, at };
}

describe('buildLeaderboardResult', () => {
	it('ranks three distinct scores 1, 2, 3', () => {
		const rows = [
			mkRow('c', 'Cara', 10, 5, 100),
			mkRow('a', 'Alice', 30, 5, 100),
			mkRow('b', 'Bob', 20, 5, 100)
		];
		const { entries } = buildLeaderboardResult(rows);
		expect(entries.map((e) => [e.rank, e.displayName])).toEqual([
			[1, 'Alice'],
			[2, 'Bob'],
			[3, 'Cara']
		]);
	});

	it('breaks equal scores by bestStreak descending', () => {
		const rows = [mkRow('a', 'Alice', 50, 3, 100), mkRow('b', 'Bob', 50, 7, 200)];
		const { entries } = buildLeaderboardResult(rows);
		expect(entries.map((e) => e.displayName)).toEqual(['Bob', 'Alice']);
		expect(entries.map((e) => e.rank)).toEqual([1, 2]);
	});

	it('breaks equal score and streak by created_at ascending (earlier run wins)', () => {
		const rows = [mkRow('a', 'Alice', 50, 5, 2000), mkRow('b', 'Bob', 50, 5, 1000)];
		const { entries } = buildLeaderboardResult(rows);
		expect(entries.map((e) => e.displayName)).toEqual(['Bob', 'Alice']);
		expect(entries.map((e) => e.rank)).toEqual([1, 2]);
	});

	it('gives fully tied rows (score, streak, and at) the same rank, and the next row skips ranks', () => {
		const rows = [
			mkRow('a', 'Alice', 50, 5, 1000),
			mkRow('b', 'Bob', 50, 5, 1000),
			mkRow('c', 'Cara', 40, 5, 1000)
		];
		const { entries } = buildLeaderboardResult(rows);
		expect(entries.map((e) => e.rank)).toEqual([1, 1, 3]);
	});

	it('finds the caller even when ranked outside the visible top ten', () => {
		// 11 distinct scorers: ranks 1..10 fill the board, the 11th is the caller.
		const rows = Array.from({ length: 11 }, (_, i) =>
			mkRow(`u${i}`, `Player ${i}`, 100 - i, 5, 1000 + i)
		);
		const { entries, me } = buildLeaderboardResult(rows, 'u10');
		expect(entries).toHaveLength(10);
		expect(entries.some((e) => e.displayName === 'Player 10')).toBe(false);
		expect(me).toEqual({ rank: 11, displayName: 'Player 10', score: 90, bestStreak: 5, at: 1010 });
	});

	it('returns me: null when no callerId is given', () => {
		const rows = [mkRow('a', 'Alice', 50, 5, 1000)];
		const { me } = buildLeaderboardResult(rows);
		expect(me).toBeNull();
	});

	it('returns me: null when callerId matches no row', () => {
		const rows = [mkRow('a', 'Alice', 50, 5, 1000)];
		const { me } = buildLeaderboardResult(rows, 'nobody');
		expect(me).toBeNull();
	});

	it('never leaks user_id onto the entries or me rows', () => {
		const rows = [mkRow('a', 'Alice', 50, 5, 1000)];
		const { entries, me } = buildLeaderboardResult(rows, 'a');
		expect((entries[0] as unknown as Record<string, unknown>).user_id).toBeUndefined();
		expect((me as unknown as Record<string, unknown>).user_id).toBeUndefined();
	});
});

// rankAgainstBoard backs the live `me` lookup: `rows` is a (possibly stale, e.g. cached) board
// snapshot that may not include the caller's own latest run, and `mine` is the caller's current
// best fetched live. It must rank `mine` against the full board without re-ranking `rows`.
describe('rankAgainstBoard', () => {
	it('ranks a live row against a board that does not yet contain it', () => {
		const rows = [mkRow('a', 'Alice', 100, 5, 100), mkRow('b', 'Bob', 80, 5, 100)];
		const mine = mkRow('me', 'Newcomer', 90, 5, 500);
		expect(rankAgainstBoard(rows, mine)).toEqual({
			rank: 2,
			displayName: 'Newcomer',
			score: 90,
			bestStreak: 5,
			at: 500
		});
	});

	it('takes the top rank when the live row beats everyone on the board', () => {
		const rows = [mkRow('a', 'Alice', 50, 5, 100), mkRow('b', 'Bob', 40, 5, 100)];
		const mine = mkRow('me', 'Champion', 999, 1, 999);
		expect(rankAgainstBoard(rows, mine).rank).toBe(1);
	});

	it('shares a rank with rows tied on score, streak, and at (not counted as "better")', () => {
		const rows = [mkRow('a', 'Alice', 100, 5, 100), mkRow('b', 'Bob', 80, 5, 100)];
		const mine = mkRow('me', 'Tied', 100, 5, 100);
		expect(rankAgainstBoard(rows, mine).rank).toBe(1);
	});

	it('excludes the caller’s own (possibly stale) row from the board it ranks against', () => {
		// A stale, worse snapshot of the caller's own prior best must never count as "beating"
		// their live row, and must not be double-counted either way.
		const rows = [
			mkRow('me', 'Improved', 10, 1, 1),
			mkRow('a', 'Alice', 100, 5, 100),
			mkRow('b', 'Bob', 50, 5, 100)
		];
		const mine = mkRow('me', 'Improved', 90, 5, 500);
		expect(rankAgainstBoard(rows, mine).rank).toBe(2);
	});
});
