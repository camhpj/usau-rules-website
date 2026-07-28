import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { ruleIdSet, RuleIdsSchema } from './rule-id-sets';

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

describe('RuleIdsSchema', () => {
	it('rejects a rule-ids payload that is not an array of non-empty strings', () => {
		expect(RuleIdsSchema.safeParse(['1', '1.A']).success).toBe(true);
		expect(RuleIdsSchema.safeParse([]).success).toBe(true);
		expect(RuleIdsSchema.safeParse(['1', 42]).success).toBe(false);
		expect(RuleIdsSchema.safeParse(['1', '']).success).toBe(false);
		expect(RuleIdsSchema.safeParse({ ids: ['1'] }).success).toBe(false);
	});
});
