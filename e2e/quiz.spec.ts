import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Section 19 (Picks) has exactly 4 questions — small enough to run end-to-end in
// the mastery grid test below. Read the bank directly so remaining questions can
// be answered correctly by matching choice text, independent of the per-run
// display shuffle, keeping the "exactly one missed question" scenario deterministic.
interface BankQuestion {
	prompt: string;
	choices: string[];
	answerIndex: number;
}
const picksBank: BankQuestion[] = JSON.parse(
	readFileSync(
		path.join(
			path.dirname(fileURLToPath(import.meta.url)),
			'../content/questions/usau-official-2026-27/19.json'
		),
		'utf-8'
	)
);
function correctChoiceTextFor(prompt: string): string {
	const question = picksBank.find((q) => q.prompt === prompt);
	if (!question) throw new Error(`no bank question found for prompt: ${prompt}`);
	return question.choices[question.answerIndex];
}

test('complete a quick quiz from the hub', async ({ page }) => {
	await page.goto('/quiz');
	await page.getByRole('link', { name: /quick quiz/i }).click();
	await expect(page).toHaveURL(/\/quiz\/quick/);
	// Hydration gate — see the letter-keys test below: clicks before hydration are swallowed.
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /start quiz/i }).click();
	for (let i = 0; i < 10; i++) {
		await page.getByTestId('choice').first().click();
		await page.getByRole('button', { name: /next question|see results/i }).click();
	}
	await expect(page.getByText(/% correct/)).toBeVisible();
	await expect(page.getByRole('button', { name: /play again/i })).toBeVisible();
});

test('letter keys answer questions and Enter advances; digits remain an alias', async ({
	page
}) => {
	await page.goto('/quiz/quick');
	// See explorer.spec.ts "cmd+k search jumps to a rule": wait out the hydration
	// race before synthetic keypresses, or the keydown listener isn't attached yet.
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /start quiz/i }).click();
	await expect(page.getByText(/question 1 of 10/i)).toBeVisible();

	await page.keyboard.press('b');
	await expect(page.getByRole('button', { name: /next question|see results/i })).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(page.getByText(/question 2 of 10/i)).toBeVisible();

	await page.keyboard.press('2');
	await expect(page.getByRole('button', { name: /next question|see results/i })).toBeVisible();
});

test('feedback and citation chip deep-link into the rules', async ({ page, context }) => {
	await page.goto('/quiz/quick');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /start quiz/i }).click();
	await page.getByTestId('choice').first().click();
	await expect(page.getByText(/^correct$|^not quite$/i)).toBeVisible();

	const citation = page.getByRole('link', { name: /↗/ }).first();
	await expect(citation).toBeVisible();
	const [popup] = await Promise.all([context.waitForEvent('page'), citation.click()]);
	await popup.waitForLoadState();
	await expect(popup).toHaveURL(/\/rules\/usau-official-2026-27\/.+#/);
});

test('quick quiz section and difficulty filters narrow the pool', async ({ page }) => {
	await page.goto('/quiz/quick');
	await page.waitForLoadState('networkidle');
	const poolText = page.getByText(/question.* match/i);
	await expect(poolText).toHaveText('213 questions match');

	const sectionChip = page.getByRole('button', { name: /^15\. Stalling$/ });
	await sectionChip.click();
	await expect(sectionChip).toHaveAttribute('aria-pressed', 'true');
	await expect(poolText).toHaveText('12 questions match');

	const difficultyChip = page.getByRole('button', { name: /^1 · Rookie$/ });
	await difficultyChip.click();
	await expect(difficultyChip).toHaveAttribute('aria-pressed', 'true');
	await expect(poolText).toHaveText('4 questions match');

	await page.getByRole('button', { name: /start quiz/i }).click();
	await expect(page.getByText(/question 1 of 4/i)).toBeVisible();
});

