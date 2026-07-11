import { describe, expect, it } from 'vitest';
import type { Question } from '$lib/quiz/types';
import { recomputeTimed, verifyResponses } from './verify';

const q = (id: string, answerIndex: number): Question => ({
	id,
	rulesetId: 'r',
	type: 'multiple-choice',
	prompt: `Prompt for ${id}?`,
	choices: ['a', 'b', 'c', 'd'],
	answerIndex,
	explanation: 'Because the rules say so.',
	ruleRefs: ['15.D'],
	sectionSlug: id.split('-')[0],
	difficulty: 1
});
const bank = new Map([
	['15-01', q('15-01', 2)],
	['15-02', q('15-02', 0)],
	['9-01', q('9-01', 1)]
]);

describe('verifyResponses', () => {
	it('recomputes correctness and section from the bank, never the client', () => {
		const result = verifyResponses(
			[
				{ questionId: '15-01', choiceIndex: 2, at: 100 },
				{ questionId: '9-01', choiceIndex: 3, at: 200 }
			],
			bank
		);
		expect(result).toMatchObject({
			ok: true,
			verified: [
				{ questionId: '15-01', sectionSlug: '15', choiceIndex: 2, correct: true, at: 100 },
				{ questionId: '9-01', sectionSlug: '9', choiceIndex: 3, correct: false, at: 200 }
			]
		});
	});
	it('defaults missing timestamps to now', () => {
		const result = verifyResponses([{ questionId: '15-01', choiceIndex: 0 }], bank, 12345);
		expect(result.ok && result.verified[0].at).toBe(12345);
	});
	it('rejects unknown and duplicate question ids', () => {
		expect(verifyResponses([{ questionId: 'nope', choiceIndex: 0 }], bank)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('unknown question')
		});
		expect(
			verifyResponses(
				[
					{ questionId: '15-01', choiceIndex: 0 },
					{ questionId: '15-01', choiceIndex: 1 }
				],
				bank
			)
		).toMatchObject({ ok: false, reason: expect.stringContaining('duplicate') });
	});
});

describe('recomputeTimed', () => {
	it('scores and finds the best streak from ordered responses', () => {
		const v = (correct: boolean) => ({
			questionId: 'x',
			sectionSlug: '15',
			choiceIndex: 0,
			correct,
			at: 0
		});
		const { score, bestStreak } = recomputeTimed(
			[true, true, false, true, true, true, false].map(v)
		);
		expect(score).toBe(5);
		expect(bestStreak).toBe(3);
	});
	it('handles an all-wrong run', () => {
		expect(
			recomputeTimed([
				{ questionId: 'x', sectionSlug: '15', choiceIndex: 0, correct: false, at: 0 }
			])
		).toEqual({ score: 0, bestStreak: 0 });
	});
});
