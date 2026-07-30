import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookmarks } from './bookmarks.svelte';

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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	bookmarks.reset();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('bookmarks.load', () => {
	it('populates keys and enables on a valid body', async () => {
		fetchMock.mockResolvedValueOnce(
			okJson({ bookmarks: [{ rulesetId: 'r', ruleId: '1', createdAt: 1 }] })
		);
		await bookmarks.load();
		expect(bookmarks.enabled).toBe(true);
		expect(bookmarks.has('r', '1')).toBe(true);
	});

	it('stays disabled on a non-ok response (e.g. signed out)', async () => {
		fetchMock.mockResolvedValueOnce(okJson({ message: 'sign in' }, 401));
		await bookmarks.load();
		expect(bookmarks.enabled).toBe(false);
	});

	it('stays disabled on a schema-invalid body', async () => {
		fetchMock.mockResolvedValueOnce(okJson({ nope: true }));
		await bookmarks.load();
		expect(bookmarks.enabled).toBe(false);
	});

	it('stays disabled on a network error', async () => {
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		await bookmarks.load();
		expect(bookmarks.enabled).toBe(false);
	});
});

describe('bookmarks.toggle', () => {
	it('optimistically adds and keeps it on success', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
		await bookmarks.toggle('r', '1');
		expect(bookmarks.has('r', '1')).toBe(true);
	});

	it('rolls back the optimistic add on failure', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
		await bookmarks.toggle('r', '1');
		expect(bookmarks.has('r', '1')).toBe(false);
	});

	it('rolls back the optimistic add on a network error', async () => {
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		await bookmarks.toggle('r', '1');
		expect(bookmarks.has('r', '1')).toBe(false);
	});

	it('rolls back an optimistic removal on failure', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
		await bookmarks.toggle('r', '1');
		expect(bookmarks.has('r', '1')).toBe(true);

		fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
		await bookmarks.toggle('r', '1');
		expect(bookmarks.has('r', '1')).toBe(true);
	});

	// For a plain add/remove toggle, "older fails after a newer same-key toggle
	// succeeds" can never disagree with the newer call's own outcome — the two
	// requests are exact complements, so the older call's inverse always lands
	// on the same value the newer call already confirmed. The actual defect
	// only surfaces when BOTH requests fail and the stale (older) one resolves
	// last: its revert is computed from `had` alone, so it unconditionally
	// overwrites whatever the newer call already decided.
	it('does not let a stale toggle overwrite a newer same-key toggle once both have failed', async () => {
		const first = deferred<Response>();
		const second = deferred<Response>();
		fetchMock.mockImplementationOnce(() => first.promise);
		fetchMock.mockImplementationOnce(() => second.promise);

		const firstToggle = bookmarks.toggle('r', '1'); // optimistic add
		const secondToggle = bookmarks.toggle('r', '1'); // optimistic remove, sees the add

		// The second (newer) request fails first. Its own revert undoes its own
		// optimistic removal, so the key goes back to present.
		second.resolve(new Response(null, { status: 500 }));
		await secondToggle;
		expect(bookmarks.has('r', '1')).toBe(true);

		// The first (older, now-stale) request fails last. It must not run its
		// own revert on top of the newer call's already-settled outcome.
		first.resolve(new Response(null, { status: 500 }));
		await firstToggle;

		expect(bookmarks.has('r', '1')).toBe(true);
	});
});