test('quick quiz section param preselects the matching chip', async ({ page }) => {
	await page.goto('/quiz/quick?section=15');
	await expect(page.getByRole('button', { name: /^15\. Stalling$/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('play again restarts and change settings returns to setup', async ({ page }) => {
	await page.goto('/quiz/quick?section=19');
	// The ?section= preset is applied in onMount; wait past hydration before the
	// first click or it can land before the listener (and preset) are attached.
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /start quiz/i }).click();
	while (await page.getByTestId('choice').count()) {
		await page.getByTestId('choice').first().click();
		await page.getByRole('button', { name: /next question|see results/i }).click();
	}
	await expect(page.getByRole('button', { name: /play again/i })).toBeVisible();

	await page.getByRole('button', { name: /play again/i }).click();
	await expect(page.getByText(/question 1 of 4/i)).toBeVisible();
	while (await page.getByTestId('choice').count()) {
		await page.getByTestId('choice').first().click();
		await page.getByRole('button', { name: /next question|see results/i }).click();
	}

	await page.getByRole('button', { name: /change settings/i }).click();
	await expect(page.getByRole('button', { name: /start quiz/i })).toBeVisible();
});

test('mastery grid updates the tile level and resurfaces a missed question first', async ({
	page
}) => {
	await page.goto('/quiz/mastery');
	await page.waitForLoadState('networkidle');
	const tile = page.getByRole('button', { name: /19\. Picks/i });
	await expect(tile).toContainText(/not started/i);
	await tile.click();
	await expect(page.getByText(/question 1 of 4/i)).toBeVisible();

	const firstPrompt = await page.locator('h2').first().textContent();

	await page.getByTestId('choice').first().click();
	const q1WasCorrect = await page.getByText('Correct', { exact: true }).isVisible();
	await page.getByRole('button', { name: /next question|see results/i }).click();

	// Answer the rest correctly (by matching the bank's known-correct choice text)
	// so at most one question — q1 — ends up missed, keeping the retry-ordering
	// assertion below deterministic regardless of the per-run display shuffle.
	while (await page.getByTestId('choice').count()) {
		const prompt = (await page.locator('h2').first().textContent())?.trim() ?? '';
		const correctText = correctChoiceTextFor(prompt);
		await page.getByTestId('choice').filter({ hasText: correctText }).click();
		await page.getByRole('button', { name: /next question|see results/i }).click();
	}

	await page.getByRole('button', { name: /all sections/i }).click();
	const tileAfter = page.getByRole('button', { name: /19\. Picks/i });
	await expect(tileAfter).not.toContainText(/not started/i);
	await expect(tileAfter).toContainText(/learning|solid/i);

	await tileAfter.click();
	await expect(page.getByText(/question 1 of 4/i)).toBeVisible();
	if (!q1WasCorrect) {
		await expect(page.locator('h2').first()).toHaveText(firstPrompt ?? '');
	}
});

test('timed challenge — full expiry via clock emulation', async ({ page }) => {
	await page.clock.install();
	await page.goto('/quiz/timed');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /^start$/i }).click();

	await page.getByTestId('choice').first().click();
	await page.clock.fastForward(700);
	await page.getByTestId('choice').first().click();
	await page.clock.fastForward(700);

	await page.clock.fastForward('05:00');
	await expect(page.getByRole('heading', { name: /time!/i })).toBeVisible();
	await expect(page.getByText(/best streak/i)).toBeVisible();
	await expect(page.getByText(/new personal best/i)).toBeVisible();

	await page.goto('/quiz/timed');
	await expect(page.getByText(/personal best:/i)).toBeVisible();
});

test('timed challenge runs and can be ended early', async ({ page }) => {
	await page.goto('/quiz/timed');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /^start$/i }).click();
	await page.getByTestId('choice').first().click();
	await page.getByRole('button', { name: /end run/i }).click();
	await expect(page.getByText(/best streak/i)).toBeVisible();
});

test('quiz me on this section deep-links into a mastery run', async ({ page }) => {
	await page.goto('/rules/usau-official-2026-27/15');
	await page.getByRole('link', { name: /quiz me on this section/i }).click();
	await expect(page).toHaveURL(/\/quiz\/mastery\?section=15/);
	await expect(page.getByText(/question 1 of/i)).toBeVisible();
});

test('progress persists across a reload of the quiz hub and mastery grid', async ({ page }) => {
	// One mastery run (Picks, section 19) plus one timed run, then reload both pages.
	await page.goto('/quiz/mastery?section=19');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(/question 1 of 4/i)).toBeVisible();
	while (await page.getByTestId('choice').count()) {
		await page.getByTestId('choice').first().click();
		await page.getByRole('button', { name: /next question|see results/i }).click();
	}
	await expect(page.getByRole('button', { name: /run it again/i })).toBeVisible();

	await page.clock.install();
	await page.goto('/quiz/timed');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /^start$/i }).click();
	await page.getByTestId('choice').first().click();
	await page.clock.fastForward('05:00');
	await expect(page.getByRole('heading', { name: /time!/i })).toBeVisible();

	await page.goto('/quiz');
	await page.reload();
	await expect(page.getByText(/personal best: \d/i)).toBeVisible();
	await expect(page.getByText(/\d\/\d+ sections mastered/i)).toBeVisible();

	await page.goto('/quiz/mastery');
	await page.reload();
	await expect(page.getByRole('button', { name: /19\. Picks/i })).not.toContainText(/not started/i);
});
