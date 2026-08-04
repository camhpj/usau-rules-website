import { expect, type APIResponse, type Page } from '@playwright/test';

export function uniqueEmail(tag: string): string {
	return `bp-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * page.request.post, retried once on a dropped connection. Observed once in CI: the dev
 * server closed the socket on the very first request of a test ("socket hang up"),
 * immediately after a D1-heavy admin test — a transient hiccup the server never turned into
 * an actual response, not a real failure of this call, so retrying it once is safe.
 */
async function postWithRetry(
	page: Page,
	url: string,
	data: Record<string, string>
): Promise<APIResponse> {
	try {
		return await page.request.post(url, { data });
	} catch (err) {
		if (!(err instanceof Error) || !/socket hang up|ECONNRESET/.test(err.message)) throw err;
		return await page.request.post(url, { data });
	}
}

/**
 * The email allowlisted as admin. Must match ADMIN_EMAILS in `.dev.vars`, which
 * overrides the production value in wrangler.jsonc. Deliberately not a real
 * address: these tests create a password account for it, and doing that under a
 * real Google address makes the next Google sign-in fail account_not_linked.
 */
export const ADMIN_EMAIL = 'admin@example.test';
export const ADMIN_PASSWORD = 'test-password-123';

/**
 * Signs up (and thereby signs in) a throwaway user via the env-gated test
 * credential endpoint. page.request shares the browser context's cookie jar,
 * so the session cookie is live for subsequent page.goto calls.
 */
export async function signUpTestUser(
	page: Page,
	tag: string,
	opts: { email?: string } = {}
): Promise<{ email: string }> {
	const email = opts.email ?? uniqueEmail(tag);
	const res = await postWithRetry(page, '/api/auth/sign-up/email', {
		email,
		password: 'test-password-123',
		name: 'Test User'
	});
	expect(res.ok(), `test sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return { email };
}

/** Signs in as the single allowlisted admin, creating the account once if absent. */
export async function signInAsAdmin(page: Page): Promise<void> {
	const signUp = await postWithRetry(page, '/api/auth/sign-up/email', {
		email: ADMIN_EMAIL,
		password: ADMIN_PASSWORD,
		name: 'Admin'
	});
	if (signUp.ok()) return;
	const signIn = await postWithRetry(page, '/api/auth/sign-in/email', {
		email: ADMIN_EMAIL,
		password: ADMIN_PASSWORD
	});
	expect(
		signIn.ok(),
		`admin sign-in failed: ${signIn.status()} ${await signIn.text()}`
	).toBeTruthy();
}
