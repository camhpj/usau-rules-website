import { describe, expect, it } from 'vitest';
import { collectRuleIds, sectionSlugForRuleId } from './rule-ids';
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
