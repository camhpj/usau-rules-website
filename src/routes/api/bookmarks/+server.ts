import { error, json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getManifest } from '$lib/content/manifests';
import { sectionSlugForRuleId } from '$lib/content/rule-ids';
import { bookmarks } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

const BodySchema = z.object({
	rulesetId: z.string().min(1).max(64),
	ruleId: z.string().min(1).max(64)
});

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
	const parsed = BodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid bookmark payload');
	return parsed.data;
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const rows = await event.locals.db
		.select({
			rulesetId: bookmarks.rulesetId,
			ruleId: bookmarks.ruleId,
			createdAt: bookmarks.createdAt
		})
		.from(bookmarks)
		.where(eq(bookmarks.userId, user.id))
		.orderBy(desc(bookmarks.createdAt));
	return json({ bookmarks: rows });
};

export const PUT: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { rulesetId, ruleId } = await parseBody(event.request);
	validateTarget(rulesetId, ruleId);
	await event.locals.db
		.insert(bookmarks)
		.values({ userId: user.id, rulesetId, ruleId, createdAt: Date.now() })
		.onConflictDoNothing();
	return json({ ok: true });
};

export const DELETE: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { rulesetId, ruleId } = await parseBody(event.request);
	await event.locals.db
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
