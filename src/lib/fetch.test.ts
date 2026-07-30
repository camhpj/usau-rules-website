import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { safeFetch, safeFetchJson } from './fetch';

const Schema = z.object({ ok: z.literal(true), value: z.string() });

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('safeFetchJson', () => {
	it('200 with a valid body resolves ok with the parsed data', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true, value: 'hi' }, 200));
		const result = await safeFetchJson('/x', undefined, Schema);
		expect(result).toEqual({ ok: true, status: 200, data: { ok: true, value: 'hi' } });
	});

	it('200 with malformed JSON is a failure, not a success', async () => {
		fetchMock.mockResolvedValue(
			new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })
		);
		const result = await safeFetchJson('/x', undefined, Schema);
		expect(result.ok).toBe(false);
		expect(result.status).toBe(200);
	});

	it('200 with a schema-invalid body fails and carries the raw value', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true, value: 42 }, 200));
		const result = await safeFetchJson('/x', undefined, Schema);
		expect(result).toEqual({ ok: false, status: 200, body: { ok: true, value: 42 } });
	});

	it('409 with a readable body reports the status and the raw body', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ suggestion: 'taken' }, 409));
		const result = await safeFetchJson('/x', undefined, Schema);
		expect(result).toEqual({ ok: false, status: 409, body: { suggestion: 'taken' } });
	});

	it('a network throw resolves with a null status', async () => {
		fetchMock.mockRejectedValue(new Error('offline'));
		const result = await safeFetchJson('/x', undefined, Schema);
		expect(result).toEqual({ ok: false, status: null, body: null });
	});
});

describe('safeFetch', () => {
	it('reports a non-ok status with its real status', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
		const result = await safeFetch('/x');
		expect(result).toEqual({ ok: false, status: 401 });
	});

	it('reports a 2xx status as ok', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
		const result = await safeFetch('/x');
		expect(result).toEqual({ ok: true, status: 204 });
	});

	it('a network throw gives a null status', async () => {
		fetchMock.mockRejectedValue(new Error('offline'));
		const result = await safeFetch('/x');
		expect(result).toEqual({ ok: false, status: null });
	});
});
