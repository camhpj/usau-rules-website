import type { z } from 'zod';

export type FetchResult<T> =
	{ ok: true; status: number; data: T } | { ok: false; status: number | null; body: unknown };

/** Fetch without reading a body. `status` is null only when no response arrived. */
export async function safeFetch(
	url: string,
	init?: RequestInit
): Promise<{ ok: boolean; status: number | null }> {
	try {
		const res = await fetch(url, init);
		return { ok: res.ok, status: res.status };
	} catch {
		return { ok: false, status: null };
	}
}

/**
 * Fetch and validate a JSON body.
 *
 * A 2xx carrying malformed or schema-invalid JSON is a failure: callers that
 * treated it as success would propagate unvalidated data. The real status
 * survives on the failure arm so callers can still branch on 401/409/201.
 */
export async function safeFetchJson<T>(
	url: string,
	init: RequestInit | undefined,
	schema: z.ZodType<T>
): Promise<FetchResult<T>> {
	let res: Response;
	try {
		res = await fetch(url, init);
	} catch {
		return { ok: false, status: null, body: null };
	}

	const body = await res.json().catch(() => null);
	if (!res.ok) return { ok: false, status: res.status, body };

	const parsed = schema.safeParse(body);
	if (!parsed.success) return { ok: false, status: res.status, body };
	return { ok: true, status: res.status, data: parsed.data };
}
