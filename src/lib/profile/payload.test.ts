import { describe, expect, it } from 'vitest';
import { DisplayNameStateSchema, PutDisplayNameSchema } from './payload';

describe('profile payload schemas', () => {
	it('accepts state and put shapes', () => {
		expect(
			DisplayNameStateSchema.safeParse({ displayName: null, suggestion: 'Cameron J.' }).success
		).toBe(true);
		expect(PutDisplayNameSchema.safeParse({ displayName: 'Cameron J.' }).success).toBe(true);
		expect(
			PutDisplayNameSchema.safeParse({ displayName: null, resolveConflict: true }).success
		).toBe(true);
	});
	it('rejects wrong types', () => {
		expect(PutDisplayNameSchema.safeParse({ displayName: 7 }).success).toBe(false);
		expect(PutDisplayNameSchema.safeParse({}).success).toBe(false);
	});
});
