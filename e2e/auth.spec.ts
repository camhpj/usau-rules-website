import { expect, test } from '@playwright/test';
import { signUpTestUser, uniqueEmail } from './helpers';

test('signed out: nav shows a Sign in button', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

// Fills and submits the dev-only email/password form (never shown in production —
// see src/lib/server/auth.ts and src/lib/server/dev-signin.ts) and checks it lands
// signed in, same as Google would. The suite runs one shared wrangler dev server
// for its whole duration with ALLOW_TEST_SIGNIN=1 fixed at startup (playwright.config.ts),
// so there is no way to toggle it off mid-run to also prove the form is ABSENT when
// disabled here. That boundary is instead covered by a unit test over the exact
// function this form's visibility is gated on: src/lib/server/dev-signin.test.ts.
test('dev sign-in form: filling and submitting reaches a signed-in state', async ({ page }) => {
	await page.goto('/ask');
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Email').fill(uniqueEmail('dev-signin-form'));
	await page.getByLabel('Password').fill('test-password-123');
	await page.getByRole('button', { name: /^sign up$/i }).click();
	await expect(page.getByRole('button', { name: /account menu/i })).toBeVisible();
});

test('test sign-in: account menu appears and sign out restores signed-out nav', async ({
	page
}) => {
	await signUpTestUser(page, 'auth');
	await page.goto('/');
	const trigger = page.getByRole('button', { name: /account menu/i });
	await expect(trigger).toBeVisible();
	await expect(page.getByRole('button', { name: /^sign in$/i })).not.toBeVisible();
	await trigger.click();
	await expect(page.getByRole('menuitem', { name: /dashboard/i })).toBeVisible();
	await page.getByRole('menuitem', { name: /sign out/i }).click();
	await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
});
