import { describe, expect, it } from 'vitest';
import { collectRuleIds, nearestKnownRuleId, sectionSlugForRuleId } from './rule-ids';
import type { Section } from './types';

describe('sectionSlugForRuleId (moved from ingest)', () => {
	it('still maps ids to slugs', () => {
		expect(sectionSlugForRuleId('15.A.3')).toBe('15');
		expect(sectionSlugForRuleId('B1.G.1')).toBe('appendix-b');
		expect(sectionSlugForRuleId('preface')).toBe('preface');
	});
});

describe('collectRuleIds', () => {
	it('collects nested rule ids and section anchors', () => {
		const rule = (id: string, children: unknown[] = []): never =>
			({ id, label: `${id}.`, html: '', text: 'x', annotations: [], refs: [], children }) as never;
		const sections: Section[] = [
			{
				slug: '9',
				anchorId: '9',
				number: '9',
				kind: 'section',
				title: 'The Pull',
				html: null,
				rules: [rule('9.A'), rule('9.K', [rule('9.K.4')])]
			}
		];
		const ids = collectRuleIds(sections);
		expect(ids.has('9')).toBe(true);
		expect(ids.has('9.K.4')).toBe(true);
		expect(ids.has('9.Z')).toBe(false);
	});
});

describe('nearestKnownRuleId', () => {
	const ids = new Set(['15.F.2', '20.E.2.d']);

	it('returns the id itself when it is already known', () => {
		expect(nearestKnownRuleId('15.F.2', ids)).toBe('15.F.2');
	});

	it('walks up to the nearest known dotted ancestor', () => {
		expect(nearestKnownRuleId('15.F.2.b', ids)).toBe('15.F.2');
	});

	it('returns null when neither the id nor any ancestor is known', () => {
		expect(nearestKnownRuleId('99.ZZ', ids)).toBe(null);
	});
});
