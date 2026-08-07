import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, d1, d1Select, signInAsAdmin, signUpTestUser } from './helpers';

test.describe('admin access', () => {
	test('signed out → 404 on admin routes', async ({ page }) => {
		for (const path of ['/admin', '/admin/ai', '/admin/export']) {
			const res = await page.goto(path);
			expect(res?.status(), path).toBe(404);
		}
	});

	test('non-admin signed in → 404', async ({ page }) => {
		await signUpTestUser(page, 'not-admin');
		const res = await page.goto('/admin');
		expect(res?.status()).toBe(404);
	});

	test('admin → dashboard renders', async ({ page }) => {
		await signInAsAdmin(page);
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'AI review' })).toBeVisible();
	});

	test('dashboard reflects seeded data', async ({ page }) => {
		await signInAsAdmin(page);
		// seed a conversation + a thumbed-down assistant message for this admin user
		const uid = (
			d1Select(`SELECT id FROM user WHERE email = '${ADMIN_EMAIL}'`)[0] as { id: string }
		).id;
		// This test asserts a rate computed across every AI answer in range, so it
		// has to own that set rather than add one row to whatever is already there.
		// A reused dev server keeps earlier runs' rows (`reuseExistingServer` skips
		// the D1 wipe), and against a warm database the tile read 73.9%, not 100%.
		// Safe to clear here: every other fixture in the suite is seeded by the test
		// that needs it, after this one runs.
		d1(`DELETE FROM ai_messages`);
		d1(`DELETE FROM ai_conversations`);
		// Namespaced ids, for the reason spelled out on the 👎 test below: a reused
		// dev server keeps earlier runs' rows, and fixed ids collide on INSERT.
		const base = Date.now();
		d1(
			`INSERT INTO ai_conversations (id,user_id,ruleset_id,title,created_at,updated_at) VALUES ('c-metrics-${base}','${uid}','usau-official-2026-27','seed',1,1)`
		);
		d1(
			`INSERT INTO ai_messages (id,conversation_id,role,content,status,feedback,created_at) VALUES ('m-a-${base}','c-metrics-${base}','assistant','ans','complete','down',${base})`
		);
		await page.goto('/admin');
		await expect(page.getByText('Active users').first()).toBeVisible();
		// thumbs-down rate tile shows 100.0% — the one in-range answer is a down
		await expect(page.getByText('100.0%').first()).toBeVisible();
	});
});

/**
 * The chart shows a day and count only while the pointer is over a bar. It
 * carries no standing readout: the y-axis already labels the peak, so a second
 * copy of it in the corner said nothing new, and swapping that corner between a
 * peak and a hovered value made a fixed part of the chart appear to change
 * meaning under the pointer.
 */
test('admin chart: values appear on hover over a bar, and nowhere else', async ({ page }) => {
	await signInAsAdmin(page);
	// signing in is itself a day of activity, so today's column has a bar while
	// the days at the far left of the range have none
	await page.goto('/admin');
	const row = page.getByTestId('bar-row').first();
	await expect(row).toBeVisible();

	await expect(page.getByText(/^peak /)).toHaveCount(0);
	await expect(page.getByTestId('bar-tooltip')).toHaveCount(0);

	const box = (await row.boundingBox())!;
	const midY = box.y + box.height / 2;

	// today's bar, at the right edge
	await page.mouse.move(box.x + box.width - 2, midY);
	const tip = page.getByTestId('bar-tooltip').first();
	await expect(tip).toBeVisible();
	await expect(tip).toHaveText(/^\d{2}-\d{2} · [1-9]\d*$/);

	// the tooltip stays inside the plot even at that edge, where centring it on
	// its bar would otherwise hang it off the card
	const tipBox = (await tip.boundingBox())!;
	expect(tipBox.x).toBeGreaterThanOrEqual(box.x - 1);
	expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(box.x + box.width + 1);

	// a day with no activity draws no bar, so there is nothing to describe there
	await page.mouse.move(box.x + 2, midY);
	await expect(page.getByTestId('bar-tooltip')).toHaveCount(0);

	// and leaving the plot clears it rather than stranding a value
	await page.mouse.move(box.x + box.width - 2, midY);
	await expect(page.getByTestId('bar-tooltip').first()).toBeVisible();
	await page.mouse.move(box.x + box.width / 2, box.y - 60);
	await expect(page.getByTestId('bar-tooltip')).toHaveCount(0);
});

