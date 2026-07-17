import { describe, expect, it } from 'vitest';
import { pageRows, parseHistoryQuery } from './history';

describe('parseHistoryQuery', () => {
	it('defaults to no cursor and limit 10', () => {
		expect(parseHistoryQuery(new URLSearchParams())).toEqual({ before: null, limit: 10 });
	});
	it('parses a valid before cursor and limit', () => {
		expect(parseHistoryQuery(new URLSearchParams('before=1752600000000&limit=25'))).toEqual({
			before: 1752600000000,
			limit: 25
		});
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
