import { desc, eq, lt, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { pageRows, parseHistoryQuery } from '$lib/server/ai/history';
import { aiConversations, aiMessages, user } from '$lib/server/db/schema';

export const load: PageServerLoad = async (event) => {
	await event.parent();
	const { before, limit } = parseHistoryQuery(event.url.searchParams, 30);
	const downOnly = event.url.searchParams.get('down') === '1';
	const db = event.locals.db;

	const msgCount = db
		.select({ conversationId: aiMessages.conversationId, n: sql<number>`count(*)`.as('n') })
		.from(aiMessages)
		.groupBy(aiMessages.conversationId)
		.as('msg_count');
	const downFlag = db
		.select({ conversationId: aiMessages.conversationId, has: sql<number>`1`.as('has') })
		.from(aiMessages)
		.where(eq(aiMessages.feedback, 'down'))
		.groupBy(aiMessages.conversationId)
		.as('down_flag');

	let q = db
		.select({
			id: aiConversations.id,
			title: aiConversations.title,
			rulesetId: aiConversations.rulesetId,
			updatedAt: aiConversations.updatedAt,
			deletedAt: aiConversations.deletedAt,
			email: user.email,
			messages: sql<number>`coalesce(${msgCount.n}, 0)`,
			hasDown: sql<number>`coalesce(${downFlag.has}, 0)`
		})
		.from(aiConversations)
		.innerJoin(user, eq(user.id, aiConversations.userId))
		.leftJoin(msgCount, eq(msgCount.conversationId, aiConversations.id))
		.leftJoin(downFlag, eq(downFlag.conversationId, aiConversations.id))
		.$dynamic();

	const conds = [];
	if (before !== null) conds.push(lt(aiConversations.updatedAt, before));
	if (downOnly) conds.push(sql`coalesce(${downFlag.has}, 0) = 1`);
	if (conds.length) q = q.where(conds.length === 1 ? conds[0] : sql.join(conds, sql` and `));

	const rows = await q.orderBy(desc(aiConversations.updatedAt)).limit(limit + 1);
	const { items, hasMore } = pageRows(rows, limit);
	const nextBefore = hasMore ? items[items.length - 1].updatedAt : null;
	return { conversations: items, hasMore, nextBefore, downOnly };
};
