import { describe, expect, it } from 'vitest';
import type { Question } from '../../src/lib/quiz/types';
import type { RuleNode, Section } from '../../src/lib/content/types';
import { computeInDegree, computeTargets, uncoveredTargets, type Target } from './targets';

const rule = (over: Partial<RuleNode>): RuleNode => ({
	id: 'X',
	label: 'X.',
	html: '',
	text: '',
	annotations: [],
	refs: [],
	children: [],
	...over
});

// Section 15 "Stalling":
//  - 15.D (depth0, 1 annotation, referenced twice from section 9) -> high score, long text
//     - 15.D.1 (depth1, no refs/annotations) -> below threshold on its own, but covers 15.D
//  - 15.DD (depth0, no refs/annotations) -> unrelated-prefix sibling of 15.D
//  - 15.E (depth0, SHORT text) -> bare header, excluded via minTextLength
//     - 15.E.1 (depth1, 1 annotation) -> real target reached via the header's children
const section15: Section = {
	slug: '15',
	anchorId: '15',
	number: '15',
	kind: 'section',
	title: 'Stalling',
	html: null,
	rules: [
		rule({
			id: '15.D',
			label: '15.D.',
			text: 'The stall count rule text is here and long enough for the min length test.',
			annotations: ['Signal loudly and clearly.'],
			children: [
				rule({
					id: '15.D.1',
					label: '15.D.1.',
					text: 'Check-in procedure text after a stoppage of play happens here now.'
				})
			]
		}),
		rule({
			id: '15.DD',
			label: '15.DD.',
			text: 'A distinct rule with an unrelated prefix similar to 15.D for boundary testing.'
		}),
		rule({
			id: '15.E',
			label: '15.E.',
			text: 'Short header.',
			children: [
				rule({
					id: '15.E.1',
					label: '15.E.1.',
					text: 'Child rule with enough of its own text to be a target on its own merit here.',
					annotations: ['One annotation bumps this above threshold.']
				})
			]
		})
	]
};

// Section 9 "Fouls": 9.A and 9.B both cite 15.D (in-degree = 2); 9.C is deeply
// nested (depth 2, no refs/annotations) so its depth bonus is 0 -> below threshold.
const section9: Section = {
	slug: '9',
	anchorId: '9',
	number: '9',
	kind: 'section',
	title: 'Fouls',
	html: null,
	rules: [
		rule({
			id: '9.A',
			label: '9.A.',
			text: 'Definition of a foul during play with sufficient length text for the test case.',
			refs: ['15.D']
		}),
		rule({
			id: '9.B',
			label: '9.B.',
			text: 'Another foul-related rule referencing stalling for cross-section in-degree.',
			refs: ['15.D']
		}),
		rule({
			id: '9.C',
			label: '9.C.',
			text: 'Parent header for a deeply nested rule, used only to reach the depth-2 child.',
			children: [
				rule({
					id: '9.C.1',
					label: '9.C.1.',
					text: 'Mid-level rule text, long enough, with no refs or annotations of its own.',
					children: [
						rule({
							id: '9.C.1.a',
							label: '9.C.1.a.',
							text: 'Deeply nested rule with zero depth bonus, zero refs, zero annotations here.'
						})
					]
				})
			]
		})
	]
};

const sections = [section15, section9];

describe('computeInDegree', () => {
	it('counts ref occurrences across all sections, keyed by ref string', () => {
		const inDegree = computeInDegree(sections);
		expect(inDegree.get('15.D')).toBe(2);
		expect(inDegree.get('15.D.1')).toBeUndefined();
		expect(inDegree.get('15.DD')).toBeUndefined();
	});
});

