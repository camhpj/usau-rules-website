import { expect, test } from '@playwright/test';
import { auditInPage, toViolations, INLINE_EXEMPT, HEADER_WIDTH_EXEMPT } from './mobile-audit';

const CONFIG = {
	inlineExempt: INLINE_EXEMPT,
	widthExempt: HEADER_WIDTH_EXEMPT,
	minSize: 44,
	minWidthExempt: 24,
	targetScope: 'body'
};

/**
 * Real pages ship this tag (see src/app.html); without it, Chromium's mobile
 * emulation lays out at a fallback desktop-ish width instead of the configured
 * 375px viewport, so a 500px-wide test div would never register as overflowing.
 */
const VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1" />';

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test('detects a horizontally overflowing element and names it', async ({ page }) => {
	await page.setContent(
		`${VIEWPORT_META}<body style="margin:0"><main><div id="wide" style="width:500px;height:20px"></div></main></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	expect(v.filter((x) => x.kind === 'overflow')).toHaveLength(1);
	expect(v[0].detail).toContain('div#wide');
});

test('does not flag a wide element inside a horizontally scrollable container', async ({
	page
}) => {
	await page.setContent(
		`${VIEWPORT_META}<body style="margin:0"><main>
			<div style="overflow-x:auto;width:100%"><div id="wide" style="width:500px;height:20px"></div></div>
		</main></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	expect(v.filter((x) => x.kind === 'overflow')).toHaveLength(0);
});

test('reports only the outermost overflowing element', async ({ page }) => {
	await page.setContent(
		`${VIEWPORT_META}<body style="margin:0"><main><div id="outer" style="width:500px"><div id="inner" style="width:480px;height:20px"></div></div></main></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	const overflow = v.filter((x) => x.kind === 'overflow');
	expect(overflow).toHaveLength(1);
	expect(overflow[0].detail).toContain('#outer');
	expect(overflow[0].detail).not.toContain('#inner');
});

test('flags an undersized tap target and passes a 44px one', async ({ page }) => {
	await page.setContent(
		`${VIEWPORT_META}<body style="margin:0"><main>
			<button id="small" style="width:20px;height:20px">a</button>
			<button id="ok" style="width:44px;height:44px">b</button>
		</main></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	const targets = v.filter((x) => x.kind === 'tap-target');
	expect(targets).toHaveLength(1);
	expect(targets[0].detail).toContain('#small');
	expect(targets[0].detail).toContain('20x20');
});

test('exempts links inside rule prose from the size floor', async ({ page }) => {
	await page.setContent(
		`${VIEWPORT_META}<body style="margin:0"><main><div class="rule-html">
			text <a href="#x" style="font-size:11px">15.A.</a> more text
			<dfn data-rule="3.A" role="button" tabindex="0" style="font-size:11px">thrower</dfn>
		</div></main></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	expect(v.filter((x) => x.kind === 'tap-target')).toHaveLength(0);
});

test('holds header controls to 44px tall and 24px wide', async ({ page }) => {
	await page.setContent(
		`${VIEWPORT_META}<body style="margin:0"><header><nav>
			<a id="short" href="/a" style="display:flex;width:30px;height:44px">Ask</a>
			<a id="flat" href="/b" style="display:flex;width:30px;height:20px">Quiz</a>
			<a id="thin" href="/c" style="display:flex;width:12px;height:44px">X</a>
		</nav></header></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	const ids = v.filter((x) => x.kind === 'tap-target').map((x) => x.detail);
	expect(ids.some((d) => d.includes('#short'))).toBe(false); // 30 wide is fine in the header
	expect(ids.some((d) => d.includes('#flat'))).toBe(true); // 20 tall is not
	expect(ids.some((d) => d.includes('#thin'))).toBe(true); // 12 wide is below the 24 floor
});

test('flags a fixed element covering main content', async ({ page }) => {
	await page.setContent(
		`${VIEWPORT_META}<body style="margin:0"><main><p id="text" style="margin:0;height:200px">rule text here</p></main>
		<div id="pill" style="position:fixed;top:50px;left:50px;width:100px;height:40px;background:#000"></div></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	const covered = v.filter((x) => x.kind === 'covered');
	expect(covered).toHaveLength(1);
	expect(covered[0].detail).toContain('#pill');
	expect(covered[0].detail).toContain('#text');
});

test('does not flag a fixed element inside an open dialog', async ({ page }) => {
	await page.setContent(
		`${VIEWPORT_META}<body style="margin:0"><main><p style="margin:0;height:200px">text</p></main>
		<div role="dialog"><div style="position:fixed;top:50px;left:50px;width:100px;height:40px"></div></div></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	expect(v.filter((x) => x.kind === 'covered')).toHaveLength(0);
});
