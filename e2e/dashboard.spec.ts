import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('signed out, /me redirects home', async ({ page }) => {
	await page.goto('/me');
	await expect(page).toHaveURL(/\/$/);
});

test('dashboard shows attempts, mastery, timed best placeholder and bookmarks', async ({
	page
}) => {
	await signUpTestUser(page, 'dash');
	// seed one attempt through the real quiz flow
	await page.goto('/quiz/quick');
	// Hydration gate — clicks before hydration are swallowed; see quiz.spec.ts.
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /start quiz/i }).click();
	for (let i = 0; i < 10; i++) {
		await page.getByTestId('choice').first().click();
		await page.getByRole('button', { name: /next question|see results/i }).click();
	}
	await expect(page.getByText(/% correct/)).toBeVisible();
	// seed a bookmark via the API
	const put = await page.request.put('/api/bookmarks', {
		data: { rulesetId: 'usau-official-2026-27', ruleId: '15.A' }
	});
	expect(put.ok()).toBeTruthy();
	// wait for the attempt to flush, then load the dashboard
	await expect
		.poll(async () => {
			const res = await page.request.get('/api/sync');
			return res.ok() ? ((await res.json()) as { responses: unknown[] }).responses.length : -1;
		})
		.toBe(10);

	await page.goto('/me');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: /your perspective/i })).toBeVisible();
	await expect(page.getByText(/quick quiz/i).first()).toBeVisible(); // attempt row
	await expect(page.getByText('15.A')).toBeVisible(); // bookmark row
	await expect(page.getByText(/no timed runs yet/i)).toBeVisible();

	// remove the bookmark from the dashboard
	await page.getByRole('button', { name: /remove bookmark 15\.A/i }).click();
	await expect(page.getByText('15.A')).not.toBeVisible();
});
