import { describe, expect, it } from 'vitest';
import type { Question } from './types';
import { buildQuizItems, filterQuestions, mulberry32, shuffle, summarize } from './engine';

const q = (id: string, over: Partial<Question> = {}): Question => ({
	id,
	rulesetId: 'r',
	type: 'multiple-choice',
	prompt: `Prompt for ${id}?`,
	choices: ['a', 'b', 'c', 'd'],
	answerIndex: 2,
	explanation: 'Because the rules say so.',
	ruleRefs: ['15.D'],
	sectionSlug: '15',
	difficulty: 1,
	...over
});

describe('mulberry32 + shuffle', () => {
	it('is deterministic for a seed and does not mutate input', () => {
		const items = [1, 2, 3, 4, 5, 6, 7, 8];
		const a = shuffle(items, mulberry32(42));
		const b = shuffle(items, mulberry32(42));
		expect(a).toEqual(b);
		expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect([...a].sort()).toEqual([...items].sort()); // permutation
		expect(shuffle(items, mulberry32(7))).not.toEqual(a); // different seed differs (true for these seeds)
	});
});

describe('filterQuestions', () => {
	const bank = [q('a'), q('b', { sectionSlug: '9' }), q('c', { difficulty: 3 })];
	it('filters by section and difficulty together', () => {
		expect(filterQuestions(bank, { sections: ['15'] }).map((x) => x.id)).toEqual(['a', 'c']);
		expect(filterQuestions(bank, { difficulties: [3] }).map((x) => x.id)).toEqual(['c']);
		expect(filterQuestions(bank, { sections: ['15'], difficulties: [1] }).map((x) => x.id)).toEqual(
			['a']
		);
	});
	it('treats empty filters as no filter', () => {
		expect(filterQuestions(bank, {})).toHaveLength(3);
		expect(filterQuestions(bank, { sections: [], difficulties: [] })).toHaveLength(3);
	});
});

describe('buildQuizItems', () => {
	it('shuffles choices but keeps the correct answer tracked', () => {
		const items = buildQuizItems([q('a'), q('b')], mulberry32(1));
		for (const item of items) {
			expect([...item.order].sort()).toEqual([0, 1, 2, 3]);
			expect(item.order[item.correctChoice]).toBe(item.question.answerIndex);
		}
	});
});

describe('summarize', () => {
	it('counts and rounds', () => {
		const r = (correct: boolean) => ({
			questionId: 'x',
			sectionSlug: '15',
			chosenChoice: 0,
			correct
		});
		expect(summarize([r(true), r(true), r(false)])).toEqual({ total: 3, correct: 2, pct: 67 });
		expect(summarize([])).toEqual({ total: 0, correct: 0, pct: 0 });
	});
});
