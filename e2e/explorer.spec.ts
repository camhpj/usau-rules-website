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
	await page.getByRole('option').filter({ hasText: /stall/i }).first().click();
	await expect(page).toHaveURL(/\/rules\/usau-official-2026-27\/.+#/);
});

test('glossary popover opens on hover with definition link', async ({ page }) => {
	await page.goto('/rules/usau-official-2026-27/9');
	// Hydration gate — interactions before hydration are swallowed; see quiz.spec.ts.
	await page.waitForLoadState('networkidle');
	const dfn = page.locator('article dfn[data-rule]').first();
	await dfn.hover();
	await expect(page.getByRole('link', { name: /definition 3\./i })).toBeVisible();
});

test('glossary popover opens with the keyboard and restores focus on close', async ({ page }) => {
	await page.goto('/rules/usau-official-2026-27/9');
	// Hydration gate — interactions before hydration are swallowed; see quiz.spec.ts.
	await page.waitForLoadState('networkidle');
	const dfn = page.locator('article dfn[data-rule]').first();
	await dfn.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('link', { name: /definition 3\./i })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('link', { name: /definition 3\./i })).not.toBeVisible();
	await expect(dfn).toBeFocused();

	// Client-side navigation reuses the same <article> element, so dfns on the next
	// section must be re-upgraded to keyboard-operable buttons (regression check).
	await page.getByRole('link', { name: /restarting and continuing play →/i }).click();
	await expect(page).toHaveURL(/\/rules\/usau-official-2026-27\/10$/);
	const nextDfn = page.locator('article dfn[data-rule]').first();
	await nextDfn.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('link', { name: /definition 3\./i })).toBeVisible();
});

test('search dialog exposes combobox/listbox semantics', async ({ page }) => {
	await page.goto('/');
	// See "cmd+k search jumps to a rule" above: wait out the hydration race before
	// pressing the shortcut, or the keydown listener isn't attached yet.
	await page.waitForLoadState('networkidle');
	await page.keyboard.press('ControlOrMeta+k');
	const input = page.getByRole('combobox', { name: /search the rules/i });
	await input.fill('stall count');
	await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await expect(input).toHaveAttribute('aria-activedescendant', 'search-option-1');
});

test('quiz hub and ask stub resolve', async ({ page }) => {
	await page.goto('/quiz');
	await expect(page.getByRole('link', { name: /quick quiz/i })).toBeVisible();
	await page.goto('/ask');
	await expect(page.getByText(/later phase/i)).toBeVisible();
});

test('TOC sidebar navigates to another section', async ({ page }) => {
	// Sidebar is lg-only; default viewport (1280px) clears the breakpoint.
	await page.goto('/rules/usau-official-2026-27/15');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: /stalling/i })).toBeVisible();
	const sidebar = page.locator('nav[aria-label="Sections"]');
	await sidebar.getByRole('link', { name: /the pull/i }).click();
	await expect(page).toHaveURL(/\/rules\/usau-official-2026-27\/9$/);
	await expect(page.getByRole('heading', { name: /the pull/i })).toBeVisible();
});

test('cross-reference link navigates and flashes the target anchor', async ({ page }) => {
	await page.goto('/rules/usau-official-2026-27/15');
	const xref = page.locator('article .rule-html a[href*="#"]').first();
	const href = await xref.getAttribute('href');
	if (!href) throw new Error('expected an in-text cross-reference link with an href');
	const [, targetId] = href.split('#');
	await xref.click();
	await expect(page).toHaveURL(new RegExp(`${href.replace(/[.#]/g, '\\$&')}$`));
	await expect(page.locator(`[id="${targetId}"]`)).toHaveClass(/anchor-flash/);
});

test('appendix page renders table/image content', async ({ page }) => {
	await page.goto('/rules/usau-official-2026-27/appendix-a');
	await expect(page.locator('article table, article img').first()).toBeVisible();
});

test('search shows a no-results message for a gibberish query', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.keyboard.press('ControlOrMeta+k');
	await page.getByPlaceholder(/search the rules/i).fill('zzzzqqq');
	await expect(page.getByText(/no rules match/i)).toBeVisible();
});

test('search shows an error state when the index fails to load', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.route('**/search/*.json', (route) => route.abort());
	await page.keyboard.press('ControlOrMeta+k');
	await page.getByPlaceholder(/search the rules/i).fill('stall count');
	await expect(page.getByText(/search index failed to load/i)).toBeVisible();
});

test('landing "Test yourself" card links to the quiz hub', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: /test yourself/i }).click();
	await expect(page).toHaveURL(/\/quiz$/);
	await expect(page.getByRole('heading', { name: /pick your game/i })).toBeVisible();
});
