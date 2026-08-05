import { expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, d1, d1Select, signInAsAdmin, signUpTestUser } from './helpers';
import {
	auditInPage,
	formatViolations,
	toViolations,
	HEADER_WIDTH_EXEMPT,
	INLINE_EXEMPT,
	MIN_TARGET,
	MIN_TARGET_WIDTH_EXEMPT,
	type Violation
} from './mobile-audit';

export const VIEWPORTS = [320, 375, 768];
const RULESET = 'usau-official-2026-27';

const PUBLIC_ROUTES = [
	'/',
	'/rules',
	`/rules/${RULESET}`,
	`/rules/${RULESET}/15`,
	'/quiz',
	'/quiz/quick',
	'/quiz/mastery',
	'/quiz/timed',
	'/quiz/scenario',
	'/leaderboard',
	'/ask'
];

/**
 * `targetScope` widens as fixes land, so each task's sweep covers exactly what
 * that task fixed. It reaches 'body' in Task 4.
 */
function config(targetScope: string) {
	return {
		inlineExempt: INLINE_EXEMPT,
		widthExempt: HEADER_WIDTH_EXEMPT,
		minSize: MIN_TARGET,
		minWidthExempt: MIN_TARGET_WIDTH_EXEMPT,
		targetScope
	};
}

/**
 * Audits one route at rest and again at the bottom of the page.
 *
 * `app.css` sets `scroll-behavior: smooth` globally, so a plain `scrollTo` here
 * would animate — on a content-heavy route the scroll is still mid-flight after
 * a short wait, landing on an arbitrary middle position rather than the true
 * end. `behavior: 'instant'` bypasses that and lands where it says.
 *
 * The coverage invariant is judged only at that true bottom, never at rest. A
 * fixed control briefly floating over content while the user scrolls past it
 * is ordinary mobile UX — the user keeps scrolling and sees the rest. The real
 * defect is a fixed control left sitting over the LAST content on the page,
 * where there is nowhere further to scroll to reveal it. On a route shorter
 * than one viewport, rest and bottom are the same position, so that case is
 * still caught: it just arrives via the bottom pass instead of the rest one.
 */
async function sweep(
	page: Page,
	route: string,
	width: number,
	targetScope: string
): Promise<Violation[]> {
	await page.goto(route);
	await page.waitForLoadState('networkidle');
	const found = toViolations(await page.evaluate(auditInPage, config(targetScope)), route, width);
	await page.evaluate(() =>
		window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: 'instant' })
	);
	await page.waitForTimeout(250);
	const atBottom = toViolations(
		await page.evaluate(auditInPage, config(targetScope)),
		`${route} (scrolled)`,
		width
	);
	// Overflow and tap-target don't depend on scroll position, so the at-rest
	// pass covers them; re-checking at the bottom would just double-report.
	return [
		...found.filter((v) => v.kind !== 'covered'),
		...atBottom.filter((v) => v.kind === 'covered')
	];
}

/**
 * `sweep` always returns every violation kind it finds, even ones this task did
 * not fix, so later tasks can widen coverage without changing the sweep itself.
 * Each task's assertion narrows to the kinds it actually fixed by passing the
 * kinds it cares about here. Task 2 only fixed tap targets. Overflow joins at
 * Task 4, once the admin and signed-in routes make that invariant meaningful
 * everywhere it's asserted. Covered joins at Task 5, which owns the TOC-pill fix.
 */
function onlyKinds(violations: Violation[], kinds: Violation['kind'][]): Violation[] {
	return violations.filter((v) => kinds.includes(v.kind));
}

for (const width of VIEWPORTS) {
	test.describe(`@${width}px`, () => {
		test.use({ viewport: { width, height: 667 }, hasTouch: true, isMobile: true });

		test('all controls meet the tap-target minimum', async ({ page }) => {
			const violations: Violation[] = [];
			for (const route of PUBLIC_ROUTES)
				violations.push(...(await sweep(page, route, width, 'body')));
			expect(formatViolations(onlyKinds(violations, ['tap-target', 'overflow', 'covered']))).toBe(
				'no violations'
			);
		});
	});
}

