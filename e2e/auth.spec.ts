import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('signed out: nav shows a Sign in button', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
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
