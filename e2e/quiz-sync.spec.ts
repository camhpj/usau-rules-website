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

test('rejects an attempt whose startedAt is in the future', async ({ page }) => {
	await signUpTestUser(page, 'futurets');
	const validAttempt = () => ({
		clientId: crypto.randomUUID(), // schema requires a uuid
		rulesetId: 'usau-official-2026-27',
		mode: 'quick' as const,
		sectionSlug: null,
		startedAt: Date.now(),
		durationS: 30,
		responses: [{ questionId: '1-01', choiceIndex: 0, at: Date.now() }]
	});

	const ok = await page.request.post('/api/attempts', { data: validAttempt() });
	expect(ok.status()).toBe(201);

	const future = await page.request.post('/api/attempts', {
		data: { ...validAttempt(), startedAt: Date.now() + 60 * 60 * 1000 }
	});
	expect(future.status()).toBe(400);

	// A past startedAt must keep working: the offline outbox in
	// src/lib/quiz/sync.ts queues attempts while a user has no network and
	// flushes them once they're back online and signed in, so a genuine
	// attempt can arrive days after it happened. This guards against a
	// future change adding a symmetric lower bound, which would silently
	// discard those queued attempts.
	const pastStart = Date.now() - 3 * 24 * 60 * 60 * 1000;
	const past = await page.request.post('/api/attempts', {
		data: {
			...validAttempt(),
			startedAt: pastStart,
			responses: [{ questionId: '1-01', choiceIndex: 0, at: pastStart + 5000 }]
		}
	});
	expect(past.status()).toBe(201);
});
