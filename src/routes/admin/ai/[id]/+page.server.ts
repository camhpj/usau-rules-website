import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { aiConversations, aiMessages, user } from '$lib/server/db/schema';

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const convo = (
		await db
			.select({
				id: aiConversations.id,
				title: aiConversations.title,
				rulesetId: aiConversations.rulesetId,
				deletedAt: aiConversations.deletedAt,
				email: user.email
			})
			.from(aiConversations)
			.innerJoin(user, eq(user.id, aiConversations.userId))
			.where(eq(aiConversations.id, event.params.id))
			.limit(1)
	)[0];
	if (!convo) error(404, 'Not found');

	const messages = await db
		.select({
			id: aiMessages.id,
			role: aiMessages.role,
			content: aiMessages.content,
			status: aiMessages.status,
			feedback: aiMessages.feedback,
			createdAt: aiMessages.createdAt
		})
		.from(aiMessages)
		.where(eq(aiMessages.conversationId, convo.id))
		.orderBy(asc(aiMessages.createdAt));

	return { convo, messages };
};
