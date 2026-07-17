/** Query parsing + pagination helpers for GET /api/ai/conversations. */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function toPositiveInt(raw: string | null): number | null {
	if (raw === null || raw === '') return null;
	const n = Number(raw);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function parseHistoryQuery(
	params: URLSearchParams,
	defaultLimit: number = DEFAULT_LIMIT
): { before: number | null; limit: number } {
	const limit = toPositiveInt(params.get('limit'));
	return {
		before: toPositiveInt(params.get('before')),
		limit: limit === null ? defaultLimit : Math.min(limit, MAX_LIMIT)
	};
}

/** Given `limit + 1` fetched rows, trims the sentinel row and reports whether more pages exist. */
export function pageRows<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
	return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
