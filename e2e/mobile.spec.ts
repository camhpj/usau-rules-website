import { expect, test, type Page } from '@playwright/test';
import { signInAsAdmin, signUpTestUser } from './helpers';
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
			const violations: Violation[] = [];
			for (const route of ADMIN_ROUTES)
				violations.push(...(await sweep(page, route, width, 'body')));
			expect(formatViolations(onlyKinds(violations, ['tap-target', 'overflow', 'covered']))).toBe(
				'no violations'
			);
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
