import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

const RULESET = 'usau-official-2026-27';

/**
 * A display name that will not collide with one an earlier run already claimed.
 *
 * Display names persist in the local D1 between runs, so the suffix has to stay
 * unique across them. `Date.now() % 100000` did not: it wraps every 100 seconds,
 * and a collision makes the first claim 409 rather than the duplicate the test
 * is actually about. Digits only, so a random suffix can never trip the
 * profanity matcher and trade one flake for another.
 */
function uniqueName(prefix: string): string {
	const stamp = Date.now() % 1_000_000_000; // wraps in ~11.6 days, not 100 seconds
	return `${prefix} ${stamp}${Math.floor(Math.random() * 100)}`;
}

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

// Regression test for the +page.svelte dedupe bug: it used to match the pinned "me" row against
// `entries` on rank + displayName, which assumed both were drawn from the same snapshot. Once
// `me` became a live per-request lookup (fix round 1) while `entries` stays on the 60s cache,
// that assumption broke for a player who improves an already-cached score: a changed rank made
// the match fail (rendered twice — stale row + fresh pin); an unchanged rank falsely "matched"
// and hid the fresh score behind the stale one. This constructs exactly that: a first (low-score)
// run that lands in the shared cache, then a second, strictly better run, live-visible before
// that cache entry expires.
//
// Placed first in this file, before anything else touches /api/leaderboard: this suite always
// boots a fresh dev server (see playwright.config.ts), so the first poll below is very likely
// this process's first-ever request to the endpoint, guaranteeing a cache miss that bakes in the
// first run's (low) score. The poll's generous timeout is a correctness fallback, not the
// expected cost, for orderings where that assumption doesn't hold (e.g. run alongside other spec
// files that reach this endpoint first) — it then genuinely waits out the 60s TTL instead.
test('a player who improves an already-cached score is shown exactly once, with the fresh value', async ({
	page
}) => {
	test.setTimeout(110_000);
	const name = uniqueName('Improver');
	await signUpTestUser(page, 'lb-improve');
	expect((await setName(page, name)).ok()).toBeTruthy();

	// Question 15-01's answerIndex is 1 (see content/questions/usau-official-2026-27/15.json),
	// so choiceIndex 0 is a controlled wrong answer (score 0) and choiceIndex 1 a controlled
	// right one (score 1) — deterministic, unlike the UI helper's "click the first choice".
	const finishWith = async (choiceIndex: number) => {
		const start = await page.request.post('/api/timed/start', { data: { rulesetId: RULESET } });
		expect(start.ok()).toBeTruthy();
		const { token } = (await start.json()) as { token: string };
		await page.waitForTimeout(1100); // /api/timed/finish requires >=1s since the mint
		const finish = await page.request.post('/api/timed/finish', {
			data: { token, rulesetId: RULESET, responses: [{ questionId: '15-01', choiceIndex }] }
		});
		expect(finish.status()).toBe(201);
		return (await finish.json()) as { score: number };
	};

	const first = await finishWith(0);
	expect(first.score).toBe(0);

	// Wait for the shared cache to actually bake in this (stale, score-0) row. Without this, the
	// bug can't occur at all: it only shows up once `entries` already contains the player — a
	// brand-new player absent from `entries` was already covered by the "sees a live rank" test
	// above and doesn't exercise the dedupe match.
	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/leaderboard');
				if (!res.ok()) return false;
				const board = (await res.json()) as { entries: { displayName: string; score: number }[] };
				return board.entries.some((e) => e.displayName === name && e.score === 0);
			},
			{ timeout: 75_000, intervals: [1000] }
		)
		.toBe(true);

	// Second run: strictly better, and live-visible via `me` before the cache entry holding the
	// score-0 row expires.
	const second = await finishWith(1);
	expect(second.score).toBe(1);

	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/leaderboard');
				if (!res.ok()) return null;
				const board = (await res.json()) as { me: { score: number } | null };
				return board.me?.score ?? null;
			},
			{ timeout: 10_000 }
		)
		.toBe(1);

	await page.goto('/leaderboard');
	await page.waitForLoadState('networkidle');
	// Exactly one row for this player — not the stale row plus a fresh pin, and not zero because
	// the fresh pin got suppressed by a stale-but-matching row — showing the fresh score.
	const playerRows = page.locator('tbody tr', { hasText: name });
	await expect(playerRows).toHaveCount(1);
	await expect(playerRows.locator('td').nth(2)).toHaveText('1');
});

