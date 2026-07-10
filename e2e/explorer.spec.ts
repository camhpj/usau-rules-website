import { expect, test } from '@playwright/test';

test('landing → explore → read a rule', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /know the rules/i })).toBeVisible();
	await page.getByRole('link', { name: /explore the rules/i }).click();
	await expect(page).toHaveURL(/\/rules\/usau-official-2026-27$/);
	await page
		.getByRole('link', { name: /spirit of the game/i })
		.first()
		.click();
	await expect(page.getByRole('heading', { name: /spirit of the game/i })).toBeVisible();
	await expect(page.locator('[id="2.A"]')).toBeVisible();
});

test('cmd+k search jumps to a rule', async ({ page }) => {
	await page.goto('/');
	// The landing page hydrates ~150-200ms after `load` fires; pressing the shortcut
	// before Svelte attaches its window keydown listener silently drops the keypress.
	// Waiting for the network to go idle reliably clears that hydration race.
	await page.waitForLoadState('networkidle');
	await page.keyboard.press('ControlOrMeta+k');
	await page.getByPlaceholder(/search the rules/i).fill('stall count');
	await page.getByRole('button').filter({ hasText: /stall/i }).first().click();
	await expect(page).toHaveURL(/\/rules\/usau-official-2026-27\/.+#/);
});

test('glossary popover opens with definition link', async ({ page }) => {
	await page.goto('/rules/usau-official-2026-27/9');
	const dfn = page.locator('article dfn[data-rule]').first();
	await dfn.click();
	await expect(page.getByRole('link', { name: /definition 3\./i })).toBeVisible();
});

test('quiz and ask stubs resolve', async ({ page }) => {
	for (const path of ['/quiz', '/ask']) {
		await page.goto(path);
		// .first(): both stub pages carry a "Coming soon" eyebrow label, and /ask's body
		// copy also contains "later phase" — the regex matches two elements there, which
		// trips getByText's strict-mode uniqueness check.
		await expect(page.getByText(/coming soon|later phase/i).first()).toBeVisible();
	}
});
