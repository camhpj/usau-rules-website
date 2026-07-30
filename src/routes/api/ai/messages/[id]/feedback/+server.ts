import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { aiConversations, aiMessages } from '$lib/server/db/schema';
import { parseJsonBody, requireDb } from '$lib/server/http';
import { requireUser } from '$lib/server/session';

const BodySchema = z.object({ feedback: z.enum(['up', 'down']).nullable() });

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const data = await parseJsonBody(event.request, BodySchema, 'invalid feedback payload');
	const db = requireDb(event.locals);
	const rows = await db
		.select({ id: aiMessages.id, role: aiMessages.role, ownerId: aiConversations.userId })
		.from(aiMessages)
		.innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
		.where(eq(aiMessages.id, event.params.id))
		.limit(1);
	const row = rows[0];
	// Silent no-op on foreign/unknown/user-role targets: idempotent, no existence oracle.
	if (row && row.ownerId === user.id && row.role === 'assistant') {
		await db.update(aiMessages).set({ feedback: data.feedback }).where(eq(aiMessages.id, row.id));
	}
	return json({ ok: true });
};
