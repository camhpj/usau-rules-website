import { describe, expect, it } from 'vitest';
import { ASK_MAX_PROMPT_CHARS, AskPayloadSchema, ScenarioRequestSchema } from './payload';

describe('AskPayloadSchema', () => {
	it('trims and accepts a normal question', () => {
		const r = AskPayloadSchema.safeParse({ prompt: '  Is it a stall at ten?  ' });
		expect(r.success && r.data.prompt).toBe('Is it a stall at ten?');
	});
	it('rejects empty, too-long, and missing prompts', () => {
		expect(AskPayloadSchema.safeParse({ prompt: '  a ' }).success).toBe(false);
		expect(
			AskPayloadSchema.safeParse({ prompt: 'x'.repeat(ASK_MAX_PROMPT_CHARS + 1) }).success
		).toBe(false);
		expect(AskPayloadSchema.safeParse({}).success).toBe(false);
	});
});

describe('ScenarioRequestSchema', () => {
	it('accepts empty body and a difficulty', () => {
		expect(ScenarioRequestSchema.safeParse({}).success).toBe(true);
		expect(ScenarioRequestSchema.safeParse({ difficulty: 3 }).success).toBe(true);
		expect(ScenarioRequestSchema.safeParse({ difficulty: 4 }).success).toBe(false);
	});
});
