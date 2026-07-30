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
});
