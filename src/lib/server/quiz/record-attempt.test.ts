import { describe, expect, it, vi } from 'vitest';
import type { Db } from '$lib/server/db';
import { questionResponses, quizAttempts } from '$lib/server/db/schema';
import { recordAttempt, type RecordAttemptInput } from './record-attempt';

/**
 * A fake `Db` covering only what `recordAttempt` touches: the
 * `select().from().where().limit()` dedup lookup, `insert().values()` (tagged
 * by which table it targets, so a test can assert batch order), and `batch`.
 * `selectResults` is consumed one array per call to `.limit()` — the pre-check
 * gets the first, a post-`batch` re-query (if any) gets the second.
 */
function fakeDb(selectResults: Array<{ id: string }[]>, batchImpl: () => Promise<unknown>) {
	let call = 0;
	const batch = vi.fn((_writes: unknown[]) => batchImpl());
	const db = {
		select() {
			return {
				from() {
					return {
						where() {
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
	return { db: db as never as Db, batch };
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
		const { db, batch } = fakeDb([[], [{ id: 'winner-id' }]], async () => {
			throw new Error('D1_ERROR: UNIQUE constraint failed: quiz_attempts.client_id');
		});

		const result = await recordAttempt(db, input());

		expect(result).toEqual({ id: 'winner-id', duplicate: true });
		expect(batch).toHaveBeenCalledTimes(1);
	});

	it('propagates a genuine batch failure when the re-query finds no row', async () => {
		const dbError = new Error('D1_ERROR: SQLITE_BUSY: database is locked');
		const { db } = fakeDb([[], []], async () => {
			throw dbError;
		});

		await expect(recordAttempt(db, input())).rejects.toThrow(dbError);
	});
});
