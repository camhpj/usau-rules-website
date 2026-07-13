import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { ruleIdSet } from './rule-id-sets';

describe('ruleIdSet', () => {
	it('contains rule ids and section anchors', () => {
		const ids = ruleIdSet(DEFAULT_RULESET_ID);
		expect(ids.has('15.A')).toBe(true);
		expect(ids.has('preface')).toBe(true);
		expect(ids.has('not-a-rule')).toBe(false);
	});
	it('is empty for unknown rulesets', () => {
		expect(ruleIdSet('nope').size).toBe(0);
	});
});
