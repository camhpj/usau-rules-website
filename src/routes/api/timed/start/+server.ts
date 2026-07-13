import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { mintRunToken } from '$lib/server/quiz/run-token';
import { requireUser } from '$lib/server/session';

const StartSchema = z.object({ rulesetId: z.string().min(1).max(64).optional() });

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const parsed = StartSchema.safeParse(await event.request.json().catch(() => ({})));
	const rulesetId = (parsed.success ? parsed.data.rulesetId : undefined) ?? DEFAULT_RULESET_ID;
	const token = await mintRunToken(
		{ userId: user.id, runId: crypto.randomUUID(), startedAt: Date.now(), rulesetId },
		event.platform!.env.BETTER_AUTH_SECRET
	);
	return json({ token });
};
