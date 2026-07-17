import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, signUpTestUser } from './helpers';

test.describe('admin access', () => {
	test('signed out → 404 on admin routes', async ({ page }) => {
		for (const path of ['/admin', '/admin/ai', '/admin/export']) {
			const res = await page.goto(path);
			expect(res?.status(), path).toBe(404);
		}
	});

	test('non-admin signed in → 404', async ({ page }) => {
		await signUpTestUser(page, 'not-admin');
		const res = await page.goto('/admin');
		expect(res?.status()).toBe(404);
	});

	test('admin → dashboard renders', async ({ page }) => {
		await signUpTestUser(page, 'admin', { email: ADMIN_EMAIL });
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'AI review' })).toBeVisible();
	});
});
