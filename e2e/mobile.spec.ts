import { expect, test, type Page } from '@playwright/test';
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
 * Audits one route at rest and again at the bottom of the page. The second pass
 * is what catches a fixed control sitting over the end of the content; at the
 * top of a long page it floats over nothing.
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
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await page.waitForTimeout(250);
	const atBottom = toViolations(
		await page.evaluate(auditInPage, config(targetScope)),
		`${route} (scrolled)`,
		width
	);
	// Only the coverage invariant is scroll-dependent; the rest would double-report.
	return [...found, ...atBottom.filter((v) => v.kind === 'covered')];
}

for (const width of VIEWPORTS) {
	test.describe(`@${width}px`, () => {
		test.use({ viewport: { width, height: 667 }, hasTouch: true, isMobile: true });

		test('shared header controls meet the tap-target minimum', async ({ page }) => {
			const violations: Violation[] = [];
			for (const route of PUBLIC_ROUTES)
				violations.push(...(await sweep(page, route, width, 'header')));
			expect(formatViolations(violations)).toBe('no violations');
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
