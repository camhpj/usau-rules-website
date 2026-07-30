import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import type { SyncState } from '$lib/quiz/payload';
import { fetchResponseHistory, fetchTimedBest } from '$lib/server/quiz/queries';
import { requireDb } from '$lib/server/http';
import { requireUser } from '$lib/server/session';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const rulesetId = event.url.searchParams.get('ruleset') ?? DEFAULT_RULESET_ID;
	const db = requireDb(event.locals);

	const [rows, best] = await Promise.all([
		fetchResponseHistory(db, user.id, rulesetId),
		fetchTimedBest(db, user.id, rulesetId)
	]);

	const state: SyncState = {
		responses: rows,
		timedBest: best
			? { score: best.score, bestStreak: best.bestStreak ?? 0, at: best.createdAt }
			: null
	};
	return json(state);
};
