import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { groundingFor } from './grounding';

describe('groundingFor', () => {
	it('returns the bundled rulebook with verbatim id markers', () => {
		const g = groundingFor(DEFAULT_RULESET_ID);
		expect(g).toContain('[1.A]');
		expect(g).toContain('## 1. Introduction');
	});
	it('returns null for an unknown ruleset', () => {
		expect(groundingFor('nope')).toBeNull();
	});
});
