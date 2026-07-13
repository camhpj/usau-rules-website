import { describe, expect, it } from 'vitest';
import { latestThoughtHeadline } from './thoughts';

describe('latestThoughtHeadline', () => {
	it('returns null for empty text', () => {
		expect(latestThoughtHeadline('')).toBeNull();
	});

	it('returns null for text without markers', () => {
		expect(latestThoughtHeadline("I'm currently focused on the question.")).toBeNull();
	});

	it('returns the last headline when several are present', () => {
		const text =
			'**Defining Key Terms**\n\nI am currently focused on…\n\n**Weighing the Ruling**\n\nNow considering the stall count.';
		expect(latestThoughtHeadline(text)).toBe('Weighing the Ruling');
	});

	it('tolerates a partial trailing unclosed marker by ignoring it', () => {
		const text = '**Defining Key Terms**\n\nSome analysis text.\n\n**Unclosed';
		expect(latestThoughtHeadline(text)).toBe('Defining Key Terms');
	});
});
