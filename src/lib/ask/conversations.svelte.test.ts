import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversations, ConversationsState } from './conversations.svelte';

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

const okJson = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A promise plus its resolver, so a test can control exactly when a fetch settles. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe('conversations pagination cursor', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		conversations.reset();
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('sends no cursor on the first page', async () => {
		fetchMock.mockResolvedValueOnce(okJson({ conversations: [], hasMore: false }));
		await conversations.load();
		expect(fetchMock.mock.calls[0][0]).toBe('/api/ai/conversations');
	});

	it('derives before and beforeId from the same last row on loadMore', async () => {
		fetchMock.mockResolvedValueOnce(
			okJson({
				conversations: [{ id: 'c1', title: 'One', updatedAt: 1700000000000 }],
				hasMore: true
			})
		);
		await conversations.load();

		fetchMock.mockResolvedValueOnce(okJson({ conversations: [], hasMore: false }));
		await conversations.loadMore();

		const url = new URL(fetchMock.mock.calls[1][0] as string, 'http://localhost');
		expect(url.searchParams.get('before')).toBe('1700000000000');
		expect(url.searchParams.get('beforeId')).toBe('c1');
	});

	it('treats a malformed conversation list like a failed request', async () => {
		vi.stubGlobal('fetch', async () => okJson({ nope: true }));
		const state = new ConversationsState();
		await state.load();
		expect(state.list).toEqual([]);
		expect(state.errorMessage).toBe("Couldn't load your conversations.");
		vi.unstubAllGlobals();
	});
});

describe('conversations.remove races', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		conversations.reset();
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('restores a conversation to its original position when the delete fails', async () => {
		conversations.list = [
			{ id: 'a', title: 'A', updatedAt: 3 },
			{ id: 'b', title: 'B', updatedAt: 2 },
			{ id: 'c', title: 'C', updatedAt: 1 }
		];
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

		const ok = await conversations.remove('b');

		expect(ok).toBe(false);
		expect(conversations.list.map((c) => c.id)).toEqual(['a', 'b', 'c']);
		expect(conversations.errorMessage).toBe("Couldn't delete that conversation — try again.");
	});

	it('keeps a conversation prepended mid-flight even though the delete fails — the bug this task fixes', async () => {
		conversations.list = [
			{ id: 'a', title: 'A', updatedAt: 2 },
			{ id: 'old', title: 'Old', updatedAt: 1 }
		];
		const request = deferred<Response>();
		fetchMock.mockImplementationOnce(() => request.promise);

		const pendingRemove = conversations.remove('a');
		// A different conversation lands in the sidebar while 'a's delete is in flight.
		conversations.prepend({ id: 'b', title: 'B', updatedAt: 3 });

		request.resolve(new Response(null, { status: 500 }));
		const ok = await pendingRemove;

		expect(ok).toBe(false);
		const ids = conversations.list.map((c) => c.id);
		expect(ids).toContain('a');
		expect(ids).toContain('b');
	});
});