test('signed out: board loads with empty state or entries, no me row', async ({ page }) => {
	await page.goto('/leaderboard');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: /leaderboard/i })).toBeVisible();
	await expect(page.getByText(/you —/i)).toHaveCount(0);
});

// /api/leaderboard caches the shared `entries` for 60s (see leaderboard/+server.ts), but a
// signed-in caller's own `me` row is resolved live (see the "sees a live rank" test below) — so
// in practice this resolves within a few seconds. The generous poll timeout is a safety margin,
// not an expected wait: it only gets exercised if the live lookup itself were ever broken, in
// which case `me` would fall back to (eventually) reflecting the run once the cache naturally
// refreshes. A second signed-in caller plays alongside the first so we can also confirm — the
// security-relevant property from the task brief — that neither caller's `me` row leaked into
// the other's response.
test('claim via API + play run → row appears on the board; another caller never inherits it', async ({
	page,
	browser
}) => {
	// Generous margin over the 60s cache TTL in case the fast (live `me`) path is ever broken;
	// see the comment above. The suite's default per-test timeout (30s) is too tight to allow for
	// that fallback.
	test.setTimeout(100_000);
	const name = uniqueName('Boarder');
	await signUpTestUser(page, 'lb-claim');
	expect((await setName(page, name)).ok()).toBeTruthy();
	await playTimedRun(page);

	const context2 = await browser.newContext();
	const page2 = await context2.newPage();
	const name2 = uniqueName('Boarder2');
	await signUpTestUser(page2, 'lb-claim-2');
	expect((await setName(page2, name2)).ok()).toBeTruthy();
	await playTimedRun(page2);

	// The "Time!" heading renders before submitTimedRun's POST /api/timed/finish resolves
	// (fire-and-forget from the client), and the cache above may still be serving a pre-run
	// snapshot — poll for both to have landed rather than racing a single fetch.
	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/leaderboard');
				if (!res.ok()) return null;
				const board = (await res.json()) as { me: { displayName: string } | null };
				return board.me?.displayName ?? null;
			},
			{ timeout: 75_000, intervals: [1000] }
		)
		.toBe(name);
	await page.goto('/leaderboard');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(name).first()).toBeVisible();

	// The board is now cached fresh (page's last poll just repopulated it). page2's own request
	// against that same shared entry must resolve its own row, never page's.
	const res2 = await page2.request.get('/api/leaderboard');
	const board2 = (await res2.json()) as { me: { displayName: string } | null };
	expect(board2.me?.displayName).toBe(name2);

	await context2.close();
});

// Product fix: a signed-in caller's `me` must reflect a run played in the last 60s even though
// the shared `entries` snapshot can be that stale. Proven by comparing `entries` before and after
// the run — they must stay byte-for-byte identical (the shared cache never saw this run) — while
// `me` resolves within a few seconds, not the cache's TTL.
test('signed-in caller sees a live rank for a run just played, even while cached entries stay stale', async ({
	page
}) => {
	const before = await page.request.get('/api/leaderboard');
	const boardBefore = (await before.json()) as { entries: unknown };

	const name = uniqueName('Fresh');
	await signUpTestUser(page, 'lb-live-rank');
	expect((await setName(page, name)).ok()).toBeTruthy();
	await playTimedRun(page);

	// The "Time!" heading renders before submitTimedRun's POST /api/timed/finish resolves
	// (fire-and-forget) — this short poll accounts for that write landing, not for the cache TTL:
	// the live per-caller lookup means `me` should reflect the run within a few seconds.
	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/leaderboard');
				if (!res.ok()) return null;
				const board = (await res.json()) as { me: { displayName: string } | null };
				return board.me?.displayName ?? null;
			},
			{ timeout: 10_000 }
		)
		.toBe(name);

	const after = await page.request.get('/api/leaderboard');
	const boardAfter = (await after.json()) as {
		me: { displayName: string; rank: number } | null;
		entries: unknown;
	};
	expect(boardAfter.me?.displayName).toBe(name);
	expect(boardAfter.me?.rank).toBeGreaterThan(0);
	// The cache warmed by the very first request above predates this run. If `me` came from that
	// same cached snapshot rather than a live lookup, this run's row would have had to enter the
	// shared cache to be visible here — which the security fix already rules out. Since `me`
	// still resolves, and `entries` is unchanged, the live lookup is what's making this work.
	expect(boardAfter.entries).toEqual(boardBefore.entries);
});

test('duplicate custom name 409s; resolveConflict appends a suffix', async ({ page, browser }) => {
	const base = uniqueName('Dup');
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
