import { describe, expect, it } from 'vitest';
import { mulberry32 } from './engine';
import type { Question } from './types';
import type { ResponseRecord } from './storage';
import { computeSectionMastery, orderForMastery, MASTERY_WINDOW } from './mastery';

const response = (
	questionId: string,
	correct: boolean,
	at: number,
	sectionSlug = '15'
): ResponseRecord => ({
	questionId,
	sectionSlug,
	correct,
	at
});

const q = (id: string): Question => ({
	id,
	rulesetId: 'r',
	type: 'multiple-choice',
	prompt: `P ${id}?`,
	choices: ['a', 'b', 'c', 'd'],
	answerIndex: 0,
	explanation: 'Because rules.',
	ruleRefs: ['15.D'],
	sectionSlug: '15',
	difficulty: 1
});

describe('computeSectionMastery', () => {
	it('is unseen with no responses for the section', () => {
		expect(computeSectionMastery([response('x', true, 1, '9')], '15').level).toBe('unseen');
	});
	it('needs enough attempts before mastered', () => {
		const five = Array.from({ length: 5 }, (_, i) => response(`q${i}`, true, i));
		expect(computeSectionMastery(five, '15')).toMatchObject({
			attempts: 5,
			recentPct: 100,
			level: 'solid'
		});
	});
	it('masters at ≥90% over the recent window', () => {
		const twelve = Array.from({ length: 12 }, (_, i) => response(`q${i}`, i !== 0, i));
		expect(computeSectionMastery(twelve, '15').level).toBe('mastered'); // 11/12 ≈ 92%
	});
	it('only considers the most recent window', () => {
		const old = Array.from({ length: 30 }, (_, i) => response(`old${i}`, false, i));
		const recent = Array.from({ length: MASTERY_WINDOW }, (_, i) =>
			response(`new${i}`, true, 100 + i)
		);
		expect(computeSectionMastery([...old, ...recent], '15')).toMatchObject({
			recentPct: 100,
			level: 'mastered'
		});
	});
	it('is learning under 60%', () => {
		const responses = [response('a', false, 1), response('b', false, 2), response('c', true, 3)];
		expect(computeSectionMastery(responses, '15').level).toBe('learning');
	});
});

describe('orderForMastery', () => {
	it('puts missed first, then unseen, then correct by staleness', () => {
		const questions = [q('missed'), q('unseen'), q('stale'), q('fresh')];
		const responses = [
			response('stale', true, 1),
			response('fresh', true, 10),
			response('missed', true, 2),
			response('missed', false, 5) // most recent response for "missed" is wrong
		];
		const ordered = orderForMastery(questions, responses, mulberry32(1));
		expect(ordered.map((x) => x.id)).toEqual(['missed', 'unseen', 'stale', 'fresh']);
	});
});
