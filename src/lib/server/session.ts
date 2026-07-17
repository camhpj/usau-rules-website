import { error, type RequestEvent } from '@sveltejs/kit';

/** Returns the signed-in user or throws a 401. For use in /api/* handlers. */
export async function requireUser(event: RequestEvent) {
	// Guard against requests where hooks had no platform bindings available.
	if (!event.locals.auth) error(503, 'auth unavailable');
	const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
	if (!session) error(401, 'sign in required');
	return session.user;
}

/** Parse the ADMIN_EMAILS allowlist into a lowercased Set. Empty/unset → deny all. */
export function parseAdminEmails(raw: string | null | undefined): Set<string> {
	if (!raw) return new Set();
	return new Set(
		raw
			.split(',')
			.map((e) => e.trim().toLowerCase())
			.filter((e) => e.length > 0)
	);
}

/**
 * Returns the signed-in user iff their email is in ADMIN_EMAILS, else throws 404.
 * 404 (not 401/403) on every failure path so the admin area never advertises itself.
 */
export async function requireAdmin(event: RequestEvent) {
	if (!event.locals.auth) error(404, 'Not found');
	const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
	if (!session) error(404, 'Not found');
	const admins = parseAdminEmails(event.platform?.env?.ADMIN_EMAILS);
	if (!admins.has(session.user.email.toLowerCase())) error(404, 'Not found');
	return session.user;
}
