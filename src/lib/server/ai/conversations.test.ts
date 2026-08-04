import { describe, expect, it, vi } from 'vitest';
import type { Db } from '$lib/server/db';
import { aiConversations } from '$lib/server/db/schema';
import { getOwnedConversation, ownedConversationWhere } from './conversations';

// ownedConversationWhere builds its predicate with drizzle's `and`/`eq`/`isNull`.
// Replacing them with plain markers lets a test assert exactly which columns and
// values the WHERE carries, without depending on drizzle's internal SQL chunk
// representation. Same technique `record-attempt.test.ts` uses for `eq`.
vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('drizzle-orm')>();
	return {
		...actual,
		and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
		eq: (column: unknown, value: unknown) => ({ op: 'eq', column, value }),
		isNull: (column: unknown) => ({ op: 'isNull', column })
	};
});

describe('ownedConversationWhere', () => {
	it('carries the conversation id, the caller userId, and a non-deleted row', () => {
		// This is the predicate that stops one user reading or writing another
		// user's conversation. All three conditions must be present: dropping the
		// userId one (leaving only id + deletedAt) would let any signed-in caller
		// address any other user's conversation by id.
		expect(ownedConversationWhere('convo-1', 'user-1')).toEqual({
			op: 'and',
			conditions: [
				{ op: 'eq', column: aiConversations.id, value: 'convo-1' },
				{ op: 'eq', column: aiConversations.userId, value: 'user-1' },
				{ op: 'isNull', column: aiConversations.deletedAt }
			]
		});
	});
});

function fakeDb(row: { id: string; rulesetId: string; title: string } | null) {
	const wherePredicates: unknown[] = [];
	const db = {
		select() {
			return {
				from() {
					return {
						where(predicate: unknown) {
							wherePredicates.push(predicate);
							return {
								async limit() {
									return row ? [row] : [];
								}
							};
						}
					};
				}
			};
		}
	};
	return { db: db as never as Db, wherePredicates };
}

describe('getOwnedConversation', () => {
	it('returns the row, filtered by ownedConversationWhere for the given id and userId', async () => {
		const row = { id: 'convo-1', rulesetId: 'usau-official-2026-27', title: 'Hi' };
		const { db, wherePredicates } = fakeDb(row);

		const result = await getOwnedConversation(db, 'convo-1', 'user-1');

		expect(result).toEqual(row);
		expect(wherePredicates).toEqual([ownedConversationWhere('convo-1', 'user-1')]);
	});

	it('returns null when no row matches (missing id or a foreign owner alike)', async () => {
		const { db } = fakeDb(null);
		expect(await getOwnedConversation(db, 'convo-1', 'user-1')).toBeNull();
	});
});
