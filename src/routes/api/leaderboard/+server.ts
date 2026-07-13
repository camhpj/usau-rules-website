import { error, json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { LEADERBOARD_SIZE } from '$lib/leaderboard/payload';

interface RankedRow {
	rank: number;
	display_name: string;
	score: number;
	best_streak: number;
	at: number;
	user_id: string;
}

export const GET: RequestHandler = async (event) => {
	// Public route: no requireUser. locals may be populated (hooks run for /api/*);
	// a session is optional and only used to find the caller's own row.
	if (!event.locals.db) error(503, 'db unavailable');
	const db = event.locals.db;
	const rulesetId = DEFAULT_RULESET_ID;

	// best = each opted-in user's single best timed run (score desc, streak desc,
	// earliest first); ranked = dense ranks over those bests.
	const ranked = await db.all<RankedRow>(sql`
		with best as (
			select
				qa.user_id,
				u.display_name,
				qa.score,
				qa.best_streak,
				qa.created_at as at,
				row_number() over (
					partition by qa.user_id
					order by qa.score desc, qa.best_streak desc, qa.created_at asc
				) as rn
			from quiz_attempts qa
			join user u on u.id = qa.user_id
			where qa.mode = 'timed' and qa.ruleset_id = ${rulesetId} and u.display_name is not null
		),
		ranked as (
			select
				user_id, display_name, score, best_streak, at,
				rank() over (order by score desc, best_streak desc, at asc) as rank
			from best where rn = 1
		)
		select rank, display_name, score, best_streak, at, user_id from ranked
		order by rank asc
	`);

	const toEntry = (r: RankedRow) => ({
		rank: r.rank,
		displayName: r.display_name,
		score: r.score,
		bestStreak: r.best_streak,
		at: r.at
	});

	let me: ReturnType<typeof toEntry> | null = null;
	if (event.locals.auth) {
		try {
			const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
			if (session) {
				const mine = ranked.find((r) => r.user_id === session.user.id);
				if (mine) me = toEntry(mine);
			}
		} catch {
			// The board is public; a broken session lookup must never take it down.
		}
	}

	return json({
		entries: ranked.slice(0, LEADERBOARD_SIZE).map(toEntry),
		me
	});
};
