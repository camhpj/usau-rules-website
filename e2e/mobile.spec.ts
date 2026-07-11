import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 } });

test('mobile TOC dialog navigates between sections', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: /explore the rules/i }).click();
	await page
		.getByRole('link', { name: /spirit of the game/i })
		.first()
		.click();
	await expect(page.getByRole('heading', { name: /spirit of the game/i })).toBeVisible();

	const before = page.url();
	await page.getByRole('button', { name: /sections/i }).click();
	const dialog = page.getByRole('dialog', { name: /sections/i });
	await dialog.getByRole('link', { name: /the pull/i }).click();
	await expect(page).not.toHaveURL(before);
	await expect(page.getByRole('heading', { name: /the pull/i })).toBeVisible();

	const noOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
	);
	expect(noOverflow).toBe(true);
});
