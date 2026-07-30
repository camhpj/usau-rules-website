import { error } from '@sveltejs/kit';
import type { z } from 'zod';

/**
 * Parse and validate a JSON request body, or throw a 400.
 *
 * Malformed JSON and schema failures are deliberately not distinguished: the
 * client cannot act differently on the two, and the distinction leaks shape
 * information about the endpoint.
 */
export async function parseJsonBody<T>(
	request: Request,
	schema: z.ZodType<T>,
	message = 'invalid request body'
): Promise<T> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, message);
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw error(400, message);
	return parsed.data;
}

/**
 * Read `locals.db`, or fail loudly.
 *
 * Without this a route that never got the binding fails with an unattributable
 * "cannot read property of undefined". `hooks.server.ts` skips populating it
 * three ways: while prerendering, for a path outside its dynamic-route
 * allowlist, and when `platform.env` is absent. A new server route under a path
 * the allowlist does not match is the likeliest cause in development.
 *
 * The thrown message stays generic because SvelteKit serializes it into the
 * response body.
 */
export function requireDb(locals: App.Locals): App.Locals['db'] {
	if (!locals.db) throw error(500, 'database unavailable');
	return locals.db;
}

/** Read `locals.auth`, or fail loudly. See {@link requireDb}. */
export function requireAuth(locals: App.Locals): App.Locals['auth'] {
	if (!locals.auth) throw error(500, 'auth unavailable');
	return locals.auth;
}