const SIGNED_IN_ROUTES = ['/me', '/ask'];
const ADMIN_ROUTES = ['/admin', '/admin/ai', '/admin/export'];

// /admin/ai's default page size is 30 (see parseHistoryQuery's default in
// src/lib/server/ai/history.ts), so 31 rows force a Next link regardless of
// what any other spec has (or hasn't) left in the table. Without this, whether
// the sweep ever exercises the pagination controls depends on run order across
// spec files — that's exactly the gap that hid the undersized Previous/Next
// tap targets until admin.spec.ts happened to seed rows first.
const PAGINATION_ROWS = 31;

/** Seeds enough conversations that /admin/ai's page 1 always shows a Next link. */
function seedAdminPagination(idPrefix: string): void {
	const base = Date.now();
	const uid = (d1Select(`SELECT id FROM user WHERE email = '${ADMIN_EMAIL}'`)[0] as { id: string })
		.id;
	const rows = Array.from(
		{ length: PAGINATION_ROWS },
		(_, i) =>
			`('${idPrefix}${i}', '${uid}', '${RULESET}', 'Pagination sweep seed ${i}', ${base + i}, ${base + i})`
	).join(',');
	d1(
		`INSERT INTO ai_conversations (id, user_id, ruleset_id, title, created_at, updated_at) VALUES ${rows}`
	);
}

function cleanupAdminPagination(idPrefix: string): void {
	d1(`DELETE FROM ai_conversations WHERE id LIKE '${idPrefix}%'`);
}

for (const width of VIEWPORTS) {
	test.describe(`signed in @${width}px`, () => {
		test.use({ viewport: { width, height: 667 }, hasTouch: true, isMobile: true });

		test('signed-in routes hold every invariant', async ({ page }) => {
			await signUpTestUser(page, `mobile-${width}`);
			const violations: Violation[] = [];
			for (const route of SIGNED_IN_ROUTES)
				violations.push(...(await sweep(page, route, width, 'body')));
			expect(formatViolations(onlyKinds(violations, ['tap-target', 'overflow', 'covered']))).toBe(
				'no violations'
			);
		});

		test('admin routes hold every invariant', async ({ page }) => {
			await signInAsAdmin(page);
			const idPrefix = `mobadminpg-${width}-`;
			cleanupAdminPagination(idPrefix); // guard against a prior run's leftovers
			seedAdminPagination(idPrefix);
			try {
				const violations: Violation[] = [];
				for (const route of ADMIN_ROUTES)
					violations.push(...(await sweep(page, route, width, 'body')));
				// Prove pagination actually rendered rather than passing vacuously
				// against a page that silently stayed on its unpaginated form.
				await page.goto('/admin/ai');
				await expect(page.getByRole('link', { name: 'Next' })).toBeVisible();
				expect(formatViolations(onlyKinds(violations, ['tap-target', 'overflow', 'covered']))).toBe(
					'no violations'
				);
			} finally {
				cleanupAdminPagination(idPrefix);
			}
		});
	});
}

test.describe('@375px', () => {
	test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

	// The spec chose 44px-tall header controls with natural width precisely so the
	// header would stay one row. A wrap is the regression this guards.
	test('the header stays a single row', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		const height = await page.evaluate(
			() => document.querySelector('header')!.getBoundingClientRect().height
		);
		expect(height).toBeLessThanOrEqual(72);
	});

	// The static per-route sweep above never answers a question, so it never sees
	// QuestionPlayer's advance button — that only mounts once a choice is revealed.
	// Drive the interaction here and hold the revealed state to the same standard.
	test('the revealed quiz-question state meets the tap-target minimum', async ({ page }) => {
		await page.goto('/quiz/quick');
		await page.getByRole('button', { name: /start quiz/i }).click();
		await page.getByTestId('choice').first().click();
		await expect(page.getByRole('button', { name: /next question|see results/i })).toBeVisible();
		const violations = toViolations(
			await page.evaluate(auditInPage, config('body')),
			'/quiz/quick (revealed)',
			375
		);
		expect(formatViolations(onlyKinds(violations, ['tap-target']))).toBe('no violations');
	});
});

