import { error, json } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { PutDisplayNameSchema } from '$lib/profile/payload';
import {
	resolveUniqueName,
	suggestDisplayName,
	validateDisplayName
} from '$lib/server/profile/display-name';
import { isUniqueConstraintError } from '$lib/server/profile/errors';
import { parseJsonBody, requireDb } from '$lib/server/http';
import { user } from '$lib/server/db/schema';
import { fetchDisplayNameState } from '$lib/server/quiz/queries';
import { requireUser } from '$lib/server/session';
import type { Db } from '$lib/server/db';

async function isTakenBy(db: Db, candidate: string, ownUserId: string): Promise<boolean> {
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(sql`lower(${user.displayName}) = lower(${candidate})`)
		.limit(1);
	return rows.length > 0 && rows[0].id !== ownUserId;
}

export const GET: RequestHandler = async (event) => {
	const me = await requireUser(event);
	const db = requireDb(event.locals);
	const row = await fetchDisplayNameState(db, me.id);
	return json({
		displayName: row?.displayName ?? null,
		suggestion: suggestDisplayName(row?.name ?? '')
	});
};

export const PUT: RequestHandler = async (event) => {
	const me = await requireUser(event);
	const data = await parseJsonBody(
		event.request,
		PutDisplayNameSchema,
		'invalid display-name payload'
	);
	const db = requireDb(event.locals);

	if (data.displayName === null) {
		await db.update(user).set({ displayName: null }).where(eq(user.id, me.id));
		return json({ displayName: null });
	}

	const validated = validateDisplayName(data.displayName);
	if (!validated.ok) error(400, validated.reason);

	const taken = (candidate: string) => isTakenBy(db, candidate, me.id);
	let finalName = validated.name;
	if (await taken(finalName)) {
		const resolved = await resolveUniqueName(finalName, taken);
		if (!data.resolveConflict) {
			return json(
				{ suggestion: resolved ?? undefined, message: 'that name is taken' },
				{ status: 409 }
			);
		}
		if (!resolved) error(400, 'that name is taken — try another');
		finalName = resolved;
	}

	// The unique index is the backstop for set-set races: retry once with a re-resolve.
	try {
		await db.update(user).set({ displayName: finalName }).where(eq(user.id, me.id));
	} catch (err) {
		if (!isUniqueConstraintError(err)) throw err;
		const retry = await resolveUniqueName(validated.name, taken);
		if (!data.resolveConflict) {
			return json(
				{ suggestion: retry ?? undefined, message: 'that name is taken' },
				{ status: 409 }
			);
		}
		if (!retry) error(409, 'that name is taken');
		finalName = retry;
		try {
			await db.update(user).set({ displayName: finalName }).where(eq(user.id, me.id));
		} catch (retryErr) {
			if (isUniqueConstraintError(retryErr)) error(409, 'that name is taken');
			throw retryErr;
		}
	}
	return json({ displayName: finalName });
};
