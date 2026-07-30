import { sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { LEADERBOARD_SIZE, type LeaderboardEntry } from '$lib/leaderboard/payload';

/** One user's single best timed run for a ruleset, as fetched from D1 (unranked, unsorted). */
export interface RankedRow {
	user_id: string;
	display_name: string;
	score: number;
	best_streak: number;
	at: number; // attempt createdAt, epoch ms
}

/** A ranked row that still carries `userId`, for internal use only — never serialized as-is. */
interface RankedWithCaller extends LeaderboardEntry {
	userId: string;
}

/**
 * Fetches each opted-in user's single best timed run for `rulesetId`: best = highest score,
 * ties broken by streak then earliest run. Uses Task 4's
 * `quiz_attempts_ruleset_mode_idx (ruleset_id, mode, user_id, score, best_streak)` for the
 * filter and partition. Unranked and unsorted — buildLeaderboardResult does that in JS so the
 * tie-break logic is unit-testable without D1.
 */
export async function fetchRankedRows(db: Db, rulesetId: string): Promise<RankedRow[]> {
	return db.all<RankedRow>(sql`
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
		)
		select user_id, display_name, score, best_streak, at
		from best
		where rn = 1
	`);
}

/** Fetches one caller's own current best timed run for `rulesetId`, or null if they have none
 * that qualifies (no display name, or no attempts). Indexed by
 * `quiz_attempts_ruleset_mode_idx (ruleset_id, mode, user_id, score, best_streak)` — a single-row
 * lookup, not the full-board scan `fetchRankedRows` does. */
export async function fetchCallerBestRow(
	db: Db,
	rulesetId: string,
	callerId: string
): Promise<RankedRow | null> {
	const rows = await db.all<RankedRow>(sql`
		select qa.user_id, u.display_name, qa.score, qa.best_streak, qa.created_at as at
		from quiz_attempts qa
		join user u on u.id = qa.user_id
		where qa.mode = 'timed'
			and qa.ruleset_id = ${rulesetId}
			and qa.user_id = ${callerId}
			and u.display_name is not null
		order by qa.score desc, qa.best_streak desc, qa.created_at asc
		limit 1
	`);
	return rows[0] ?? null;
}

function compareRows(a: RankedRow, b: RankedRow): number {
	if (a.score !== b.score) return b.score - a.score;
	if (a.best_streak !== b.best_streak) return b.best_streak - a.best_streak;
	return a.at - b.at;
}

/**
 * Sorts rows (score desc, best_streak desc, created_at asc) and assigns display ranks matching
 * SQL `RANK()`: rows tied on all three columns share a rank, and the next distinct row's rank
 * skips ahead by the tie count (1, 1, 3 — not 1, 1, 2).
 */
function assignRanks(rows: RankedRow[]): RankedWithCaller[] {
	const sorted = [...rows].sort(compareRows);
	const out: RankedWithCaller[] = [];
	sorted.forEach((r, i) => {
		const prev = sorted[i - 1];
		const tied =
			i > 0 && prev.score === r.score && prev.best_streak === r.best_streak && prev.at === r.at;
		out.push({
			rank: tied ? out[i - 1].rank : i + 1,
			displayName: r.display_name,
			score: r.score,
			bestStreak: r.best_streak,
			at: r.at,
			userId: r.user_id
		});
	});
	return out;
}

function stripCaller(r: RankedWithCaller): LeaderboardEntry {
	return {
		rank: r.rank,
		displayName: r.displayName,
		score: r.score,
		bestStreak: r.bestStreak,
		at: r.at
	};
}

/**
 * Pure ranking core: assigns display ranks and locates the caller's row. Takes fetched rows so
 * it can be tested against fixtures without D1, and so the route can run it against a cached,
 * shared row set while still resolving `me` fresh per request.
 */
export function buildLeaderboardResult(
	rows: RankedRow[],
	callerId?: string
): { entries: LeaderboardEntry[]; me: LeaderboardEntry | null } {
	const ranked = assignRanks(rows);
	const entries = ranked.slice(0, LEADERBOARD_SIZE).map(stripCaller);
	const mine = callerId ? ranked.find((r) => r.userId === callerId) : undefined;
	return { entries, me: mine ? stripCaller(mine) : null };
}

/**
 * Derives `mine`'s rank against the full board in `rows`, without re-ranking `rows` itself.
 * `rows` may be stale (e.g. a cached snapshot older than `mine`) — that's fine, since `mine` is
 * excluded from the comparison and is assumed to already be the caller's true current best (see
 * fetchCallerBestRow). Rank = 1 + the count of *other* rows that sort strictly before `mine`
 * under the same order `assignRanks` uses (score desc, best_streak desc, created_at asc), which
 * reproduces SQL `RANK()`: rows tied with `mine` don't count against it and share its rank.
 */
export function rankAgainstBoard(rows: RankedRow[], mine: RankedRow): LeaderboardEntry {
	const better = rows.filter((r) => r.user_id !== mine.user_id && compareRows(r, mine) < 0).length;
	return {
		rank: better + 1,
		displayName: mine.display_name,
		score: mine.score,
		bestStreak: mine.best_streak,
		at: mine.at
	};
}

/**
 * Fetches and ranks the board for `rulesetId` in one call, always with a fresh, uncached query —
 * this function itself does no caching. Not currently called by the route: the route composes
 * fetchRankedRows/buildLeaderboardResult directly so it can serve entries from a 60s edge cache
 * while still resolving `me` per request (via rankAgainstBoard, or this function's own fresh
 * lookup when there's no cache to consult). Kept as the module's single-call, uncached entry
 * point per this task's brief.
 */
export async function loadLeaderboard(
	db: Db,
	rulesetId: string,
	callerId?: string
): Promise<{ entries: LeaderboardEntry[]; me: LeaderboardEntry | null }> {
	const rows = await fetchRankedRows(db, rulesetId);
	return buildLeaderboardResult(rows, callerId);
}
