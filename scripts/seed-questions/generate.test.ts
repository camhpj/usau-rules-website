import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/lib/quiz/types';
import type { Target } from './targets';
import {
	buildPrompt,
	generateSection,
	parseDraftArray,
	toQuestions,
	validateDrafts,
	type Draft,
	type SectionJob
} from './generate';

const draft = (over: Partial<Draft> = {}): Draft => ({
	prompt: 'What restarts play after an uncontested stall?',
	choices: ['A check', 'A pull', 'A brick', 'Nothing'],
	answerIndex: 0,
	explanation: 'Per 15.D.1 the thrower checks the disc in.',
	ruleRefs: ['15.D.1'],
	difficulty: 2,
	...over
});

const existing: Question = {
	id: '15-01',
	rulesetId: 'usau-official-2026-27',
	type: 'multiple-choice',
	prompt: 'The thrower still has the disc at “ten”?',
	choices: ['a', 'b', 'c', 'd'],
	answerIndex: 0,
	explanation: 'Turnover per 15.D and play stops.',
	ruleRefs: ['15.D'],
	sectionSlug: '15',
	difficulty: 1
};

const targetD: Target = { id: '15.D', sectionSlug: '15', score: 9, text: 'stall count text' };
const targetE: Target = { id: '15.E', sectionSlug: '15', score: 3, text: 'other rule text' };

const job: SectionJob = {
	rulesetId: 'usau-official-2026-27',
	sectionSlug: '15',
	sectionTitle: '15. Stalling',
	grounding: '## 15. Stalling\n[15.D] stall text\n[15.D.1] check text\n[15.E] other text',
	targets: [targetD, targetE],
	existing: [existing]
};
const ruleIds = new Set(['15', '15.D', '15.D.1', '15.E']);

describe('buildPrompt', () => {
	it('lists each target with its priority order and the must-cite instruction', () => {
		const prompt = buildPrompt(job, job.targets, []);
		expect(prompt).toContain('[15.D] stall count text');
		expect(prompt).toContain('[15.E] other rule text');
		expect(prompt).toMatch(/one question/i);
		expect(prompt).toMatch(/target rule id itself|MUST include the target/i);
	});

	it('a round-2 call with only unfulfilled targets omits the fulfilled one', () => {
		const prompt = buildPrompt(job, [targetE], []);
		// grounding still includes the full section text (incl. 15.D's rule text), but the
		// target list itself must only mention the requested target's own text.
		expect(prompt).not.toContain('[15.D] stall count text');
		expect(prompt).toContain('[15.E] other rule text');
	});
});

describe('validateDrafts', () => {
	it('keeps valid drafts and rejects bad refs, dupes, and schema misses', () => {
		const { valid, rejected } = validateDrafts(
			[
				draft(), // cites 15.D.1 -> fulfills target 15.D
				draft({ prompt: 'Q with bad ref?', ruleRefs: ['99.Z'] }),
				draft({ prompt: 'The thrower STILL has the disc at “ten”?' }), // dupe of existing (case-insensitive)
				draft({ prompt: 'Dupe choices question?', choices: ['x', 'x', 'y', 'z'] }),
				{ prompt: 'not a full draft' }
			],
			[existing.prompt],
			ruleIds,
			job.targets
		);
		expect(valid).toHaveLength(1);
		expect(rejected).toHaveLength(4);
	});

	it('rejects a non-array payload', () => {
		expect(validateDrafts({ nope: true }, [], ruleIds, job.targets).valid).toHaveLength(0);
	});

	it('rejects a draft whose ruleRefs fulfill none of the requested targets', () => {
		const { valid, rejected } = validateDrafts(
			[draft({ prompt: 'Unrelated question?', ruleRefs: ['15.D.1'] })],
			[],
			ruleIds,
			[targetE] // only 15.E requested; draft cites 15.D.1
		);
		expect(valid).toHaveLength(0);
		expect(rejected[0]).toMatch(/no requested target/);
	});
});

describe('toQuestions', () => {
	it('continues numbering after existing questions', () => {
		const [q] = toQuestions([draft()], job);
		expect(q.id).toBe('15-02');
		expect(q.sectionSlug).toBe('15');
		expect(q.rulesetId).toBe(job.rulesetId);
		expect(q.type).toBe('multiple-choice');
	});
});

