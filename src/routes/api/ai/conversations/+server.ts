import { json } from '@sveltejs/kit';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { pageRows, parseHistoryQuery } from '$lib/server/ai/history';
import { aiConversations } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { before, limit } = parseHistoryQuery(event.url.searchParams, 20);
	const conditions = [eq(aiConversations.userId, user.id), isNull(aiConversations.deletedAt)];
	if (before !== null) conditions.push(lt(aiConversations.updatedAt, before));
	const rows = await event.locals.db
		.select({
			id: aiConversations.id,
			title: aiConversations.title,
			updatedAt: aiConversations.updatedAt
		})
		.from(aiConversations)
		.where(and(...conditions))
		.orderBy(desc(aiConversations.updatedAt))
		.limit(limit + 1); // sentinel row for hasMore
	const { items, hasMore } = pageRows(rows, limit);
	return json({ conversations: items, hasMore });
};
