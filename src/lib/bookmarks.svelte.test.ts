import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookmarks } from './bookmarks.svelte';

const okJson = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

	// Two overlapping toggles of the same key are serialized: the second
	// doesn't read live state, apply, or fire its request until the first has
	// fully settled (request *and* any revert). That means whichever request
	// wins the network race never matters — only submission order and each
	// one's own outcome do. These three cover every outcome combination for a
	// pair; a single toggle failing is covered above.
	describe('two overlapping toggles of the same key', () => {
		it('both fail: ends at the pre-mutation value', async () => {
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 })); // A (PUT) fails
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 })); // B (PUT, sees A's revert) fails

			const a = bookmarks.toggle('r', '1');
			const b = bookmarks.toggle('r', '1');
			await Promise.all([a, b]);

			// Neither request ever persisted, so the bookmark must read exactly as
			// it did before either toggle — absent. A mutex bug that lets a stale
			// revert run against an unconfirmed value instead reports it present.
			expect(bookmarks.has('r', '1')).toBe(false);
		});

		it("A succeeds, B fails: ends at A's confirmed value", async () => {
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // A (PUT) succeeds
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 })); // B (DELETE, sees A's add) fails

			const a = bookmarks.toggle('r', '1');
			const b = bookmarks.toggle('r', '1');
			await Promise.all([a, b]);

			// B's own optimistic removal is reverted, landing back on A's
			// server-confirmed add.
			expect(bookmarks.has('r', '1')).toBe(true);
		});

		it("A fails, B succeeds: ends at B's confirmed value", async () => {
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 })); // A (PUT) fails
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // B (PUT, sees A's revert) succeeds

			const a = bookmarks.toggle('r', '1');
			const b = bookmarks.toggle('r', '1');
			await Promise.all([a, b]);

			// A's failed add is fully undone before B ever reads state, so B
			// starts from the true (absent) baseline and its own add succeeds.
			expect(bookmarks.has('r', '1')).toBe(true);
		});
	});
});
