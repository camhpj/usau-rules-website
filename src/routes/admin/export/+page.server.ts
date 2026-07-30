import type { PageServerLoad } from './$types';
import { listDatasetCounts, type DatasetCount } from '$lib/server/admin/datasets';

const CACHE_TTL_SECONDS = 60;

/**
 * The subset of Cloudflare's Cache API this route uses. See
 * `src/routes/api/leaderboard/+server.ts` for why this is a local interface rather than
 * `@cloudflare/workers-types`' own `Cache` type.
 */
interface EdgeCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

// One shared entry for all six counts. This URL is never requested by a client.
const CACHE_KEY = new Request('https://export-counts.internal.cache/all');

function getCache(platform: App.Platform | undefined): EdgeCache | null {
	try {
		return (platform?.caches?.default as unknown as EdgeCache | undefined) ?? null;
	} catch {
		return null;
	}
}

async function readCachedCounts(cache: EdgeCache): Promise<DatasetCount[] | null> {
	try {
		const hit = await cache.match(CACHE_KEY);
		if (!hit) return null;
		const parsed: unknown = await hit.json();
		// Degrade to a fresh query rather than trust a body shape a future writer changed.
		return Array.isArray(parsed) ? (parsed as DatasetCount[]) : null;
	} catch {
		return null;
	}
}

async function writeCachedCounts(cache: EdgeCache, counts: DatasetCount[]): Promise<void> {
	try {
		await cache.put(
			CACHE_KEY,
			new Response(JSON.stringify(counts), {
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

export const load: PageServerLoad = async (event) => {
	await event.parent();
	const cache = getCache(event.platform);
	const cached = cache ? await readCachedCounts(cache) : null;
	if (cached) return { datasets: cached };

	const datasets = await listDatasetCounts(event.locals.db);
	if (cache) await writeCachedCounts(cache, datasets);
	return { datasets };
};
