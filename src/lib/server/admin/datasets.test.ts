import { describe, expect, it, vi } from 'vitest';
import type { Db } from '$lib/server/db';
import { quizAttempts } from '$lib/server/db/schema';

// datasets.ts builds its WHERE clauses with drizzle's `eq`/`lt`/`and`/`or` and its sort
// with `desc`. Replacing them with plain descriptor objects — the same trick
// record-attempt.test.ts uses for `eq` — lets the fake db below actually evaluate the
// predicate a dataset's `rows()` built, instead of only stubbing around it. That's what
// makes this exercise the real cursor-and-tie-break logic in datasets.ts, not just the
// surrounding wiring.
vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('drizzle-orm')>();
	return {
		...actual,
		eq: (col: unknown, val: unknown) => ({ op: 'eq' as const, col, val }),
		lt: (col: unknown, val: unknown) => ({ op: 'lt' as const, col, val }),
		and: (...preds: unknown[]) => ({ op: 'and' as const, preds }),
		or: (...preds: unknown[]) => ({ op: 'or' as const, preds }),
		desc: (col: unknown) => ({ col, dir: 'desc' as const })
	};
});

import { DATASETS, type Cursor } from './datasets';

type Pred = { op: 'eq' | 'lt'; col: unknown; val: unknown } | { op: 'and' | 'or'; preds: Pred[] };
type OrderSpec = { col: unknown; dir: 'asc' | 'desc' };

type Row = {
	id: string;
	userId: string;
	rulesetId: string;
	mode: 'quick' | 'mastery' | 'timed';
	sectionSlug: string | null;
	score: number;
	total: number;
	bestStreak: number | null;
	startedAt: number;
	durationS: number;
	createdAt: number;
};

// The only two columns any dataset's cursor sorts or filters by in this suite.
type SortKey = 'id' | 'createdAt';

const colKey = new Map<unknown, SortKey>([
	[quizAttempts.id, 'id'],
	[quizAttempts.createdAt, 'createdAt']
]);

function evalPred(pred: Pred, row: Row): boolean {
	switch (pred.op) {
		case 'and':
			return pred.preds.every((p) => evalPred(p, row));
		case 'or':
			return pred.preds.some((p) => evalPred(p, row));
		case 'eq':
		case 'lt': {
			const key = colKey.get(pred.col);
			if (!key) throw new Error('fakeDb: unmapped column in predicate');
			const rowVal = row[key];
			const val = pred.val as string | number;
			return pred.op === 'eq' ? rowVal === val : rowVal < val;
		}
	}
}

/**
 * A fake `Db` covering only the `select().from().where().orderBy().limit()` chain that
 * every `DATASETS[x].rows()` issues. Unlike a stub that hands back canned pages keyed
 * off the cursor argument, this evaluates the real predicate and sort spec the
 * production code built — via the mocked drizzle-orm above — against an in-memory row
 * set, so a bug in the cursor's WHERE clause or its ORDER BY actually surfaces here.
 */
function fakeDb(rows: Row[]): Db {
	const db = {
		select() {
			return {
				from(table: unknown) {
					if (table !== quizAttempts) {
						throw new Error(`fakeDb: unexpected table ${String(table)}`);
					}
					return {
						where(pred: unknown) {
							const filtered =
								pred === undefined ? rows : rows.filter((r) => evalPred(pred as Pred, r));
							return {
								orderBy(...specs: OrderSpec[]) {
									const sorted = [...filtered].sort((a, b) => {
										for (const spec of specs) {
											const key = colKey.get(spec.col);
											if (!key) throw new Error('fakeDb: unmapped orderBy column');
											if (a[key] < b[key]) return spec.dir === 'desc' ? 1 : -1;
											if (a[key] > b[key]) return spec.dir === 'desc' ? -1 : 1;
										}
										return 0;
									});
									return { limit: async (n: number) => sorted.slice(0, n) };
								}
							};
						}
					};
				}
			};
		}
	};
	return db as unknown as Db;
}

function row(id: string, createdAt: number): Row {
	return {
		id,
		userId: 'user-1',
		rulesetId: 'usau-official-2026-27',
		mode: 'quick',
		sectionSlug: null,
		score: 1,
		total: 1,
		bestStreak: null,
		startedAt: createdAt,
		durationS: 10,
		createdAt
	};
}

describe('quiz-attempts dataset paging', () => {
	// Sorted desc by (createdAt, id) — the order rows() fetches in. 'd' and 'c'
	// deliberately share createdAt: 400, and a page size of 2 below lands the boundary
	// between page 1 and page 2 exactly between them (see the assertion breakdown).
	const rows = [row('e', 500), row('d', 400), row('c', 400), row('b', 300), row('a', 200)];

	it('emits every row exactly once, in order, across a tied page boundary', async () => {
		const db = fakeDb(rows);
		const pageSize = 2; // smaller than the row count, forcing more than one page

		const collected: unknown[][] = [];
		let cursor: Cursor | null = null;
		let pages = 0;
		do {
			const page = await DATASETS['quiz-attempts'].rows(db, cursor, pageSize);
			collected.push(...page.rows);
			cursor = page.next;
			pages++;
			if (pages > 10) throw new Error('test: pagination did not terminate');
		} while (cursor !== null);

		// Three pages (2, 2, 1) confirms the tie didn't collapse 'd' and 'c' onto one
		// page — each landed on the page its own cursor comparison put it on.
		expect(pages).toBe(3);
		expect(collected.map((r) => r[0])).toEqual(['e', 'd', 'c', 'b', 'a']);
		expect(new Set(collected.map((r) => r[0])).size).toBe(rows.length); // no duplicates
	});
});
