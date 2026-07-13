import { describe, expect, it } from 'vitest';
import {
	buildScenarioPrompt,
	draftToQuestion,
	validateScenario,
	type ScenarioDraft
} from './scenario';

const ruleIds = new Set(['20.E.2.d', '13.A.2', '15.D', '15.F.1']);
const draft: ScenarioDraft = {
	prompt:
		'Kai skies two defenders in the end zone; contact from Morgan sends Kai down beyond the backline. Morgan does not contest the foul call. What is the outcome?',
	choices: ['Goal for Kai.', 'Turnover.', 'Possession at the spot, no goal.', 'Replay the point.'],
	answerIndex: 0,
	explanation: 'Uncontested force-out foul on an end-zone catch awards the goal (20.E.2.d).',
	ruleRefs: ['20.E.2.d'],
	difficulty: 2
};

describe('buildScenarioPrompt', () => {
	it('embeds difficulty, avoid list, and the JSON example', () => {
		const p = buildScenarioPrompt(3, ['old prompt']);
		expect(p).toContain('exactly 3');
		expect(p).toContain('old prompt');
		expect(p).toContain('"ruleRefs"');
	});
	it('leaves difficulty open when unspecified', () => {
		expect(buildScenarioPrompt()).toContain('1, 2, or 3');
	});
});

describe('validateScenario', () => {
	it('accepts a valid draft (and unwraps a 1-element array)', () => {
		expect(validateScenario(draft, ruleIds)).toMatchObject({ ok: true });
		expect(validateScenario([draft], ruleIds)).toMatchObject({ ok: true });
	});
	it('rejects unknown ruleRefs, duplicate choices, and schema misses', () => {
		expect(validateScenario({ ...draft, ruleRefs: ['20.E.2.d', '99.Z'] }, ruleIds)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('99.Z')
		});
		expect(
			validateScenario({ ...draft, choices: ['a. dup', 'a. dup', 'c…', 'd…'] }, ruleIds)
		).toMatchObject({ ok: false, reason: expect.stringContaining('duplicate') });
		expect(validateScenario({ ...draft, answerIndex: 4 }, ruleIds)).toMatchObject({ ok: false });
		expect(validateScenario('not json-shaped', ruleIds)).toMatchObject({ ok: false });
	});

	it('strips a single pair of surrounding square brackets and accepts the bare id', () => {
		const result = validateScenario({ ...draft, ruleRefs: ['[3.N.4]'] }, new Set(['3.N.4']));
		expect(result).toMatchObject({ ok: true });
		if (result.ok) {
			expect(result.draft.ruleRefs).toEqual(['3.N.4']);
		}
	});

	it('substitutes the nearest known ancestor for an unknown lettered leaf ref', () => {
		const result = validateScenario({ ...draft, ruleRefs: ['15.F.1.c'] }, ruleIds);
		expect(result).toMatchObject({ ok: true });
		if (result.ok) {
			expect(result.draft.ruleRefs).toEqual(['15.F.1']);
		}
	});

	it('dedupes normalized refs that collapse onto the same ancestor', () => {
		const result = validateScenario(
			{ ...draft, ruleRefs: ['15.F.1.c', '15.F.1.d', '15.F.1'] },
			ruleIds
		);
		expect(result).toMatchObject({ ok: true });
		if (result.ok) {
			expect(result.draft.ruleRefs).toEqual(['15.F.1']);
		}
	});

	it('rejects a ref with no known ancestor, citing the original string', () => {
		const result = validateScenario({ ...draft, ruleRefs: ['99.Z.q'] }, ruleIds);
		expect(result).toMatchObject({
			ok: false,
			reason: expect.stringContaining('99.Z.q')
		});
	});
});

describe('draftToQuestion', () => {
	it('mints an ai- id and derives the section from the first ruleRef', () => {
		const q = draftToQuestion(draft, 'r');
		expect(q.id).toMatch(/^ai-[0-9a-f-]{36}$/);
		expect(q.rulesetId).toBe('r');
		expect(q.sectionSlug).toBe('20');
		expect(q.type).toBe('multiple-choice');
	});
});
