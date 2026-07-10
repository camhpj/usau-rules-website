import { describe, expect, it } from 'vitest';
import { QuestionSchema, DIFFICULTY_LABELS } from './types';

const question = {
	id: '15-01',
	rulesetId: 'usau-official-2026-27',
	type: 'multiple-choice',
	prompt: 'What happens at the first utterance of “ten”?',
	choices: ['Turnover', 'Warning', 'Redo', 'Nothing'],
	answerIndex: 0,
	explanation: 'Per 15.D it is a turnover and play stops.',
	ruleRefs: ['15.D'],
	sectionSlug: '15',
	difficulty: 1
};

describe('QuestionSchema', () => {
	it('accepts a valid question', () => {
		expect(QuestionSchema.parse(question).id).toBe('15-01');
	});
	it('rejects wrong choice counts, out-of-range answers, and empty refs', () => {
		expect(() => QuestionSchema.parse({ ...question, choices: ['a', 'b', 'c'] })).toThrow();
		expect(() => QuestionSchema.parse({ ...question, answerIndex: 4 })).toThrow();
		expect(() => QuestionSchema.parse({ ...question, ruleRefs: [] })).toThrow();
		expect(() => QuestionSchema.parse({ ...question, difficulty: 4 })).toThrow();
	});
	it('exposes difficulty labels', () => {
		expect(DIFFICULTY_LABELS[3]).toBe('Observer');
	});
});
