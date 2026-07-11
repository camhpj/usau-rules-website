import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { createAuth } from '$lib/server/auth';
import { createDb } from '$lib/server/db';

export const handle: Handle = async ({ event, resolve }) => {
	// Prerendered pages never reach the worker in production (served from assets);
	// mirror that here so the dev platform proxy — which throws on platform.env
	// access from prerenderable routes — is never touched for them.
	const dynamic =
		event.url.pathname.startsWith('/api/') ||
		event.url.pathname === '/me' ||
		event.url.pathname.startsWith('/me/');
	if (building || !dynamic || !event.platform?.env) return resolve(event);
	event.locals.db = createDb(event.platform.env.DB);
	event.locals.auth = createAuth(event.platform.env);
	return svelteKitHandler({ event, resolve, auth: event.locals.auth, building });
};
