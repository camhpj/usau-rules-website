import { describe, expect, it } from 'vitest';
import { nearestKnownRuleId, sectionSlugForRuleId } from './rule-ids';

describe('sectionSlugForRuleId (moved from ingest)', () => {
	it('still maps ids to slugs', () => {
		expect(sectionSlugForRuleId('15.A.3')).toBe('15');
		expect(sectionSlugForRuleId('B1.G.1')).toBe('appendix-b');
		expect(sectionSlugForRuleId('preface')).toBe('preface');
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
