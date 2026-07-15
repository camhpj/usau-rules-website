import { describe, expect, it } from 'vitest';
import { gridLineOffsets } from './grid-pulse-lines';

describe('gridLineOffsets', () => {
	it('returns offsets that are gridline positions in page space', () => {
		const offsets = gridLineOffsets(64, 800, 96);
		expect(offsets.length).toBeGreaterThan(0);
		for (const offset of offsets) {
			expect((offset + 64) % 96).toBe(0);
		}
	});

	it('keeps offsets within the span with a half-tile margin', () => {
		const offsets = gridLineOffsets(64, 800, 96);
		for (const offset of offsets) {
			expect(offset).toBeGreaterThanOrEqual(48);
			expect(offset).toBeLessThanOrEqual(800 - 48);
		}
	});

	it('returns an empty list when the span is smaller than one tile', () => {
		expect(gridLineOffsets(0, 90, 96)).toEqual([]);
	});

	it('handles a container aligned exactly on a gridline', () => {
		expect(gridLineOffsets(96, 384, 96)).toEqual([96, 192, 288]);
	});
});