describe('computeTargets', () => {
	const opts = { threshold: 2, minTextLength: 40, exclude: [] as string[] };

	it('scores using in-degree, annotations, and depth bonus, ranked descending', () => {
		const targets = computeTargets(sections, opts);
		const byId = new Map(targets.map((t) => [t.id, t.score]));
		// 15.D: 2*inDegree(2) + 2*annotations(1) + depthBonus(0=+3) = 4+2+3 = 9
		expect(byId.get('15.D')).toBe(9);
		// 15.DD: 2*0 + 2*0 + 3 = 3
		expect(byId.get('15.DD')).toBe(3);
		// 15.E.1: depth1 -> 2*0 + 2*1 + 1 = 3
		expect(byId.get('15.E.1')).toBe(3);
		expect(targets[0].id).toBe('15.D');
		for (let i = 1; i < targets.length; i++) {
			expect(targets[i - 1].score).toBeGreaterThanOrEqual(targets[i].score);
		}
	});

	it('excludes rules below the score threshold', () => {
		const targets = computeTargets(sections, opts);
		expect(targets.some((t) => t.id === '15.D.1')).toBe(false); // score 1 < threshold 2
		expect(targets.some((t) => t.id === '9.C.1.a')).toBe(false); // depth 2, score 0
	});

	it('excludes bare headers via minTextLength even if score qualifies', () => {
		const targets = computeTargets(sections, opts);
		expect(targets.some((t) => t.id === '15.E')).toBe(false); // short text
		expect(targets.some((t) => t.id === '15.E.1')).toBe(true); // reached via child instead
	});

	it('excludes ids listed in opts.exclude', () => {
		const targets = computeTargets(sections, { ...opts, exclude: ['9.B'] });
		expect(targets.some((t) => t.id === '9.B')).toBe(false);
		expect(targets.some((t) => t.id === '9.A')).toBe(true);
	});

	it('attaches the correct sectionSlug and own text', () => {
		const targets = computeTargets(sections, opts);
		const d = targets.find((t) => t.id === '15.D')!;
		expect(d.sectionSlug).toBe('15');
		expect(d.text).toBe(
			'The stall count rule text is here and long enough for the min length test.'
		);
		const a = targets.find((t) => t.id === '9.A')!;
		expect(a.sectionSlug).toBe('9');
	});
});

describe('uncoveredTargets', () => {
	const targets: Target[] = [
		{ id: '15.D', sectionSlug: '15', score: 9, text: 'stall text' },
		{ id: '15.DD', sectionSlug: '15', score: 3, text: 'unrelated prefix text' },
		{ id: '9.A', sectionSlug: '9', score: 3, text: 'foul text' }
	];

	const question = (id: string, ruleRefs: string[]): Question => ({
		id,
		rulesetId: 'usau-official-2026-27',
		type: 'multiple-choice',
		prompt: 'placeholder prompt text?',
		choices: ['a', 'b', 'c', 'd'],
		answerIndex: 0,
		explanation: 'placeholder explanation text',
		ruleRefs,
		sectionSlug: '15',
		difficulty: 1
	});

	it('treats a descendant citation as covering the ancestor target', () => {
		const uncovered = uncoveredTargets(targets, [question('15-01', ['15.D.1'])]);
		expect(uncovered.map((t) => t.id)).toEqual(['15.DD', '9.A']);
	});

	it('treats an exact-id citation as covering', () => {
		const uncovered = uncoveredTargets(targets, [question('9-01', ['9.A'])]);
		expect(uncovered.map((t) => t.id)).toEqual(['15.D', '15.DD']);
	});

	it('does not let a citation of "15.D" cover the unrelated sibling "15.DD"', () => {
		const uncovered = uncoveredTargets(targets, [question('15-01', ['15.D'])]);
		expect(uncovered.map((t) => t.id)).toEqual(['15.DD', '9.A']);
	});

	it('drops already-covered targets and preserves order for the rest', () => {
		const uncovered = uncoveredTargets(targets, [
			question('15-01', ['15.D']),
			question('9-01', ['9.A'])
		]);
		expect(uncovered.map((t) => t.id)).toEqual(['15.DD']);
	});

	it('returns all targets uncovered when there are no questions', () => {
		expect(uncoveredTargets(targets, []).map((t) => t.id)).toEqual(['15.D', '15.DD', '9.A']);
	});
});
