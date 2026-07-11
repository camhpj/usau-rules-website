import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerRecord, QuizItem } from './engine';
import type { Question } from './types';
import { __resetLocal, readRaw, writeRaw } from './local';
import { loadResponses } from './storage';
import { ATTEMPT_MAX_RESPONSES, TIMED_MAX_RESPONSES } from './payload';
import {
	buildAttemptPayload,
	enqueueAttempt,
	flushOutbox,
	hydrateFromServer,
	__resetSync
} from './sync';

const q = (id: string): Question => ({
	id,
	rulesetId: 'r',
	type: 'multiple-choice',
	prompt: `Prompt for ${id}?`,
	choices: ['a', 'b', 'c', 'd'],
	answerIndex: 2,
	explanation: 'Because the rules say so.',
	ruleRefs: ['15.D'],
	sectionSlug: '15',
	difficulty: 1
});

// Display order [2,0,3,1]: display position 0 shows original choice 2 (the correct one).
const item = (id: string): QuizItem => ({ question: q(id), order: [2, 0, 3, 1], correctChoice: 0 });
const record = (id: string, chosenChoice: number): AnswerRecord => ({
	questionId: id,
	sectionSlug: '15',
	chosenChoice,
	correct: chosenChoice === 0
});

const okJson = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	__resetLocal();
	__resetSync();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('buildAttemptPayload', () => {
	it('maps display positions back to original choice indices', () => {
		const payload = buildAttemptPayload({
			rulesetId: 'r',
			mode: 'quick',
			startedAt: 1000,
			durationS: 30,
			items: [item('15-01'), item('15-02')],
			records: [record('15-01', 0), record('15-02', 1)],
			completedAt: 5000
		});
		expect(payload).not.toBeNull();
		expect(payload!.responses).toEqual([
			{ questionId: '15-01', choiceIndex: 2, at: 5000 }, // display 0 → original 2
			{ questionId: '15-02', choiceIndex: 0, at: 5000 } // display 1 → original 0
		]);
		expect(payload!.sectionSlug).toBeNull();
		expect(payload!.clientId).toMatch(/^[0-9a-f-]{36}$/);
	});
	it('returns null when no records match items', () => {
		expect(
			buildAttemptPayload({
				rulesetId: 'r',
				mode: 'mastery',
				sectionSlug: '15',
				startedAt: 1,
				durationS: 1,
				items: [item('15-01')],
				records: []
			})
		).toBeNull();
	});
	it('caps responses at ATTEMPT_MAX_RESPONSES', () => {
		const items: QuizItem[] = [];
		const records: AnswerRecord[] = [];
		for (let i = 0; i < 150; i++) {
			const id = `15-${i}`;
			items.push(item(id));
			records.push(record(id, 0));
		}
		const payload = buildAttemptPayload({
			rulesetId: 'r',
			mode: 'quick',
			startedAt: 1000,
			durationS: 30,
			items,
			records,
			completedAt: 5000
		});
		expect(payload).not.toBeNull();
		expect(payload!.responses).toHaveLength(ATTEMPT_MAX_RESPONSES);
	});
});

describe('outbox flush', () => {
	const payload = () =>
		buildAttemptPayload({
			rulesetId: 'r',
			mode: 'quick',
			startedAt: 1000,
			durationS: 30,
			items: [item('15-01')],
			records: [record('15-01', 0)],
			completedAt: 5000
		})!;

	it('enqueue + successful flush empties the outbox', async () => {
		fetchMock.mockResolvedValue(okJson({ id: 'a1' }, 201));
		enqueueAttempt(payload());
		await flushOutbox();
		expect(fetchMock).toHaveBeenCalledWith(
			'/api/attempts',
			expect.objectContaining({ method: 'POST' })
		);
		expect(JSON.parse(readRaw('bp:sync:v1:outbox') ?? '[]')).toHaveLength(0);
	});
	it('401 keeps the attempt queued for after sign-in', async () => {
		fetchMock.mockResolvedValue(okJson({ message: 'sign in required' }, 401));
		enqueueAttempt(payload());
		await flushOutbox();
		expect(JSON.parse(readRaw('bp:sync:v1:outbox') ?? '[]')).toHaveLength(1);
	});
	it('400 and 409 drop the poison/duplicate entry; network errors keep it', async () => {
		enqueueAttempt(payload());
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		await flushOutbox();
		expect(JSON.parse(readRaw('bp:sync:v1:outbox') ?? '[]')).toHaveLength(1);
		fetchMock.mockResolvedValueOnce(okJson({ message: 'bad' }, 400));
		await flushOutbox();
		expect(JSON.parse(readRaw('bp:sync:v1:outbox') ?? '[]')).toHaveLength(0);
	});
	it('a corrupt outbox entry drops only itself', async () => {
		writeRaw('bp:sync:v1:outbox', JSON.stringify([payload(), { nope: true }]));
		fetchMock.mockResolvedValue(okJson({ id: 'a1' }, 201));
		await flushOutbox();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(readRaw('bp:sync:v1:outbox') ?? '[]')).toHaveLength(0);
	});
});

describe('timed run sync', () => {
	it('beginTimedRun returns the token, null on 401/network error', async () => {
		const { beginTimedRun } = await import('./sync');
		fetchMock.mockResolvedValueOnce(okJson({ token: 't0k' }));
		expect(await beginTimedRun()).toBe('t0k');
		fetchMock.mockResolvedValueOnce(okJson({ message: 'no' }, 401));
		expect(await beginTimedRun()).toBeNull();
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		expect(await beginTimedRun()).toBeNull();
	});
	it('submitTimedRun posts original choice indices in answer order', async () => {
		const { submitTimedRun } = await import('./sync');
		fetchMock.mockResolvedValue(okJson({ score: 1, bestStreak: 1 }, 201));
		await submitTimedRun({
			token: 't0k',
			rulesetId: 'r',
			items: [item('15-01'), item('15-02')],
			records: [record('15-02', 1), record('15-01', 0)]
		});
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.responses).toEqual([
			{ questionId: '15-02', choiceIndex: 0 },
			{ questionId: '15-01', choiceIndex: 2 }
		]);
	});
	it('caps responses at TIMED_MAX_RESPONSES', async () => {
		const { submitTimedRun } = await import('./sync');
		fetchMock.mockResolvedValue(okJson({ score: 1, bestStreak: 1 }, 201));
		const items: QuizItem[] = [];
		const records: AnswerRecord[] = [];
		for (let i = 0; i < 70; i++) {
			const id = `15-${i}`;
			items.push(item(id));
			records.push(record(id, 0));
		}
		await submitTimedRun({ token: 't0k', rulesetId: 'r', items, records });
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.responses).toHaveLength(TIMED_MAX_RESPONSES);
	});
});

describe('hydrateFromServer', () => {
	it('seeds local storage from /api/sync', async () => {
		fetchMock.mockResolvedValue(
			okJson({
				responses: [{ questionId: '9-01', sectionSlug: '9', correct: true, at: 100 }],
				timedBest: null
			})
		);
		await hydrateFromServer('r');
		expect(loadResponses('r')).toHaveLength(1);
	});
	it('ignores errors and malformed payloads', async () => {
		fetchMock.mockResolvedValueOnce(okJson({ nope: true }));
		await hydrateFromServer('r');
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		await hydrateFromServer('r');
		expect(loadResponses('r')).toHaveLength(0);
	});
});
