import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { BookmarkTargetSchema } from '$lib/bookmarks/payload';
import { getManifest } from '$lib/content/manifests';
import { sectionSlugForRuleId } from '$lib/content/rule-ids';
import { parseJsonBody, requireDb } from '$lib/server/http';
import { bookmarks } from '$lib/server/db/schema';
import { fetchBookmarks } from '$lib/server/quiz/queries';
import { requireUser } from '$lib/server/session';

/** Shape-level validation: the ruleset must exist and the rule id must map to one of its sections. */
function validateTarget(rulesetId: string, ruleId: string): void {
	let manifest;
	try {
		manifest = getManifest(rulesetId);
	} catch {
		error(400, 'unknown ruleset');
	}
	const slug = sectionSlugForRuleId(ruleId);
	if (!slug || !manifest.sections.some((s) => s.slug === slug)) error(400, 'unknown rule id');
}

async function parseBody(request: Request) {
	return parseJsonBody(request, BookmarkTargetSchema, 'invalid bookmark payload');
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const db = requireDb(event.locals);
	const rows = await fetchBookmarks(db, user.id);
	return json({ bookmarks: rows });
};

export const PUT: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { rulesetId, ruleId } = await parseBody(event.request);
	validateTarget(rulesetId, ruleId);
	const db = requireDb(event.locals);
	await db
		.insert(bookmarks)
		.values({ userId: user.id, rulesetId, ruleId, createdAt: Date.now() })
		.onConflictDoNothing();
	return json({ ok: true });
};

export const DELETE: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { rulesetId, ruleId } = await parseBody(event.request);
	const db = requireDb(event.locals);
	await db
		.delete(bookmarks)
		.where(
			and(
				eq(bookmarks.userId, user.id),
				eq(bookmarks.rulesetId, rulesetId),
				eq(bookmarks.ruleId, ruleId)
			)
		);
	return json({ ok: true });
};