test.describe('mobile navigation', () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test('mobile TOC dialog navigates between sections', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await page.getByRole('link', { name: /explore the rules/i }).click();
		await page
			.getByRole('link', { name: /spirit of the game/i })
			.first()
			.click();
		await expect(page.getByRole('heading', { name: /spirit of the game/i })).toBeVisible();

		const before = page.url();
		await page.getByRole('button', { name: /sections/i }).click();
		const dialog = page.getByRole('dialog', { name: /sections/i });
		await dialog.getByRole('link', { name: /the pull/i }).click();
		await expect(page).not.toHaveURL(before);
		await expect(page.getByRole('heading', { name: /the pull/i })).toBeVisible();

		const noOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
		);
		expect(noOverflow).toBe(true);
	});
});

test.describe('running quiz layout @375px', () => {
	test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

	test('the timed-run header does not overlap itself', async ({ page }) => {
		await page.goto('/quiz/timed');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /^start$/i }).click();
		await expect(page.getByRole('button', { name: /end run/i })).toBeVisible();

		const overlap = await page.evaluate(() => {
			const end = [...document.querySelectorAll('button')].find((b) =>
				/end run/i.test(b.textContent ?? '')
			)!;
			const streak = [...document.querySelectorAll('p')].find((p) =>
				/streak/i.test(p.textContent ?? '')
			)!;
			const a = end.getBoundingClientRect();
			const b = streak.getBoundingClientRect();
			return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
		});
		expect(overlap, 'the End run button overlaps the streak line').toBe(false);

		// Task 3 sized the End run button for a 44px tap target but could not verify it —
		// that state only exists mid-run. This is that run, still in progress.
		const violations = toViolations(
			await page.evaluate(auditInPage, config('body')),
			'/quiz/timed (running)',
			375
		);
		expect(formatViolations(onlyKinds(violations, ['tap-target']))).toBe('no violations');
	});
});

test.describe('running quiz layout @1024px', () => {
	test.use({ viewport: { width: 1024, height: 768 } });

	test('timer, streak, and End run keep their original left-to-right order', async ({ page }) => {
		await page.goto('/quiz/timed');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /^start$/i }).click();
		await expect(page.getByRole('button', { name: /end run/i })).toBeVisible();

		const lefts = await page.evaluate(() => {
			const end = [...document.querySelectorAll('button')].find((b) =>
				/end run/i.test(b.textContent ?? '')
			)!;
			const streak = [...document.querySelectorAll('p')].find((p) =>
				/streak/i.test(p.textContent ?? '')
			)!;
			const timer = [...document.querySelectorAll('p')].find((p) =>
				/^\d+:\d{2}$/.test((p.textContent ?? '').trim())
			)!;
			return {
				timer: timer.getBoundingClientRect().left,
				streak: streak.getBoundingClientRect().left,
				end: end.getBoundingClientRect().left
			};
		});
		expect(lefts.timer, 'timer should sit left of streak').toBeLessThan(lefts.streak);
		expect(lefts.streak, 'streak should sit left of End run').toBeLessThan(lefts.end);
	});
});

