import { describe, expect, it } from 'vitest';
import { deriveTitle } from '$lib/ai/payload';
import { toGeminiTurns } from './chat';

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
