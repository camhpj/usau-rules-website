import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { listQuestions, questionCountsBySection } from './bank';

describe('question bank loader', () => {
	it('loads the starter questions with unique ids', () => {
		const questions = listQuestions(DEFAULT_RULESET_ID);
		expect(questions.length).toBeGreaterThanOrEqual(4);
		expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
		expect(questions.every((q) => q.rulesetId === DEFAULT_RULESET_ID)).toBe(true);
	});
	it('counts questions per section', () => {
		const counts = questionCountsBySection(DEFAULT_RULESET_ID);
		expect(counts.get('9')).toBeGreaterThanOrEqual(2);
		expect(counts.get('15')).toBeGreaterThanOrEqual(1);
	});
	it('returns empty for unknown rulesets', () => {
		expect(listQuestions('nope')).toEqual([]);
	});
});
