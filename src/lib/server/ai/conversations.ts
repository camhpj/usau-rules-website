import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { aiConversations } from '$lib/server/db/schema';

/**
 * Look up a conversation the caller owns and has not deleted.
 *
 * Returns null for "no such conversation" and "not yours" alike. Callers must
 * keep collapsing the two: distinguishing them hands an attacker an existence
 * oracle for a foreign conversation id.
 */
export async function getOwnedConversation(
	db: Db,
	id: string,
	userId: string
): Promise<{ id: string; rulesetId: string; title: string } | null> {
	const rows = await db
		.select({
			id: aiConversations.id,
			rulesetId: aiConversations.rulesetId,
			title: aiConversations.title
		})
		.from(aiConversations)
		.where(
			and(
				eq(aiConversations.id, id),
				eq(aiConversations.userId, userId),
				isNull(aiConversations.deletedAt)
			)
		)
		.limit(1);
	return rows[0] ?? null;
}
