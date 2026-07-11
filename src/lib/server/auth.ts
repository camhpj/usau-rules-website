import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb } from './db';
import * as schema from './db/schema';

type AuthEnv = App.Platform['env'];

function buildAuth(env: AuthEnv) {
	return betterAuth({
		database: drizzleAdapter(createDb(env.DB), { provider: 'sqlite', schema }),
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL || undefined, // undefined → inferred from the request
		session: { cookieCache: { enabled: true, maxAge: 300 } },
		// Test-only credential sign-in for local dev + CI e2e. ALLOW_TEST_SIGNIN is never
		// set in production, where Google remains the sole provider (spec requirement).
		emailAndPassword: { enabled: env.ALLOW_TEST_SIGNIN === '1' },
		socialProviders:
			env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
				? {
						google: {
							clientId: env.GOOGLE_CLIENT_ID,
							clientSecret: env.GOOGLE_CLIENT_SECRET,
							prompt: 'select_account'
						}
					}
				: {}
	});
}

export type Auth = ReturnType<typeof buildAuth>;

const cache = new WeakMap<AuthEnv, Auth>();

export function createAuth(env: AuthEnv): Auth {
	let auth = cache.get(env);
	if (!auth) {
		auth = buildAuth(env);
		cache.set(env, auth);
	}
	return auth;
}
