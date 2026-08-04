import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import type { Db } from '$lib/server/db';
import type { RequestEvent } from './$types';
import { POST } from './+server';

/**
 * A fake `Db` covering only what `recordAttempt` touches once a payload clears
 * validation: the clientId dedup lookup (always empty, so nothing is ever a
 * duplicate) and the batch insert (always succeeds). Mirrors
 * `record-attempt.test.ts`'s fake, simplified — this suite isn't asserting on
 * what got written, only that a matching payload reaches persistence at all.
 */
function fakeDb(): Db {
	const db = {
		select() {
			return { from: () => ({ where: () => ({ limit: async () => [] }) }) };
		},
		insert() {
			return { values: () => ({}) };
		},
		batch: async () => undefined
	};
	return db as unknown as Db;
}

function fakeEvent(body: unknown): RequestEvent {
	return {
		request: { json: async () => body } as unknown as Request,
		locals: {
			auth: { api: { getSession: async () => ({ user: { id: 'user-1' } }) } },
			db: fakeDb()
		}
	} as unknown as RequestEvent;
}

const now = Date.now();

// '1-01' (section '1') and '10-01' (section '10') are real, committed questions —
// see content/questions/usau-official-2026-27/{1,10}.json — chosen because they sit
// in different sections, which is exactly what the sectionSlug check cares about.
function payload(overrides: Record<string, unknown> = {}) {
	return {
		clientId: crypto.randomUUID(),
		rulesetId: DEFAULT_RULESET_ID,
		mode: 'quick',
		sectionSlug: null,
		startedAt: now - 1000,
		durationS: 30,
		responses: [{ questionId: '1-01', choiceIndex: 0, at: now }],
		...overrides
	};
}

describe('POST /api/attempts', () => {
	it('rejects a sectionSlug that does not match every answered question', async () => {
		const event = fakeEvent(
			payload({
				sectionSlug: '1',
				responses: [
					{ questionId: '1-01', choiceIndex: 0, at: now }, // section '1' — matches
					{ questionId: '10-01', choiceIndex: 0, at: now } // section '10' — does not
				]
			})
		);

		await expect(POST(event)).rejects.toMatchObject({
			status: 400,
			body: { message: 'sectionSlug does not match the answered questions' }
		});
	});

	it('accepts a sectionSlug that matches every answered question', async () => {
		const event = fakeEvent(
			payload({ sectionSlug: '1', responses: [{ questionId: '1-01', choiceIndex: 0, at: now }] })
		);

		const response = await POST(event);

		expect(response.status).toBe(201);
	});

	it('accepts a null sectionSlug regardless of which sections were answered', async () => {
		const event = fakeEvent(
			payload({
				sectionSlug: null,
				responses: [
					{ questionId: '1-01', choiceIndex: 0, at: now },
					{ questionId: '10-01', choiceIndex: 0, at: now }
				]
			})
		);

		const response = await POST(event);

		expect(response.status).toBe(201);
	});
});
