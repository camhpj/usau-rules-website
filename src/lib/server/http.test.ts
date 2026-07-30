import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonBody } from './http';

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
