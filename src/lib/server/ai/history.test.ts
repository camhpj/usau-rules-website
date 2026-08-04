import { describe, expect, it } from 'vitest';
import { pageRows, parseHistoryQuery } from './history';

describe('parseHistoryQuery', () => {
	it('defaults to no cursor and limit 10', () => {
		expect(parseHistoryQuery(new URLSearchParams())).toEqual({
			before: null,
			beforeId: null,
			limit: 10
		});
	});
	it('parses a valid before cursor and limit', () => {
		expect(parseHistoryQuery(new URLSearchParams('before=1752600000000&limit=25'))).toEqual({
			before: 1752600000000,
			beforeId: null,
			limit: 25
		});
	});
	it('parses a compound cursor', () => {
		const params = new URLSearchParams('before=1700000000000&beforeId=abc');
		expect(parseHistoryQuery(params)).toEqual({
			before: 1700000000000,
			beforeId: 'abc',
			limit: 10
		});
	});
	it('reports a null beforeId when the parameter is absent', () => {
		const params = new URLSearchParams('before=1700000000000');
		expect(parseHistoryQuery(params).beforeId).toBeNull();
	});
	it('ignores garbage, non-positive, and fractional cursors', () => {
		expect(parseHistoryQuery(new URLSearchParams('before=abc')).before).toBeNull();
		expect(parseHistoryQuery(new URLSearchParams('before=-5')).before).toBeNull();
		expect(parseHistoryQuery(new URLSearchParams('before=1.5')).before).toBeNull();
		expect(parseHistoryQuery(new URLSearchParams('before=')).before).toBeNull();
	});
	it('caps limit at 50 and defaults invalid limits to 10', () => {
		expect(parseHistoryQuery(new URLSearchParams('limit=999')).limit).toBe(50);
		expect(parseHistoryQuery(new URLSearchParams('limit=0')).limit).toBe(10);
		expect(parseHistoryQuery(new URLSearchParams('limit=abc')).limit).toBe(10);
		expect(parseHistoryQuery(new URLSearchParams('limit=1')).limit).toBe(1);
	});
	it('accepts a caller-supplied default limit', () => {
		expect(parseHistoryQuery(new URLSearchParams(), 20).limit).toBe(20);
		expect(parseHistoryQuery(new URLSearchParams('limit=5'), 20).limit).toBe(5);
		expect(parseHistoryQuery(new URLSearchParams('limit=999'), 20).limit).toBe(50);
	});
});

describe('pageRows', () => {
	it('returns all rows with hasMore=false when at or under the limit', () => {
		expect(pageRows([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
	});
	it('trims the sentinel row and sets hasMore when limit+1 rows come back', () => {
		expect(pageRows([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
	});
	it('handles empty input', () => {
		expect(pageRows([], 10)).toEqual({ items: [], hasMore: false });
	});
});

describe('keyset paging across a tie', () => {
	type Row = { id: string; updatedAt: number };

	// Sorted desc by (updatedAt, id) — the order every caller of pageRows fetches in
	// (`orderBy(desc(updatedAt), desc(id))` in both /api/ai/conversations and
	// /admin/ai's loader). 'd' and 'c' deliberately share updatedAt: 400, so they sit
	// on either side of whatever page boundary lands between them below.
	const rows: Row[] = [
		{ id: 'e', updatedAt: 500 },
		{ id: 'd', updatedAt: 400 },
		{ id: 'c', updatedAt: 400 },
		{ id: 'b', updatedAt: 300 },
		{ id: 'a', updatedAt: 200 }
	];

	/**
	 * Mirrors the compound `(updated_at, id)` cursor filter both callers build inline
	 * with drizzle's `lt`/`eq`/`and`/`or`: a row qualifies for the next page only if it
	 * sorts strictly after the cursor row in the (updatedAt desc, id desc) order above.
	 */
	function afterCursor(all: Row[], before: number, beforeId: string): Row[] {
		return all.filter((r) => r.updatedAt < before || (r.updatedAt === before && r.id < beforeId));
	}

	it('carries a tied updatedAt across a page boundary without dropping or repeating it', () => {
		const limit = 2;

		// Page 1: no cursor yet, so the "fetch" is just the first limit+1 rows.
		const page1 = pageRows(rows.slice(0, limit + 1), limit);
		expect(page1).toEqual({ items: [rows[0], rows[1]], hasMore: true }); // ['e', 'd']

		// The cursor is derived from the last row of page 1 — 'd', updatedAt: 400 — which
		// is tied with 'c', the first row of page 2. A cursor that compared updatedAt
		// alone would either drop 'c' (see the mutation check below) or, with a
		// non-strict comparison, repeat 'd'.
		const cursorRow = page1.items.at(-1)!;
		const remaining = afterCursor(rows, cursorRow.updatedAt, cursorRow.id);
		const page2 = pageRows(remaining.slice(0, limit + 1), limit);
		expect(page2).toEqual({ items: [rows[2], rows[3]], hasMore: true }); // ['c', 'b']

		// Page 3 finishes the set.
		const cursorRow2 = page2.items.at(-1)!;
		const remaining2 = afterCursor(rows, cursorRow2.updatedAt, cursorRow2.id);
		const page3 = pageRows(remaining2.slice(0, limit + 1), limit);
		expect(page3).toEqual({ items: [rows[4]], hasMore: false }); // ['a']

		const union = [...page1.items, ...page2.items, ...page3.items];
		expect(union).toEqual(rows); // every row exactly once, in the original order
		expect(new Set(union.map((r) => r.id)).size).toBe(rows.length); // no duplicates
	});
});
