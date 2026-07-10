import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	__resetMemory,
	getTimedBest,
	loadResponses,
	recordAnswers,
	recordTimedResult
} from './storage';

function fakeLocalStorage() {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear()
	} as Storage;
}

const answer = (questionId: string, correct: boolean) => ({
	questionId,
	sectionSlug: '15',
	chosenChoice: 0,
	correct
});

describe('quiz storage', () => {
	beforeEach(() => {
		__resetMemory();
		(globalThis as { localStorage?: Storage }).localStorage = fakeLocalStorage();
	});
	afterEach(() => {
		delete (globalThis as { localStorage?: Storage }).localStorage;
	});

	it('records and reloads responses per ruleset', () => {
		recordAnswers('r1', [answer('a', true), answer('b', false)], 1000);
		expect(loadResponses('r1')).toMatchObject([
			{ questionId: 'a', correct: true, at: 1000 },
			{ questionId: 'b', correct: false, at: 1000 }
		]);
		expect(loadResponses('r2')).toEqual([]);
	});

	it('caps history at 2000 responses', () => {
		for (let i = 0; i < 21; i++) {
			recordAnswers(
				'r1',
				Array.from({ length: 100 }, (_, j) => answer(`q${i}-${j}`, true)),
				i
			);
		}
		const responses = loadResponses('r1');
		expect(responses).toHaveLength(2000);
		expect(responses[0].questionId).toBe('q1-0'); // oldest 100 evicted
	});

	it('survives corrupted stored JSON', () => {
		localStorage.setItem('bp:quiz:v1:r1', '{nope');
		expect(loadResponses('r1')).toEqual([]);
		recordAnswers('r1', [answer('a', true)]);
		expect(loadResponses('r1')).toHaveLength(1);
	});

	it('tracks the timed personal best', () => {
		expect(getTimedBest('r1')).toBeNull();
		expect(recordTimedResult('r1', { score: 5, bestStreak: 3 }, 1).isNewBest).toBe(true);
		expect(recordTimedResult('r1', { score: 4, bestStreak: 4 }, 2).isNewBest).toBe(false);
		expect(recordTimedResult('r1', { score: 5, bestStreak: 4 }, 3).isNewBest).toBe(true); // streak tiebreak
		expect(getTimedBest('r1')).toMatchObject({ score: 5, bestStreak: 4, at: 3 });
	});

	it('falls back to memory when localStorage is missing', () => {
		delete (globalThis as { localStorage?: Storage }).localStorage;
		recordAnswers('r1', [answer('a', true)]);
		expect(loadResponses('r1')).toHaveLength(1); // memory fallback within the session
	});

	it('falls back to memory when setItem throws (quota exceeded)', () => {
		const backing = fakeLocalStorage();
		(globalThis as { localStorage?: Storage }).localStorage = {
			...backing,
			getItem: (k: string) => backing.getItem(k),
			setItem: () => {
				throw new DOMException('quota exceeded', 'QuotaExceededError');
			}
		} as Storage;
		expect(() => recordAnswers('r1', [answer('a', true)], 1)).not.toThrow();
		expect(loadResponses('r1')).toMatchObject([{ questionId: 'a', correct: true, at: 1 }]); // memory mirror
	});

	it('falls back to memory when getItem throws (blocked storage)', () => {
		(globalThis as { localStorage?: Storage }).localStorage = {
			getItem: () => {
				throw new DOMException('blocked', 'SecurityError');
			},
			setItem: () => {
				throw new DOMException('blocked', 'SecurityError');
			}
		} as unknown as Storage;
		expect(loadResponses('r1')).toEqual([]); // fresh state, no throw
		expect(() => recordAnswers('r1', [answer('a', true)], 1)).not.toThrow();
		expect(loadResponses('r1')).toHaveLength(1); // served from memory
	});
});
