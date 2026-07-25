// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
/// <reference types="@sveltejs/adapter-cloudflare" />
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			auth: import('$lib/server/auth').Auth;
			db: import('$lib/server/db').Db;
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				DB: import('@cloudflare/workers-types').D1Database;
				BETTER_AUTH_SECRET: string;
				BETTER_AUTH_URL?: string;
				GOOGLE_CLIENT_ID?: string;
				GOOGLE_CLIENT_SECRET?: string;
				ALLOW_TEST_SIGNIN?: string;
				GEMINI_API_KEY?: string;
				AI_DISABLED?: string;
				ADMIN_EMAILS?: string;
			};
		}
	}
}

export {};
