import { describe, expect, it, vi } from 'vitest';
import type { Db } from '$lib/server/db';
import { questionResponses, quizAttempts } from '$lib/server/db/schema';
import { recordAttempt, type RecordAttemptInput } from './record-attempt';

// record-attempt.ts builds its dedup predicate with drizzle's `eq`. Replacing
// it with a plain `{ column, value }` marker lets the fake below capture
// exactly which column and value each `where()` call filtered by, without
// depending on drizzle's internal SQL chunk representation.
vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('drizzle-orm')>();
	return { ...actual, eq: (column: unknown, value: unknown) => ({ column, value }) };
});

/**
 * A fake `Db` covering only what `recordAttempt` touches: the
 * `select().from().where().limit()` dedup lookup, `insert().values()` (tagged
 * by which table it targets, so a test can assert batch order), and `batch`.
 * `selectResults` is consumed one array per call to `.limit()` — the pre-check
 * gets the first, a post-`batch` re-query (if any) gets the second. Every
 * `where()` predicate is recorded, in order, so a test can pin which column
 * and value each lookup filtered by.
 */
function fakeDb(selectResults: Array<{ id: string }[]>, batchImpl: () => Promise<unknown>) {
	let call = 0;
	const batch = vi.fn((_writes: unknown[]) => batchImpl());
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
									const result = selectResults[Math.min(call, selectResults.length - 1)];
									call++;
									return result;
								}
							};
						}
					};
				}
			};
		},
		insert(table: unknown) {
			return { values: (values: unknown) => ({ table, values }) };
		},
		batch
	};
	return { db: db as never as Db, batch, wherePredicates };
}

function input(overrides: Partial<RecordAttemptInput> = {}): RecordAttemptInput {
	return {
		attemptId: 'attempt-1',
		userId: 'user-1',
		clientId: 'client-1',
		rulesetId: 'usau-2024',
		mode: 'quick',
		sectionSlug: null,
		score: 1,
		total: 1,
		bestStreak: null,
		startedAt: 1000,
		durationS: 10,
		createdAt: 2000,
		responses: [
			{ questionId: 'q1', sectionSlug: 'general', choiceIndex: 0, correct: true, at: 1500 }
		],
		...overrides
	};
}

describe('recordAttempt', () => {
	it('inserts a fresh clientId and reports duplicate: false', async () => {
		const { db, batch } = fakeDb([[]], async () => undefined);

		const result = await recordAttempt(db, input());

		expect(result).toEqual({ id: 'attempt-1', duplicate: false });
		expect(batch).toHaveBeenCalledTimes(1);
		const writes = batch.mock.calls[0][0] as unknown as { table: unknown }[];
		expect(writes[0].table).toBe(quizAttempts);
		expect(writes[1].table).toBe(questionResponses);
	});

	it('detects an already-present clientId via the pre-check without calling batch', async () => {
		const { db, batch } = fakeDb([[{ id: 'existing-id' }]], async () => undefined);

		const result = await recordAttempt(db, input());

		expect(result).toEqual({ id: 'existing-id', duplicate: true });
		expect(batch).not.toHaveBeenCalled();
	});

	it('resolves the insert race: batch throws a unique-constraint error, the re-query finds the winner', async () => {
		const { db, batch, wherePredicates } = fakeDb([[], [{ id: 'winner-id' }]], async () => {
			throw new Error('D1_ERROR: UNIQUE constraint failed: quiz_attempts.client_id');
		});

		const result = await recordAttempt(db, input());

		expect(result).toEqual({ id: 'winner-id', duplicate: true });
		expect(batch).toHaveBeenCalledTimes(1);
		// Both the pre-check and the post-failure re-query must filter by the
		// same column and clientId the insert attempted with. If the re-query
		// filtered by the wrong column (or a different value), this would still
		// let the wrong row be reported as the race winner.
		expect(wherePredicates).toEqual([
			{ column: quizAttempts.clientId, value: 'client-1' },
			{ column: quizAttempts.clientId, value: 'client-1' }
		]);
	});

	it('propagates a genuine batch failure when the re-query finds no row', async () => {
		const dbError = new Error('D1_ERROR: SQLITE_BUSY: database is locked');
		const { db } = fakeDb([[], []], async () => {
			throw dbError;
		});

		// Identity, not just message: an implementation that wrapped and
		// rethrew a new error with the same message would wrongly pass a
		// message-only assertion, defeating the point of this test.
		await expect(recordAttempt(db, input())).rejects.toBe(dbError);
	});
});
