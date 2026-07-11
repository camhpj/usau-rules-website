import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('a signed-in quick quiz lands in D1 and comes back from /api/sync', async ({ page }) => {
	await signUpTestUser(page, 'sync');
	await page.goto('/quiz/quick');
	// Hydration gate — clicks before hydration are swallowed; see quiz.spec.ts.
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /start quiz/i }).click();
	for (let i = 0; i < 10; i++) {
		await page.getByTestId('choice').first().click();
		await page.getByRole('button', { name: /next question|see results/i }).click();
	}
	await expect(page.getByText(/% correct/)).toBeVisible();
	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/sync');
				if (!res.ok()) return -1;
				const state = (await res.json()) as { responses: unknown[] };
				return state.responses.length;
			},
			{ timeout: 10_000 }
		)
		.toBe(10);
});
