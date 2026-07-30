import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { pageRows, parseHistoryQuery } from '$lib/server/ai/history';
import { aiConversations, aiMessages, user } from '$lib/server/db/schema';
import { requireDb } from '$lib/server/http';

/** Cursor stack from the URL: 'start' for page 1, else '<before>:<beforeId>'. */
function parseStack(raw: string | null): string[] {
	return raw ? raw.split(',').filter((entry) => entry.length > 0) : [];
}

export const load: PageServerLoad = async (event) => {
	await event.parent();
	const { before, beforeId, limit } = parseHistoryQuery(event.url.searchParams, 30);
	const downOnly = event.url.searchParams.get('down') === '1';
	const stack = parseStack(event.url.searchParams.get('stack'));
	const db = requireDb(event.locals);

	// Correlated subqueries, one per displayed row, instead of grouping all of
	// ai_messages up front. Both ride ai_messages_convo_created_idx, so cost scales
	// with the page size, not the table size.
	const messagesCount = sql<number>`(select count(*) from ${aiMessages} where ${aiMessages.conversationId} = ${aiConversations.id})`;
	const downExists = sql`exists (select 1 from ${aiMessages} where ${aiMessages.conversationId} = ${aiConversations.id} and ${aiMessages.feedback} = 'down')`;

	let q = db
		.select({
			id: aiConversations.id,
			title: aiConversations.title,
			rulesetId: aiConversations.rulesetId,
			updatedAt: aiConversations.updatedAt,
			deletedAt: aiConversations.deletedAt,
			email: user.email,
			messages: messagesCount,
			hasDown: sql<number>`(select ${downExists})`
		})
		.from(aiConversations)
		.innerJoin(user, eq(user.id, aiConversations.userId))
		.$dynamic();

	const conds = [];
	if (before !== null) {
		// Compound cursor: updated_at is not unique, so ties are broken by id. Without
		// this, a row sharing a millisecond across a page boundary appears on no page.
		conds.push(
			beforeId === null
				? lt(aiConversations.updatedAt, before)
				: or(
						lt(aiConversations.updatedAt, before),
						and(eq(aiConversations.updatedAt, before), lt(aiConversations.id, beforeId))
					)!
		);
	}
	if (downOnly) conds.push(downExists);
	if (conds.length) q = q.where(and(...conds));

	const rows = await q
		.orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
		.limit(limit + 1);
	const { items, hasMore } = pageRows(rows, limit);
	const last = hasMore ? items[items.length - 1] : null;
	return {
		conversations: items,
		hasMore,
		nextBefore: last?.updatedAt ?? null,
		nextBeforeId: last?.id ?? null,
		downOnly,
		before,
		beforeId,
		stack,
		pageNumber: stack.length + 1
	};
};
