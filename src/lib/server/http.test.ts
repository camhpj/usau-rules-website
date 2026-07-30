import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonBody, requireAuth, requireDb } from './http';

const Schema = z.object({ name: z.string() });

function req(body: string): Request {
	return new Request('https://example.test/', { method: 'POST', body });
}

describe('parseJsonBody', () => {
	it('returns the parsed value on a valid body', async () => {
		await expect(parseJsonBody(req('{"name":"ada"}'), Schema)).resolves.toEqual({ name: 'ada' });
	});

	it('throws a 400 on malformed JSON', async () => {
		await expect(parseJsonBody(req('{not json'), Schema)).rejects.toMatchObject({ status: 400 });
	});

	it('throws a 400 when the body fails the schema', async () => {
		await expect(parseJsonBody(req('{"name":42}'), Schema)).rejects.toMatchObject({ status: 400 });
	});

	it('uses the caller-supplied message', async () => {
		await expect(
			parseJsonBody(req('{}'), Schema, 'invalid bookmark payload')
		).rejects.toMatchObject({ body: { message: 'invalid bookmark payload' } });
	});
});

describe('requireDb', () => {
	it('returns the binding when present', () => {
		const db = {} as never;
		expect(requireDb({ db } as never)).toBe(db);
	});

	it('throws a 500 naming the binding when absent', () => {
		expect(() => requireDb({} as never)).toThrowError(
			expect.objectContaining({
				status: 500,
				body: { message: 'database unavailable' }
			})
		);
	});
});

describe('requireAuth', () => {
	it('returns the binding when present', () => {
		const auth = {} as never;
		expect(requireAuth({ auth } as never)).toBe(auth);
	});

	it('throws a 500 naming the binding when absent', () => {
		expect(() => requireAuth({} as never)).toThrowError(
			expect.objectContaining({
				status: 500,
				body: { message: 'auth unavailable' }
			})
		);
	});
});
