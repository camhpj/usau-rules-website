import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

export const AI_QUESTION = {
	id: 'ai-11111111-1111-1111-1111-111111111111',
	rulesetId: 'usau-official-2026-27',
	type: 'multiple-choice',
	prompt:
		'Mid-point, the marker reaches “ten” in the stall count while the thrower still holds the disc. Two teammates argue about the restart. What is the ruling?',
	choices: [
		'It is a turnover — the marker announces “stall” and play stops.',
		'The count restarts at eight.',
		'The thrower gets a warning first.',
		'Play continues until a pass is attempted.'
	],
	answerIndex: 0,
	explanation: 'Per 15.D, reaching “ten” before the release is a stall — a turnover.',
	ruleRefs: ['15.D'],
	sectionSlug: '15',
	difficulty: 1
};

test.describe('scenario mode', () => {
	test('signed out: shows the sign-in gate, no deal button', async ({ page }) => {
		await page.goto('/quiz/scenario');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
		await expect(page.getByRole('button', { name: /deal a scenario/i })).toHaveCount(0);
	});

	test('signed in: deals, plays, and can deal another', async ({ page }) => {
		await signUpTestUser(page, 'scenario');
		await page.route('**/api/ai/scenario', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ source: 'ai', remaining: 9, question: AI_QUESTION })
			})
		);
		await page.goto('/quiz/scenario');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /deal a scenario/i }).click();
		await expect(page.getByText(/stall count/)).toBeVisible();
		await page.getByRole('button', { name: /it is a turnover/i }).click();
		await expect(page.getByText(/per 15\.D/i)).toBeVisible();
		await page.getByRole('button', { name: 'Continue', exact: true }).click();
		await expect(page.getByRole('button', { name: /another scenario/i })).toBeVisible();
		await expect(page.getByText(/9 scenarios left today/i)).toBeVisible();

		await page.goto('/quiz');
		await expect(page.getByText(/9 scenarios left today/i)).toBeVisible();
	});

	test('daily limit: 429 surfaces the message', async ({ page }) => {
		await signUpTestUser(page, 'scenario-limit');
		await page.route('**/api/ai/scenario', (route) =>
			route.fulfill({
				status: 429,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Daily scenario limit reached — try again tomorrow' })
			})
		);
		await page.goto('/quiz/scenario');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /deal a scenario/i }).click();
		await expect(page.getByText(/daily scenario limit reached/i)).toBeVisible();
	});

	test('fallback: bank question is labeled', async ({ page }) => {
		await signUpTestUser(page, 'scenario-fb');
		await page.route('**/api/ai/scenario', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					source: 'fallback',
					remaining: 8,
					question: { ...AI_QUESTION, id: '15-01' }
				})
			})
		);
		await page.goto('/quiz/scenario');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /deal a scenario/i }).click();
		await expect(page.getByText(/AI was unavailable/i)).toBeVisible();
	});
});

test.describe('ask the rules', () => {
	test('signed out: sign-in gate, no question form', async ({ page }) => {
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
		await expect(page.getByRole('textbox')).toHaveCount(0);
	});

	test('signed in: streams an answer; verified ids become explorer links, bogus ids stay text', async ({
		page
	}) => {
		await signUpTestUser(page, 'ask');
		await page.route('**/api/ai/ask', (route) =>
			route.fulfill({
				status: 200,
				headers: {
					'content-type': 'application/x-ndjson; charset=utf-8',
					'x-bp-ai-remaining': '9'
				},
				body: '{"t":"think","text":"**Comparing rules**"}\n{"t":"text","text":"Yes — under [15.D] that is a turnover. "}\n{"t":"text","text":"[99.ZZ] is not a real rule."}\n'
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox').fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^ask$/i }).click();
		await expect(page.getByText(/that is a turnover/)).toBeVisible();
		const link = page.getByRole('link', { name: '15.D' });
		await expect(link).toHaveAttribute('href', '/rules/usau-official-2026-27/15#15.D');
		await expect(page.getByText('[99.ZZ]')).toBeVisible();
		await expect(page.getByText(/9 questions left today/)).toBeVisible();
	});

	test('daily limit: 429 message shows and the form stays usable', async ({ page }) => {
		await signUpTestUser(page, 'ask-limit');
		await page.route('**/api/ai/ask', (route) =>
			route.fulfill({
				status: 429,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Daily question limit reached — try again tomorrow' })
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox').fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^ask$/i }).click();
		await expect(page.getByText(/daily question limit reached/i)).toBeVisible();
		await expect(page.getByRole('button', { name: /^ask$/i })).toBeEnabled();
	});

	test('Enter submits; Cmd/Ctrl+Enter inserts a newline instead', async ({ page }) => {
		await signUpTestUser(page, 'ask-keys');
		await page.route('**/api/ai/ask', (route) =>
			route.fulfill({
				status: 200,
				headers: {
					'content-type': 'application/x-ndjson; charset=utf-8',
					'x-bp-ai-remaining': '8'
				},
				body: '{"t":"text","text":"Yes — that is a stall per [15.D]."}\n'
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		const box = page.getByRole('textbox');
		await box.fill('First line');
		await box.press('ControlOrMeta+Enter');
		await expect(box).toHaveValue('First line\n');
		await box.pressSequentially('second line');
		await box.press('Enter');
		await expect(page.getByText(/that is a stall/)).toBeVisible();
	});
});
