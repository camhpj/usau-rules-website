import { expect, type Page } from '@playwright/test';

export function uniqueEmail(tag: string): string {
	return `bp-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** The email allowlisted as admin in wrangler.jsonc vars (ADMIN_EMAILS). */
export const ADMIN_EMAIL = 'camhpjohnson@gmail.com';

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
	const res = await page.request.post('/api/auth/sign-up/email', {
		data: { email, password: 'test-password-123', name: 'Test User' }
	});
	expect(res.ok(), `test sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return { email };
}