test('AI review: 👎 filter and cross-user transcript', async ({ page }) => {
	await signInAsAdmin(page);

	// `base` namespaces every id, title, and timestamp to this run, for the same
	// reason the paging test below does it. The local D1 is wiped only when
	// Playwright starts the dev server itself, so a developer who already has one
	// running keeps every row from earlier runs (`reuseExistingServer`). Fixed ids
	// collided on INSERT there, and `updated_at` values of 10-13 sorted these rows
	// below a previous run's 31 paging fixtures — enough to fill the 30-row first
	// page and push this conversation out of view before it could be asserted on.
	const base = Date.now();
	const otherUser = `ai-other-${base}`;
	const withDown = `c-ai-${base}`;
	const withoutDown = `c-nodown-${base}`;
	const downTitle = `stall count question ${base}`;
	const upTitle = `no-down conversation ${base}`;
	const question = `what is a stall? ${base}`;

	// A dedicated second account rather than whichever row `SELECT id FROM user
	// LIMIT 1` happened to return. Unordered, that could pick the signed-in admin,
	// and the transcript assertion below only means anything if the conversation
	// belongs to somebody else.
	d1(
		`INSERT INTO user (id,name,email,email_verified) VALUES ('${otherUser}','Other','other-${base}@example.test',1)`
	);
	d1(
		`INSERT INTO ai_conversations (id,user_id,ruleset_id,title,created_at,updated_at) VALUES ('${withDown}','${otherUser}','usau-official-2026-27','${downTitle}',${base},${base})`
	);
	d1(
		`INSERT INTO ai_messages (id,conversation_id,role,content,created_at) VALUES ('m-u-${base}','${withDown}','user','${question}',${base})`
	);
	d1(
		`INSERT INTO ai_messages (id,conversation_id,role,content,status,feedback,created_at) VALUES ('m-r-${base}','${withDown}','assistant','A stall per 15.D.','complete','down',${base + 1})`
	);
	d1(
		`INSERT INTO ai_conversations (id,user_id,ruleset_id,title,created_at,updated_at) VALUES ('${withoutDown}','${otherUser}','usau-official-2026-27','${upTitle}',${base + 2},${base + 2})`
	);
	d1(
		`INSERT INTO ai_messages (id,conversation_id,role,content,status,feedback,created_at) VALUES ('m-nd-${base}','${withoutDown}','assistant','fine answer','complete','up',${base + 3})`
	);

	await page.goto('/admin/ai?down=1');
	await expect(page.getByRole('link', { name: downTitle })).toBeVisible();
	await expect(page.getByRole('link', { name: upTitle })).toHaveCount(0);
	// The row carries the other account's address, so this is an admin reading a
	// conversation that is not their own — the "cross-user" half of the name.
	await expect(page.getByText(`other-${base}@example.test`)).toBeVisible();

	await page.getByRole('link', { name: downTitle }).click();
	await expect(page.getByText(question)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Bad answer', pressed: true })).toBeVisible();
});

test('AI review: paging (Next/Previous/position) round-trips through the URL', async ({ page }) => {
	await signInAsAdmin(page);
	const uid = (d1Select(`SELECT id FROM user WHERE email = '${ADMIN_EMAIL}'`)[0] as { id: string })
		.id;

	// 31 rows span two 30-row pages. `base` namespaces both the ids and the updated_at
	// values to this run: distinct from every other spec's fixtures (small fixed
	// timestamps) and, since Date.now() only grows, distinct from a prior run of this
	// same test against the same persistent local D1 — so no cleanup is needed and a
	// second run stays collision-free.
	const base = Date.now();
	const n = 31;
	const title = (i: number) => `paging-test-${base}-${i}`;
	const convId = (i: number) => `paging-conv-${base}-${i}`;

	const conversations = Array.from(
		{ length: n },
		(_, i) =>
			`('${convId(i)}','${uid}','usau-official-2026-27','${title(i)}',${base + i},${base + i})`
	).join(',');
	d1(
		`INSERT INTO ai_conversations (id,user_id,ruleset_id,title,created_at,updated_at) VALUES ${conversations}`
	);
	// Every row also gets a 👎 message, so the ?down=1 filtered list spans the same
	// two pages as the unfiltered one.
	const messages = Array.from(
		{ length: n },
		(_, i) =>
			`('paging-msg-${base}-${i}','${convId(i)}','assistant','ans','complete','down',${base + i})`
	).join(',');
	d1(
		`INSERT INTO ai_messages (id,conversation_id,role,content,status,feedback,created_at) VALUES ${messages}`
	);

	// Page 1: the 30 newest of the 31 seeded rows, "Page 1", no Previous.
	await page.goto('/admin/ai');
	await expect(page.getByRole('link', { name: title(30), exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: title(0), exact: true })).toHaveCount(0);
	await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Previous' })).toHaveCount(0);

	// Next: the 31st (oldest) row, "Page 2", Previous appears.
	await page.getByRole('link', { name: 'Next' }).click();
	await expect(page.getByRole('link', { name: title(0), exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: title(30), exact: true })).toHaveCount(0);
	await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Previous' })).toBeVisible();
	const page2Url = page.url();

	// Reloading the page-2 URL directly reproduces the same rows and label: state
	// lives in the URL, not client memory — the reason for choosing a cursor stack.
	await page.goto(page2Url);
	await expect(page.getByRole('link', { name: title(0), exact: true })).toBeVisible();
	await expect(page.getByText('Page 2', { exact: true })).toBeVisible();

	// Previous returns to page 1's original row set.
	await page.getByRole('link', { name: 'Previous' }).click();
	await expect(page.getByRole('link', { name: title(30), exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: title(0), exact: true })).toHaveCount(0);
	await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Previous' })).toHaveCount(0);

	// ?down=1 hrefs still carry the filter across Next and Previous.
	await page.goto('/admin/ai?down=1');
	const nextHref = await page.getByRole('link', { name: 'Next' }).getAttribute('href');
	expect(nextHref).toContain('down=1');
	await page.getByRole('link', { name: 'Next' }).click();
	const prevHref = await page.getByRole('link', { name: 'Previous' }).getAttribute('href');
	expect(prevHref).toContain('down=1');
});

test('export: users CSV omits secrets; endpoint 404s for non-admin', async ({ page }) => {
	// non-admin gets 404 on the csv endpoint
	await signUpTestUser(page, 'export-nonadmin');
	const denied = await page.request.get('/admin/export/users.csv');
	expect(denied.status()).toBe(404);

	// admin download
	await page.context().clearCookies();
	await signInAsAdmin(page);
	const res = await page.request.get('/admin/export/users.csv');
	expect(res.ok()).toBeTruthy();
	expect(res.headers()['content-type']).toContain('text/csv');
	const csv = await res.text();
	const header = csv.split('\r\n')[0];
	expect(header).toBe('id,email,name,displayName,createdAt');
	expect(header).not.toContain('password');
	expect(csv).toContain(ADMIN_EMAIL);

	// unknown dataset → 404
	const unknown = await page.request.get('/admin/export/nope.csv');
	expect(unknown.status()).toBe(404);
});
