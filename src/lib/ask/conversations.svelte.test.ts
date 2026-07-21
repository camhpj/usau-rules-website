import { describe, expect, it } from 'vitest';
import { conversations } from './conversations.svelte';

describe('conversations.resolve', () => {
	it('dedupes against a row concurrently fetched by load()', () => {
		conversations.reset();

		const tempKey = 'new-abc123';
		conversations.list = [{ id: tempKey, title: 'Optimistic title', updatedAt: 1, pending: true }];

		// Simulate a background load() completing after the send but before
		// resolve() — it fetched the real row under its own server id.
		conversations.list = [
			...conversations.list,
			{ id: 'real-id-1', title: 'Real title', updatedAt: 2 }
		];

		conversations.resolve(tempKey, { id: 'real-id-1', title: 'Real title', updatedAt: 2 });

		const matches = conversations.list.filter((c) => c.id === 'real-id-1');
		expect(matches).toHaveLength(1);
		expect(matches[0].pending).toBeUndefined();
		expect(conversations.list.some((c) => c.id === tempKey)).toBe(false);
	});
});