test.describe('mobile browser behaviour @375px', () => {
	test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

	// iOS Safari zooms the page when focus enters an input below 16px. There is no
	// way to observe that zoom in Chromium, so assert the cause instead.
	test('no input renders below 16px', async ({ page }) => {
		await signUpTestUser(page, 'mobile-inputs');
		const offenders: string[] = [];
		for (const route of ['/ask', '/me', '/quiz/timed']) {
			await page.goto(route);
			await page.waitForLoadState('networkidle');
			offenders.push(
				...(await page.evaluate(
					(r) =>
						[...document.querySelectorAll('input, textarea, select')]
							.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
							.map(
								(el) =>
									`${r}: ${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') ?? ''}" ${getComputedStyle(el).fontSize}`
							),
					route
				))
			);
		}
		// The search combobox lives in a portal outside the routes swept above, and
		// only mounts its input once the dialog is open.
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /^search$/i }).click();
		await expect(page.getByRole('combobox')).toBeVisible();
		offenders.push(
			...(await page.evaluate(
				(r) =>
					[...document.querySelectorAll('input, textarea, select')]
						.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
						.map(
							(el) =>
								`${r}: ${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') ?? ''}" ${getComputedStyle(el).fontSize}`
						),
				'search dialog'
			))
		);
		expect(offenders.join('\n')).toBe('');
	});

	test('the ask page does not scroll behind its panel', async ({ page }) => {
		await signUpTestUser(page, 'mobile-ask-scroll');
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		const { scrollHeight, clientHeight } = await page.evaluate(() => ({
			scrollHeight: document.documentElement.scrollHeight,
			clientHeight: document.documentElement.clientHeight
		}));
		expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
	});

	test('the search dialog result list fits the viewport', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /^search$/i }).click();
		await page.getByRole('combobox').fill('stall');
		await expect(page.getByRole('listbox')).toBeVisible();
		const bottom = await page.evaluate(() => {
			const c = document.querySelector('[role="dialog"]')!;
			return {
				dialog: c.getBoundingClientRect().bottom,
				vh: document.documentElement.clientHeight
			};
		});
		// Leaves room for an on-screen keyboard, which Playwright cannot open.
		expect(bottom.dialog).toBeLessThanOrEqual(bottom.vh * 0.7);
	});
});

/**
 * Extracts the alpha channel from a computed `color` string. Chromium serializes an opaque
 * color as `rgb(r, g, b)` with no alpha component at all, a color with an alpha modifier
 * (e.g. Tailwind's `text-navy/70`) as `oklab(l a b / alpha)`, and occasionally as
 * `rgba(r, g, b, a)`. No alpha component present means fully opaque (alpha 1).
 */
function colorAlpha(color: string): number {
	const oklab = color.match(/\/\s*([\d.]+)\s*\)$/);
	if (oklab) return Number(oklab[1]);
	const rgba = color.match(/^rgba?\(([^)]+)\)$/);
	if (rgba) {
		const parts = rgba[1].split(',').map((s) => s.trim());
		if (parts.length === 4) return Number(parts[3]);
	}
	return 1;
}

