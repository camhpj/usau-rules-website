import { describe, expect, it } from 'vitest';
import { fillDailyBuckets, ratio, utcDay } from './metrics-math';

const T = Date.UTC(2026, 6, 17, 12, 0, 0); // 2026-07-17T12:00Z

describe('ratio', () => {
	it('divides', () => expect(ratio(1, 4)).toBe(0.25));
	it('zero denominator → 0', () => expect(ratio(3, 0)).toBe(0));
});

describe('utcDay', () => {
	it('formats epoch ms as UTC YYYY-MM-DD', () => expect(utcDay(T)).toBe('2026-07-17'));
});

describe('fillDailyBuckets', () => {
	it('returns `days` oldest-first buckets ending today, zero-filling gaps', () => {
		const out = fillDailyBuckets({ '2026-07-17': 5, '2026-07-15': 2 }, 3, T);
		expect(out).toEqual([
			{ day: '2026-07-15', count: 2 },
			{ day: '2026-07-16', count: 0 },
			{ day: '2026-07-17', count: 5 }
		]);
	});
	it('ignores counts outside the window', () => {
		const out = fillDailyBuckets({ '2026-07-01': 9, '2026-07-17': 1 }, 2, T);
		expect(out.map((b) => b.count)).toEqual([0, 1]);
	});
});
