import { describe, expect, it } from 'vitest';
import { timeAgo } from './time';

const NOW = Date.UTC(2026, 6, 16, 12, 0, 0); // 2026-07-16T12:00:00Z

describe('timeAgo', () => {
	it('says "just now" under a minute (and for clock skew into the future)', () => {
		expect(timeAgo(NOW - 30_000, NOW)).toBe('just now');
		expect(timeAgo(NOW + 5_000, NOW)).toBe('just now');
	});
	it('formats minutes, hours, days, and weeks', () => {
		expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe('5m ago');
		expect(timeAgo(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
		expect(timeAgo(NOW - 2 * 86_400_000, NOW)).toBe('2d ago');
		expect(timeAgo(NOW - 10 * 86_400_000, NOW)).toBe('1w ago');
	});
	it('falls back to a short date at 5+ weeks', () => {
		expect(timeAgo(Date.UTC(2026, 5, 1), NOW)).toBe('Jun 1, 2026');
	});
});
