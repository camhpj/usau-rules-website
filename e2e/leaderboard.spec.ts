import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

const RULESET = 'usau-official-2026-27';

async function setName(
	page: import('@playwright/test').Page,
	displayName: string,
	resolve = false
) {
	const res = await page.request.put('/api/profile/display-name', {
		data: resolve ? { displayName, resolveConflict: true } : { displayName }
	});
	return res;
}

async function playTimedRun(page: import('@playwright/test').Page) {
	await page.clock.install();
	await page.goto('/quiz/timed');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /^start$/i }).click();
	await page.getByTestId('choice').first().click();
	await page.clock.fastForward(700);
	// Real wall-clock wait (page.clock only fakes timers inside the page): /api/timed/finish
	// requires >=1s of actual elapsed time between the start-token mint and the finish call
	// (see verify.ts's elapsed-window check, and the same wait in timed-sync.spec.ts) — without
	// it the server silently rejects the run (400 swallowed by submitTimedRun) and no attempt
	// is ever written, so nothing shows up on the board or triggers the nudge.
	await page.waitForTimeout(1100);
	await page.getByRole('button', { name: /end run/i }).click();
	await expect(page.getByRole('heading', { name: /time!/i })).toBeVisible();
}

test('signed out: board loads with empty state or entries, no me row', async ({ page }) => {
	await page.goto('/leaderboard');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: /leaderboard/i })).toBeVisible();
	await expect(page.getByText(/you —/i)).toHaveCount(0);
});

test('claim via API + play run → row appears on the board', async ({ page }) => {
	const name = `Boarder ${Date.now() % 100000}`;
	await signUpTestUser(page, 'lb-claim');
	expect((await setName(page, name)).ok()).toBeTruthy();
	await playTimedRun(page);
	// The "Time!" heading renders before submitTimedRun's POST /api/timed/finish resolves
	// (fire-and-forget from the client) — poll the API for the write to land before asserting
	// on the rendered page, rather than racing a single fetch against it.
	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/leaderboard');
				if (!res.ok()) return false;
				const board = (await res.json()) as {
					me: { displayName: string } | null;
					entries: { displayName: string }[];
				};
				return board.me?.displayName === name || board.entries.some((e) => e.displayName === name);
			},
			{ timeout: 10_000 }
		)
		.toBe(true);
	await page.goto('/leaderboard');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(name).first()).toBeVisible();
});

test('duplicate custom name 409s; resolveConflict appends a suffix', async ({ page, browser }) => {
	const base = `Dup ${Date.now() % 100000}`;
	await signUpTestUser(page, 'lb-dup1');
	expect((await setName(page, base)).ok()).toBeTruthy();

	// Deviation from the brief: a second signUpTestUser call in the SAME context does replace
	// the session cookie as expected, but the request itself gets rejected first — better-auth's
	// origin-check middleware 403s with MISSING_OR_NULL_ORIGIN whenever a cookie is already
	// present and no Origin/Referer header is sent, which is exactly page.request's second call
	// once a session cookie exists. A fresh context (the brief's own documented fallback) avoids
	// it by starting cookie-less again.
	const context2 = await browser.newContext();
	const page2 = await context2.newPage();
	await signUpTestUser(page2, 'lb-dup2');
	const conflict = await setName(page2, base.toLowerCase());
	expect(conflict.status()).toBe(409);
	expect((await conflict.json()).suggestion).toBe(`${base.toLowerCase()} 2`);
	const resolved = await setName(page2, base.toLowerCase(), true);
	expect((await resolved.json()).displayName).toBe(`${base.toLowerCase()} 2`);
	await context2.close();
});

test('dashboard: claim line appears, join-as sets the name, remove clears it', async ({ page }) => {
	await signUpTestUser(page, 'lb-dash');
	await page.goto('/me');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('button', { name: /join as/i })).toBeVisible();
	await page.getByRole('button', { name: /join as/i }).click();
	await expect(page.getByRole('button', { name: /^remove$/i })).toBeVisible();
	await page.getByRole('button', { name: /^remove$/i }).click();
	await expect(page.getByRole('button', { name: /join as/i })).toBeVisible();
});

test('post-run nudge: qualifying run without a name shows the claim line', async ({ page }) => {
	await signUpTestUser(page, 'lb-nudge');
	await playTimedRun(page);
	await expect(page.getByText(/if you claim it/i)).toBeVisible({ timeout: 10_000 });
	await page.getByRole('button', { name: /join as/i }).click();
	await expect(page.getByText(/on the board as/i)).toBeVisible();
	await expect(page.getByRole('link', { name: /see the leaderboard/i })).toBeVisible();
});

// Review-flagged coverage candidate (cheap, added): a token minted for one ruleset must not
// finish a run claiming another — mirrors the tamper/replay checks in timed-sync.spec.ts.
test('timed/finish rejects a token minted for a different ruleset (400)', async ({ page }) => {
	await signUpTestUser(page, 'lb-xruleset');
	const start = await page.request.post('/api/timed/start', { data: { rulesetId: RULESET } });
	expect(start.ok()).toBeTruthy();
	const { token } = (await start.json()) as { token: string };
	const finish = await page.request.post('/api/timed/finish', {
		data: {
			token,
			rulesetId: 'some-other-ruleset',
			responses: [{ questionId: '15-01', choiceIndex: 0 }]
		}
	});
	expect(finish.status()).toBe(400);
});
