import { describe, expect, it } from 'vitest';
import { ScenarioQuotaSchema, ScenarioRequestSchema } from './payload';

describe('ScenarioRequestSchema', () => {
	it('accepts empty body and a difficulty', () => {
		expect(ScenarioRequestSchema.safeParse({}).success).toBe(true);
		expect(ScenarioRequestSchema.safeParse({ difficulty: 3 }).success).toBe(true);
		expect(ScenarioRequestSchema.safeParse({ difficulty: 4 }).success).toBe(false);
	});
});

describe('ScenarioQuotaSchema', () => {
	it('accepts a non-negative remaining count', () => {
		expect(ScenarioQuotaSchema.safeParse({ remaining: 9 }).success).toBe(true);
	});
	it('rejects a negative remaining count', () => {
		expect(ScenarioQuotaSchema.safeParse({ remaining: -1 }).success).toBe(false);
	});
});