describe('generateSection', () => {
	it('retries for unfulfilled targets only and merges results', async () => {
		const calls: string[] = [];
		const responses = [
			JSON.stringify([
				draft({ prompt: 'Turnover at ten?', ruleRefs: ['15.D.1'] }), // fulfills 15.D
				draft({ prompt: 'Bad ref?', ruleRefs: ['99.Z'] })
			]),
			JSON.stringify([
				draft({ prompt: 'What governs 15.E?', ruleRefs: ['15.E'] }) // fulfills 15.E
			])
		];
		const { questions, rejected, unfulfilled } = await generateSection(
			job,
			ruleIds,
			async (prompt) => {
				calls.push(prompt);
				return responses[calls.length - 1];
			}
		);
		expect(calls).toHaveLength(2);
		expect(calls[1]).not.toContain('[15.D] stall count text'); // round 2: 15.D no longer in the target list
		expect(calls[1]).toContain('[15.E] other rule text');
		expect(calls[1]).toContain('Turnover at ten?'); // round-1 accepted draft is on the round-2 avoid list
		expect(questions.map((q) => q.id)).toEqual(['15-02', '15-03']);
		expect(rejected).toHaveLength(1);
		expect(unfulfilled).toEqual([]);
	});

	it('accepts at most one question per requested target and rejects surplus drafts', async () => {
		const calls: string[] = [];
		const responses = [
			JSON.stringify([
				draft({ prompt: 'First D question?', ruleRefs: ['15.D'] }),
				draft({ prompt: 'Second D question?', ruleRefs: ['15.D.1'] }),
				draft({ prompt: 'Third D question?', ruleRefs: ['15.D'] })
			]),
			JSON.stringify([])
		];
		const { questions, rejected, unfulfilled } = await generateSection(
			job,
			ruleIds,
			async (prompt) => {
				calls.push(prompt);
				return responses[calls.length - 1];
			}
		);
		expect(questions).toHaveLength(1);
		expect(questions[0].prompt).toBe('First D question?');
		expect(rejected.filter((r) => r.includes('already fulfilled this run'))).toHaveLength(2);
		expect(unfulfilled).toEqual(['15.E']);
		expect(calls).toHaveLength(2);
		expect(calls[1]).not.toContain('[15.D] stall count text'); // retry requests only the unfulfilled target
		expect(calls[1]).toContain('[15.E] other rule text');
	});

	it('returns unfulfilled target ids when the model skips a target on both attempts', async () => {
		const onlyD = JSON.stringify([draft({ prompt: 'Turnover at ten?', ruleRefs: ['15.D.1'] })]);
		const { questions, unfulfilled } = await generateSection(job, ruleIds, async () => onlyD);
		expect(questions.map((q) => q.ruleRefs[0])).toEqual(['15.D.1']);
		expect(unfulfilled).toEqual(['15.E']);
	});

	it('returns all targets unfulfilled when both attempts come back empty', async () => {
		const { questions, unfulfilled } = await generateSection(job, ruleIds, async () =>
			JSON.stringify([])
		);
		expect(questions).toHaveLength(0);
		expect(unfulfilled.sort()).toEqual(['15.D', '15.E']);
	});

	it('survives a non-JSON model response and still retries', async () => {
		const calls: string[] = [];
		const { questions, rejected } = await generateSection(job, ruleIds, async (prompt) => {
			calls.push(prompt);
			return 'sorry!';
		});
		expect(questions).toHaveLength(0);
		expect(rejected.length).toBeGreaterThan(0);
		expect(calls).toHaveLength(2);
	});
});

describe('parseDraftArray', () => {
	it('passes valid JSON through unsalvaged', () => {
		const { value, salvaged } = parseDraftArray('[{"a":1},{"b":2}]');
		expect(salvaged).toBe(false);
		expect(value).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it('salvages the valid prefix when a comma is missing between elements', () => {
		const raw = '[{"a":1},{"b":2}\n{"c":3}]';
		const { value, salvaged } = parseDraftArray(raw);
		expect(salvaged).toBe(true);
		expect(value).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it('salvages a truncated array', () => {
		const raw = '[{"a":1},{"b":2},{"c":';
		const { value, salvaged } = parseDraftArray(raw);
		expect(salvaged).toBe(true);
		expect(value).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it('throws with a context snippet when nothing is salvageable', () => {
		expect(() => parseDraftArray('not json at all')).toThrow();
		expect(() => parseDraftArray('{"a": oops}')).toThrow(/context around failure/);
	});
});
