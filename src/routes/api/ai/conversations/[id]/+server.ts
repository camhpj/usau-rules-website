import { error, json } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { ConversationDetail } from '$lib/ai/payload';
import { aiConversations, aiMessages } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const db = event.locals.db;
	const convos = await db
		.select({
			id: aiConversations.id,
			title: aiConversations.title,
			rulesetId: aiConversations.rulesetId
		})
		.from(aiConversations)
		.where(
			and(
				eq(aiConversations.id, event.params.id),
				eq(aiConversations.userId, user.id),
				isNull(aiConversations.deletedAt)
			)
		)
		.limit(1);
	if (!convos[0]) error(404, 'conversation not found'); // no existence oracle
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
		.where(eq(aiMessages.conversationId, convos[0].id))
		.orderBy(asc(aiMessages.createdAt));
	const detail = { ...convos[0], messages } satisfies ConversationDetail;
	return json(detail);
};

// Soft delete: conversations double as the Q&A quality log, so we hide, never remove.
export const DELETE: RequestHandler = async (event) => {
	const user = await requireUser(event);
	await event.locals.db
		.update(aiConversations)
		.set({ deletedAt: Date.now() })
		.where(
			and(
				eq(aiConversations.id, event.params.id),
				eq(aiConversations.userId, user.id),
				isNull(aiConversations.deletedAt)
			)
		);
	return json({ ok: true }); // idempotent; no existence oracle
};