test.describe('touch affordances @375px', () => {
	test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

	test('a rule can be bookmarked on a touch device', async ({ page }) => {
		await signUpTestUser(page, 'mobile-bookmark');
		await page.goto(`/rules/${RULESET}/15`);
		await page.waitForLoadState('networkidle');

		const button = page.locator('button[aria-label^="Bookmark rule"]').first();
		await expect(button).toBeVisible();
		// toBeVisible passes at opacity 0, which is exactly the bug — assert the
		// computed value directly.
		await expect(button).toHaveCSS('opacity', '1');
		// Button opacity alone isn't enough either: the earlier fix made the button
		// reachable (opacity 1) while its icon stayed at `text-navy/30` — a fully
		// opaque button rendering a 30%-alpha icon via `fill="currentColor"`, which
		// reads as an unnoticeable ghost outline. Assert the icon's actual rendered
		// alpha (the computed `color` the SVG inherits) clears a legibility floor.
		// 0.6 is the point navy crosses the WCAG 1.4.11 non-text 3:1 contrast minimum
		// against a white row background; the implementation targets navy/70 (~4.9:1)
		// for margin above that floor.
		const color = await button.evaluate((el) => getComputedStyle(el).color);
		expect(colorAlpha(color)).toBeGreaterThanOrEqual(0.6);
		await button.tap();
		await expect(page.locator('button[aria-pressed="true"][aria-label*="rule"]')).toHaveCount(1);
	});

	test('a conversation can be deleted on a touch device', async ({ page }) => {
		const { email } = await signUpTestUser(page, 'mobile-del');
		d1(`DELETE FROM ai_conversations WHERE id LIKE 'mobiledel-%'`);
		const userId = (d1Select(`SELECT id FROM user WHERE email = '${email}'`)[0] as { id: string })
			.id;
		const now = Date.now();
		d1(
			`INSERT INTO ai_conversations (id, user_id, ruleset_id, title, created_at, updated_at, deleted_at) VALUES ('mobiledel-1', '${userId}', '${RULESET}', 'Seeded mobile convo', ${now}, ${now}, NULL)`
		);

		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /chats/i }).click();

		// The sidebar mounts twice (a desktop `aside`, permanently display:none below
		// `lg`, plus the mobile drawer opened above) — `:visible` excludes the dead
		// desktop copy so this targets the drawer's real button, not a 0x0 decoy.
		const del = page.locator('button[aria-label^="Delete conversation"]:visible').first();
		await expect(del).toBeVisible();
		await expect(del).toHaveCSS('opacity', '1');
		// Same class of bug as the bookmark button, different mechanism: the button
		// itself was reachable, but its icon carried its own `opacity-40` that never
		// lifted on touch. The icon's effective alpha is the button's color alpha
		// (always 1 here — the button is plain `text-navy`, no modifier) times the
		// svg's own opacity. Same 0.6 legibility floor as the bookmark icon.
		const svg = del.locator('svg');
		const buttonColor = await del.evaluate((el) => getComputedStyle(el).color);
		const svgOpacity = await svg.evaluate((el) => Number(getComputedStyle(el).opacity));
		expect(colorAlpha(buttonColor) * svgOpacity).toBeGreaterThanOrEqual(0.6);
		await del.tap();
		await expect(page.getByText('Seeded mobile convo')).toHaveCount(0);
	});
});

test.describe('admin conversation table @320px', () => {
	test.use({ viewport: { width: 320, height: 667 }, hasTouch: true, isMobile: true });

	// The audit never reached this table: local D1 had no conversations, so /admin/ai
	// rendered its empty state and the spec recorded the table as unverified. Five
	// columns with an untruncated title is a strong candidate for overflow, but that's
	// a prediction — seed a realistic worst case and let the measurement decide.
	test('the conversation table holds every invariant with real rows', async ({ page }) => {
		await signInAsAdmin(page);
		d1(`DELETE FROM ai_messages WHERE id LIKE 'mobtable-%'`);
		d1(`DELETE FROM ai_conversations WHERE id LIKE 'mobtable-%'`);
		const userId = (
			d1Select(`SELECT id FROM user WHERE email = '${ADMIN_EMAIL}'`)[0] as { id: string }
		).id;
		const now = Date.now();
		const title =
			'What happens when the thrower fumbles the disc after a contested stall count in the end zone';
		d1(
			`INSERT INTO ai_conversations (id, user_id, ruleset_id, title, created_at, updated_at, deleted_at) VALUES ('mobtable-1', '${userId}', '${RULESET}', '${title}', ${now}, ${now}, NULL)`
		);
		d1(
			`INSERT INTO ai_messages (id, conversation_id, role, content, status, model, feedback, created_at) VALUES ('mobtable-1-u', 'mobtable-1', 'user', 'seeded', NULL, NULL, NULL, ${now})`
		);

		const violations = await sweep(page, '/admin/ai', 320, 'body');
		// A seeding failure would leave the empty state rendered, and the sweep would
		// then pass vacuously against a table that was never exercised. Prove the
		// seeded row actually reached the page before trusting a clean result. There is
		// no sidebar-style duplication on this route to worry about scoping around.
		await expect(page.getByRole('link', { name: title })).toBeVisible();
		expect(formatViolations(onlyKinds(violations, ['tap-target', 'overflow', 'covered']))).toBe(
			'no violations'
		);
	});
});
