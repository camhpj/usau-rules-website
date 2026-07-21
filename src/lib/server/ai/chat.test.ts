import { describe, expect, it } from 'vitest';
import { deriveTitle } from '$lib/ai/payload';
import { statusForStream, toGeminiTurns } from './chat';

describe('deriveTitle', () => {
	it('trims, collapses internal whitespace, and caps at 80 chars', () => {
		expect(deriveTitle('  What is\n a   stall?  ')).toBe('What is a stall?');
		expect(deriveTitle('x'.repeat(200))).toHaveLength(80);
	});
});

describe('toGeminiTurns', () => {
	it('maps roles and preserves order', () => {
		expect(
			toGeminiTurns([
				{ role: 'user', content: 'Q1', status: null },
				{ role: 'assistant', content: 'A1', status: 'complete' },
				{ role: 'user', content: 'Q2', status: null }
			])
		).toEqual([
			{ role: 'user', text: 'Q1' },
			{ role: 'model', text: 'A1' },
			{ role: 'user', text: 'Q2' }
		]);
	});
	it('drops error and empty assistant turns but keeps truncated ones', () => {
		expect(
			toGeminiTurns([
				{ role: 'user', content: 'Q1', status: null },
				{ role: 'assistant', content: '', status: 'error' },
				{ role: 'assistant', content: 'partial', status: 'truncated' }
			])
		).toEqual([
			{ role: 'user', text: 'Q1' },
			{ role: 'model', text: 'partial' }
		]);
	});
});

describe('statusForStream', () => {
	it('passes outcomes through when answer text exists, downgrading error to truncated', () => {
		expect(statusForStream('complete', 'full answer')).toBe('complete');
		expect(statusForStream('truncated', 'partial answer')).toBe('truncated');
		expect(statusForStream('error', 'partial answer')).toBe('truncated'); // partial answers are kept
	});
	it('persists any stream with no answer text as an error row', () => {
		expect(statusForStream('complete', '')).toBe('error'); // thoughts-only "success"
		expect(statusForStream('complete', '   ')).toBe('error');
		expect(statusForStream('truncated', '')).toBe('error');
		expect(statusForStream('error', '')).toBe('error');
	});
	it('treats a cancelled stream with partial text like an errored one', () => {
		expect(statusForStream('cancelled', 'partial answer')).toBe('truncated'); // keep what the user saw
	});
	it('persists nothing for a cancelled stream with no answer text', () => {
		expect(statusForStream('cancelled', '')).toBeNull();
		expect(statusForStream('cancelled', '  \n')).toBeNull();
	});
	it('still records an error row when a non-cancelled stream produced no text', () => {
		expect(statusForStream('error', '')).toBe('error');
		expect(statusForStream('complete', '')).toBe('error');
		expect(statusForStream('truncated', '')).toBe('error');
	});
});
