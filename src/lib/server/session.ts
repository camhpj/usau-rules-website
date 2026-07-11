import { error, type RequestEvent } from '@sveltejs/kit';

/** Returns the signed-in user or throws a 401. For use in /api/* handlers. */
export async function requireUser(event: RequestEvent) {
	// Guard against requests where hooks had no platform bindings available.
	if (!event.locals.auth) error(503, 'auth unavailable');
	const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
	if (!session) error(401, 'sign in required');
	return session.user;
}
