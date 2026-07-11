import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mintRunToken } from '$lib/server/quiz/run-token';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const token = await mintRunToken(
		{ userId: user.id, runId: crypto.randomUUID(), startedAt: Date.now() },
		event.platform!.env.BETTER_AUTH_SECRET
	);
	return json({ token });
};
