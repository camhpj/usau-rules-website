import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { createAuth } from '$lib/server/auth';
import { createDb } from '$lib/server/db';

// Prerendered pages never reach the worker in production (served from assets);
// mirror that here so the dev platform proxy — which throws on platform.env
// access from prerenderable routes — is never touched for them.
export function isDynamicRoute(pathname: string): boolean {
	return (
		pathname.startsWith('/api/') ||
		pathname === '/me' ||
		pathname.startsWith('/me/') ||
		pathname === '/admin' ||
		pathname.startsWith('/admin/') ||
		pathname === '/ask' ||
		pathname.startsWith('/ask/')
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	if (building || !isDynamicRoute(event.url.pathname) || !event.platform?.env)
		return resolve(event);
	event.locals.db = createDb(event.platform.env.DB);
	event.locals.auth = createAuth(event.platform.env);
	return svelteKitHandler({ event, resolve, auth: event.locals.auth, building });
};
