import { error, json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import type { ConversationDetail } from '$lib/ai/payload';
import { getOwnedConversation } from '$lib/server/ai/conversations';
import { aiConversations, aiMessages } from '$lib/server/db/schema';
import { requireDb } from '$lib/server/http';
import { requireUser } from '$lib/server/session';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const db = requireDb(event.locals);
	const convo = await getOwnedConversation(db, event.params.id, user.id);
	if (!convo) error(404, 'conversation not found'); // no existence oracle
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
	const detail = { ...convo, messages } satisfies ConversationDetail;
	return json(detail);
};

// Soft delete: conversations double as the Q&A quality log, so we hide, never remove.
export const DELETE: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const db = requireDb(event.locals);
	// Ownership + not-already-deleted is enforced by getOwnedConversation's WHERE
	// clause; once it returns a row, scoping the update by id alone is safe.
	const convo = await getOwnedConversation(db, event.params.id, user.id);
	if (convo) {
		await db
			.update(aiConversations)
			.set({ deletedAt: Date.now() })
			.where(eq(aiConversations.id, convo.id));
	}
	return json({ ok: true }); // idempotent; no existence oracle
};
