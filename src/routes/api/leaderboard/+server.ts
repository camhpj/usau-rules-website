import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import {
	buildLeaderboardResult,
	fetchCallerBestRow,
	fetchRankedRows,
	rankAgainstBoard,
	type RankedRow
} from '$lib/server/leaderboard';

const CACHE_TTL_SECONDS = 60;

/**
 * The subset of Cloudflare's Cache API this route uses, typed against the DOM Request/Response
 * this codebase already builds elsewhere. @cloudflare/workers-types' own Cache type doesn't line
 * up here: two copies of that package (top-level and one nested under @sveltejs/adapter-cloudflare)
 * are pinned at different versions and disagree on Request's shape.
 */
interface EdgeCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

/** Synthetic key so the Cache API keys by ruleset id; this URL is never requested by a client. */
function cacheKeyFor(rulesetId: string): Request {
	return new Request(`https://leaderboard.internal.cache/${encodeURIComponent(rulesetId)}`);
}

/**
 * `platform.caches` (backed by the same runtime object as the Workers global `caches`, see
 * @sveltejs/adapter-cloudflare's worker.js) is undefined in local dev under some conditions and
 * always undefined in Vitest, since `platform` itself is only populated on Cloudflare. Every
 * access is guarded so a missing cache falls through to a direct query, never an error.
 */
function getCache(platform: App.Platform | undefined): EdgeCache | null {
	try {
		return (platform?.caches?.default as unknown as EdgeCache | undefined) ?? null;
	} catch {
		return null;
	}
}

async function readCachedRows(cache: EdgeCache, key: Request): Promise<RankedRow[] | null> {
	try {
		const hit = await cache.match(key);
		if (!hit) return null;
		const parsed: unknown = await hit.json();
		// A body that parses but isn't an array would otherwise reach assignRanks's `[...rows]`
		// and throw. No writer produces that today, but a future shape change could — degrade to
		// a fresh query rather than 500ing for the rest of the cache entry's TTL.
		return Array.isArray(parsed) ? (parsed as RankedRow[]) : null;
	} catch {
		return null;
	}
}

async function writeCachedRows(cache: EdgeCache, key: Request, rows: RankedRow[]): Promise<void> {
	try {
		await cache.put(
			key,
			new Response(JSON.stringify(rows), {
				headers: {
					'content-type': 'application/json',
					'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`
				}
			})
		);
	} catch {
		// Best-effort: a cache write failure must never surface to the caller.
	}
}

export const GET: RequestHandler = async (event) => {
	// Public route: no requireUser. locals may be populated (hooks run for /api/*);
	// a session is optional and only used to find the caller's own row.
	if (!event.locals.db) error(503, 'db unavailable');
	const db = event.locals.db;
	const rulesetId = DEFAULT_RULESET_ID;

	// The board is identical for every visitor apart from the caller's own row, so only these
	// shared, caller-agnostic rows are ever written to the cache. That write path
	// (readCachedRows/writeCachedRows above) never sees a callerId, so a caller's row cannot
	// enter the shared cache entry by construction, not just by convention.
	const cache = getCache(event.platform);
	const key = cacheKeyFor(rulesetId);
	const cachedRows = cache ? await readCachedRows(cache, key) : null;

	let rows: RankedRow[];
	const servedFromCache = cachedRows !== null;
	if (cachedRows) {
		rows = cachedRows;
	} else {
		rows = await fetchRankedRows(db, rulesetId);
		// Awaited, not backgrounded via ctx.waitUntil: the write is a single cheap PUT (nothing
		// like the query it replaces on the next request), and awaiting it guarantees the entry
		// is actually in place before this response goes out, rather than racing worker teardown.
		if (cache) await writeCachedRows(cache, key, rows);
	}

	let callerId: string | undefined;
	if (event.locals.auth) {
		try {
			const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
			callerId = session?.user.id;
		} catch {
			// The board is public; a broken session lookup must never take it down.
		}
	}

	// `rows` just came fresh off the DB (no cache, or a miss we just repopulated), so it already
	// reflects the caller's latest run — buildLeaderboardResult's .find() is all `me` needs.
	if (!callerId || !servedFromCache) {
		return json(buildLeaderboardResult(rows, callerId));
	}

	// `rows` came from a cache entry that can be up to 60s old, so it may be missing (or
	// understating) a run the caller just played. Rather than re-run the full board query per
	// signed-in request — the cost this cache exists to avoid — fetch only the caller's own
	// current best row (one cheap, indexed lookup) and derive their rank by comparing it against
	// the board already in hand. This live row/result is never written anywhere: it flows only
	// into `me` below, never into writeCachedRows.
	const entries = buildLeaderboardResult(rows).entries;
	const mine = await fetchCallerBestRow(db, rulesetId, callerId);
	const me = mine ? rankAgainstBoard(rows, mine) : null;
	return json({ entries, me });
};
