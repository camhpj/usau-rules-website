import { json } from '@sveltejs/kit';
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { pageRows, parseHistoryQuery } from '$lib/server/ai/history';
import { aiConversations } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { before, beforeId, limit } = parseHistoryQuery(event.url.searchParams, 20);
	const conditions = [eq(aiConversations.userId, user.id), isNull(aiConversations.deletedAt)];
	if (before !== null) {
		// Compound cursor: updated_at is not unique, so ties are broken by id. Without
		// this, a row sharing a millisecond across a page boundary appears on no page.
		conditions.push(
			beforeId === null
				? lt(aiConversations.updatedAt, before)
				: or(
						lt(aiConversations.updatedAt, before),
						and(eq(aiConversations.updatedAt, before), lt(aiConversations.id, beforeId))
					)!
		);
	}
	const rows = await event.locals.db
		.select({
			id: aiConversations.id,
			title: aiConversations.title,
			updatedAt: aiConversations.updatedAt
		})
		.from(aiConversations)
		.where(and(...conditions))
		.orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
		.limit(limit + 1); // sentinel row for hasMore
	const { items, hasMore } = pageRows(rows, limit);
	return json({ conversations: items, hasMore });
};
