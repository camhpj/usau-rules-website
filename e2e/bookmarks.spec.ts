import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('signed out: no bookmark buttons in the explorer', async ({ page }) => {
	await page.goto('/rules/usau-official-2026-27/15');
	await expect(page.locator('article a[href="#15.A"]')).toBeVisible();
	await expect(page.getByRole('button', { name: /bookmark rule/i })).toHaveCount(0);
});

test('signed in: bookmark a rule, it persists across reload and via the API', async ({ page }) => {
	await signUpTestUser(page, 'marks');
	await page.goto('/rules/usau-official-2026-27/15');
	await page.waitForLoadState('networkidle');
	const button = page.getByRole('button', { name: /bookmark rule 15\.A$/i });
	await page.locator('article a[href="#15.A"]').hover();
	await button.click();
	await expect(
		page.getByRole('button', { name: /remove bookmark for rule 15\.A$/i })
	).toBeVisible();

	const res = await page.request.get('/api/bookmarks');
	expect(res.ok()).toBeTruthy();
	const { bookmarks } = (await res.json()) as { bookmarks: { ruleId: string }[] };
	expect(bookmarks.map((b) => b.ruleId)).toContain('15.A');

	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(
		page.getByRole('button', { name: /remove bookmark for rule 15\.A$/i })
	).toBeVisible();
	await page.getByRole('button', { name: /remove bookmark for rule 15\.A$/i }).click();
	await expect(page.getByRole('button', { name: /^bookmark rule 15\.A$/i })).toBeVisible();
});
