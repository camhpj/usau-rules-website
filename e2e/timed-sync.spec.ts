import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('a signed-in timed run persists a server-validated best', async ({ page }) => {
	await signUpTestUser(page, 'timed');
	await page.goto('/quiz/timed');
	await page.waitForLoadState('networkidle'); // hydration race — see quiz.spec.ts
	await page.getByRole('button', { name: /^start$/i }).click();
	for (let i = 0; i < 3; i++) {
		await page.getByTestId('choice').first().click();
		// rapid mode auto-advances (~600ms)
		await page.waitForTimeout(750);
	}
	await page.getByRole('button', { name: /end run/i }).click();
	await expect(page.getByText(/time!/i)).toBeVisible();
	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/sync');
				if (!res.ok()) return null;
				const state = (await res.json()) as { timedBest: { score: number } | null };
				return state.timedBest;
			},
			{ timeout: 10_000 }
		)
		.not.toBeNull();
});

test('timed finish endpoint enforces token integrity, window, and replay', async ({ page }) => {
	await signUpTestUser(page, 'timedapi');
	const start = await page.request.post('/api/timed/start');
	expect(start.ok()).toBeTruthy();
	const { token } = (await start.json()) as { token: string };

	const finish = (body: unknown) => page.request.post('/api/timed/finish', { data: body });

	// premature: elapsed < 1s since mint
	const early = await finish({
		token,
		rulesetId: 'usau-official-2026-27',
		responses: [{ questionId: '15-01', choiceIndex: 0 }]
	});
	expect(early.status()).toBe(400);

	// tampered token: flip the signature
	const [payload, sig] = token.split('.');
	const tampered = await finish({
		token: `${payload}.${sig.replace(/^./, sig[0] === '0' ? '1' : '0')}`,
		rulesetId: 'usau-official-2026-27',
		responses: [{ questionId: '15-01', choiceIndex: 0 }]
	});
	expect(tampered.status()).toBe(400);

	// valid submit after the 1s minimum, then replay
	await page.waitForTimeout(1100);
	const ok = await finish({
		token,
		rulesetId: 'usau-official-2026-27',
		responses: [{ questionId: '15-01', choiceIndex: 0 }]
	});
	expect(ok.status()).toBe(201);
	const replay = await finish({
		token,
		rulesetId: 'usau-official-2026-27',
		responses: [{ questionId: '15-01', choiceIndex: 0 }]
	});
	expect(replay.status()).toBe(409);
});
