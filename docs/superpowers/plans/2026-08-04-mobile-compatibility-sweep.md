# Mobile Compatibility Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every mobile defect found by the audit in `docs/superpowers/specs/2026-08-04-mobile-compatibility-sweep-design.md`, and leave behind an e2e harness that fails CI when a new one appears.

**Architecture:** A reusable audit module (`e2e/mobile-audit.ts`) runs inside the browser and returns violations of three invariants: horizontal overflow, undersized tap targets, and fixed elements covering content. `e2e/mobile.spec.ts` drives it over a route table at three widths. Each fix task narrows the audit's scope config, watches the new scope fail, fixes the components, and watches it pass. The suite is green at every commit.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), Tailwind CSS v4.3, Playwright, Cloudflare Workers + D1.

## Global Constraints

- Tap target minimum is **44×44 CSS px**. Two exemptions only, both defined in `e2e/mobile-audit.ts`: links inside running prose (no floor), and controls in the sticky header (44px height, **24px** width floor).
- Viewports under test: **320, 375, 768** CSS px, in a Chromium context with `hasTouch: true` and `isMobile: true`.
- Ruleset id for e2e routes is `usau-official-2026-27`. Section slugs are bare numbers (`15`), plus `preface`.
- No visual redesign. Fixes change what is broken or unreachable and nothing else. The header must stay one row at 375px.
- Code under `src/` runs on Cloudflare Workers. No Node built-ins.
- Every task ends with `npm run check`, `npm run test`, and `npx prettier --check .` passing.
- The e2e suite runs single-worker against one wrangler dev server and one D1 file. Never add a parallel worker.
- Commit messages follow the repo style: lowercase `type: subject`, body in plain language, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.

---

## File Structure

**Create:**

- `e2e/mobile-audit.ts` — the browser-side audit function, its config and result types, and a formatter that turns violations into a readable failure message. No Playwright imports beyond types; the audit function must be self-contained so `page.evaluate` can serialize it.

**Modify:**

- `e2e/mobile.spec.ts` — replaced by the data-driven sweep plus targeted interaction tests.
- `src/lib/components/Nav.svelte`, `Button.svelte`, `TogglePill.svelte` — shared chrome tap targets.
- `src/lib/components/chat/ChatMessageRow.svelte`, `chat/ConversationSidebar.svelte` — tap targets and touch affordance.
- `src/lib/components/rules/RuleNode.svelte` — bookmark button touch affordance and size.
- `src/lib/components/DisplayNameClaim.svelte` — 16px input, inline-target opt-in.
- `src/routes/+page.svelte` — `dvh` on the hero.
- `src/routes/ask/+layout.svelte`, `ask/[[id]]/+page.svelte` — panel height, tap targets, 16px textarea.
- `src/routes/me/+page.svelte`, `leaderboard/+page.svelte`, `rules/[ruleset]/+page.svelte`, `rules/[ruleset]/[section]/+page.svelte`, `quiz/timed/+page.svelte` — page-level tap targets and layout.
- `src/lib/components/SearchDialog.svelte` — viewport-relative result list height.
- `src/lib/components/quiz/QuestionPlayer.svelte` — "Next question" button height.
- `src/routes/admin/+layout.svelte`, `admin/export/+page.svelte`, `admin/ai/+page.svelte` — overflow and tap targets.

---

## Task 1: The audit module

**Files:**

- Create: `e2e/mobile-audit.ts`
- Create: `e2e/mobile-audit.spec.ts` — permanent coverage for the detector itself

**Interfaces:**

- Consumes: nothing.
- Produces: `auditInPage(config: AuditConfig): RawAudit`, `toViolations(raw, route, width): Violation[]`, `formatViolations(v: Violation[]): string`, and the constants `INLINE_EXEMPT`, `HEADER_WIDTH_EXEMPT`, `MIN_TARGET`, `MIN_TARGET_WIDTH_EXEMPT`. `Violation` is `{ kind: 'overflow' | 'tap-target' | 'covered'; route: string; width: number; detail: string }`.

- [ ] **Step 1: Write the failing test**

Create `e2e/mobile-audit.spec.ts`. It builds synthetic pages with `page.setContent` so the detector is tested against known-good and known-bad markup, with no dependence on the app.

```ts
import { expect, test } from '@playwright/test';
import { auditInPage, toViolations, INLINE_EXEMPT, HEADER_WIDTH_EXEMPT } from './mobile-audit';

const CONFIG = {
	inlineExempt: INLINE_EXEMPT,
	widthExempt: HEADER_WIDTH_EXEMPT,
	minSize: 44,
	minWidthExempt: 24,
	targetScope: 'body'
};

test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test('detects a horizontally overflowing element and names it', async ({ page }) => {
	await page.setContent(
		`<body style="margin:0"><main><div id="wide" style="width:500px;height:20px"></div></main></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	expect(v.filter((x) => x.kind === 'overflow')).toHaveLength(1);
	expect(v[0].detail).toContain('div#wide');
});

test('reports only the outermost overflowing element', async ({ page }) => {
	await page.setContent(
		`<body style="margin:0"><main><div id="outer" style="width:500px"><div id="inner" style="width:480px;height:20px"></div></div></main></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	const overflow = v.filter((x) => x.kind === 'overflow');
	expect(overflow).toHaveLength(1);
	expect(overflow[0].detail).toContain('#outer');
	expect(overflow[0].detail).not.toContain('#inner');
});

test('flags an undersized tap target and passes a 44px one', async ({ page }) => {
	await page.setContent(
		`<body style="margin:0"><main>
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
		`<body style="margin:0"><main><div class="rule-html">
			text <a href="#x" style="font-size:11px">15.A.</a> more text
			<dfn data-rule="3.A" role="button" tabindex="0" style="font-size:11px">thrower</dfn>
		</div></main></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	expect(v.filter((x) => x.kind === 'tap-target')).toHaveLength(0);
});

test('holds header controls to 44px tall and 24px wide', async ({ page }) => {
	await page.setContent(
		`<body style="margin:0"><header><nav>
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
		`<body style="margin:0"><main><p id="text" style="margin:0;height:200px">rule text here</p></main>
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
		`<body style="margin:0"><main><p style="margin:0;height:200px">text</p></main>
		<div role="dialog"><div style="position:fixed;top:50px;left:50px;width:100px;height:40px"></div></div></body>`
	);
	const v = toViolations(await page.evaluate(auditInPage, CONFIG), '/synthetic', 375);
	expect(v.filter((x) => x.kind === 'covered')).toHaveLength(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile-audit.spec.ts --reporter=line`

Expected: FAIL. Playwright cannot resolve `./mobile-audit`, so every test errors at import.

- [ ] **Step 3: Write the audit module**

Create `e2e/mobile-audit.ts`.

`auditInPage` is serialized into the browser by `page.evaluate`, so it must not reference anything outside its own body. Everything it needs arrives through `config`.

```ts
/**
 * Mobile layout audit. `auditInPage` runs inside the browser via `page.evaluate`,
 * which serializes the function source — it must not close over anything in this
 * module. All configuration arrives through its single argument.
 *
 * See docs/superpowers/specs/2026-08-04-mobile-compatibility-sweep-design.md for
 * the invariants and why the two exemptions exist.
 */

/** WCAG 2.2 AAA target size. */
export const MIN_TARGET = 44;

/**
 * WCAG 2.2 AA target size, applied as a width floor to header controls only.
 * At 375px the wordmark plus five controls need roughly 416px against 343px of
 * available content width, so the header cannot give every control 44px of
 * width without wrapping to a second row.
 */
export const MIN_TARGET_WIDTH_EXEMPT = 24;

/**
 * Links inside running prose. WCAG 2.2 exempts targets "in a sentence or block
 * of text" at both AA and AAA. Keep this list short: a control that needs adding
 * here is usually a control in the wrong place.
 */
export const INLINE_EXEMPT = [
	'.rule-html a', // rule cross-references
	'dfn[data-rule]', // glossary terms
	'footer a', // the "not affiliated" sentence
	'footer button',
	'[data-inline-target]' // opt-in, for prose links outside the cases above
];

/** Controls in the sticky header — see MIN_TARGET_WIDTH_EXEMPT. */
export const HEADER_WIDTH_EXEMPT = ['header nav a', 'header nav button'];

export interface AuditConfig {
	inlineExempt: string[];
	widthExempt: string[];
	minSize: number;
	minWidthExempt: number;
	/** Restrict the tap-target check to this subtree. Widens as fixes land. */
	targetScope: string;
}

export interface RawAudit {
	viewportWidth: number;
	scrollWidth: number;
	overflow: { el: string; left: number; right: number }[];
	targets: { el: string; label: string; w: number; h: number; reason: string }[];
	covered: { fixed: string; content: string; text: string }[];
}

export interface Violation {
	kind: 'overflow' | 'tap-target' | 'covered';
	route: string;
	width: number;
	detail: string;
}

export function auditInPage(config: AuditConfig): RawAudit {
	const de = document.documentElement;
	const vw = de.clientWidth;
	const vh = de.clientHeight;

	const describe = (el: Element): string => {
		const id = el.id ? `#${el.id}` : '';
		const cls = String((el as HTMLElement).className ?? '')
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 3)
			.map((c) => `.${c}`)
			.join('');
		return `${el.tagName.toLowerCase()}${id}${cls}`;
	};

	// --- Invariant 1: no horizontal overflow.
	// Report only root offenders. A child of an overflowing box overflows too,
	// and listing the whole chain buries the element that actually needs fixing.
	const overflowing = new Set<Element>();
	for (const el of document.querySelectorAll('body *')) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) continue;
		if (r.right > vw + 1 || r.left < -1) overflowing.add(el);
	}
	const overflow: RawAudit['overflow'] = [];
	for (const el of overflowing) {
		let nested = false;
		for (let p = el.parentElement; p; p = p.parentElement) {
			if (overflowing.has(p)) {
				nested = true;
				break;
			}
		}
		if (nested) continue;
		const r = el.getBoundingClientRect();
		overflow.push({ el: describe(el), left: Math.round(r.left), right: Math.round(r.right) });
	}

	// --- Invariant 2: no undersized tap target.
	const INTERACTIVE = 'a[href], button, input, textarea, select, [role="button"], [tabindex="0"]';
	const targets: RawAudit['targets'] = [];
	const scope = document.querySelector(config.targetScope);
	for (const el of scope ? scope.querySelectorAll(INTERACTIVE) : []) {
		if (config.inlineExempt.some((s) => el.matches(s))) continue;
		if (el.closest('[aria-hidden="true"]')) continue;
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) continue; // not rendered
		const widthExempt = config.widthExempt.some((s) => el.matches(s));
		const minW = widthExempt ? config.minWidthExempt : config.minSize;
		const short = r.height < config.minSize;
		const narrow = r.width < minW;
		if (!short && !narrow) continue;
		targets.push({
			el: describe(el),
			label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 36),
			w: Math.round(r.width),
			h: Math.round(r.height),
			reason: short && narrow ? 'too small' : short ? `under ${config.minSize} tall` : `under ${minW} wide`
		});
	}

	// --- Invariant 3: no fixed element covering page content.
	// The sticky header is excluded by construction (position: sticky, not fixed) —
	// content scrolling under it is intended. Dialogs cover on purpose.
	const covered: RawAudit['covered'] = [];
	for (const el of document.querySelectorAll('body *')) {
		if (getComputedStyle(el).position !== 'fixed') continue;
		if (el.closest('[role="dialog"]')) continue;
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) continue;
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
		const stack = document.elementsFromPoint(cx, cy);
		const self = stack.findIndex((e) => e === el || el.contains(e));
		const beneath = self === -1 ? stack : stack.slice(self + 1);
		const hit = beneath.find(
			(e) => e.closest('main') !== null && !el.contains(e) && !e.contains(el)
		);
		if (hit)
			covered.push({
				fixed: describe(el),
				content: describe(hit),
				text: (hit.textContent ?? '').trim().slice(0, 40)
			});
	}

	return { viewportWidth: vw, scrollWidth: de.scrollWidth, overflow, targets, covered };
}

export function toViolations(raw: RawAudit, route: string, width: number): Violation[] {
	const out: Violation[] = [];
	for (const o of raw.overflow)
		out.push({
			kind: 'overflow',
			route,
			width,
			detail: `${o.el} spans x=${o.left}..${o.right} past the ${raw.viewportWidth}px viewport`
		});
	for (const t of raw.targets)
		out.push({
			kind: 'tap-target',
			route,
			width,
			detail: `${t.el} "${t.label}" is ${t.w}x${t.h} (${t.reason})`
		});
	for (const c of raw.covered)
		out.push({
			kind: 'covered',
			route,
			width,
			detail: `${c.fixed} covers ${c.content} "${c.text}"`
		});
	return out;
}

export function formatViolations(violations: Violation[]): string {
	if (violations.length === 0) return 'no violations';
	const byRoute = new Map<string, Violation[]>();
	for (const v of violations) {
		const key = `${v.route} @${v.width}`;
		const list = byRoute.get(key) ?? [];
		list.push(v);
		byRoute.set(key, list);
	}
	const lines = [`${violations.length} mobile violation(s):`];
	for (const [key, list] of byRoute) {
		lines.push(`  ${key}`);
		for (const v of list) lines.push(`    [${v.kind}] ${v.detail}`);
	}
	return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test e2e/mobile-audit.spec.ts --reporter=line`

Expected: PASS, 7 tests.

If "reports only the outermost overflowing element" fails because both ids appear, the root-offender filter is wrong — check that the `nested` loop breaks out of the ancestor walk rather than returning from the enclosing function.

- [ ] **Step 5: Keep the synthetic spec and confirm the gate**

`e2e/mobile-audit.spec.ts` stays. A detector that silently stops detecting turns the whole sweep green and hands back false confidence, which is the one failure this harness exists to prevent. The seven tests use `page.setContent` with no navigation, so they cost little.

```bash
npm run check:e2e
npx prettier --check .
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add e2e/mobile-audit.ts e2e/mobile-audit.spec.ts
git commit -m "$(cat <<'EOF'
test: add the mobile layout audit module

Detects three invariant violations in the browser: horizontal overflow,
undersized tap targets, and fixed elements covering content. Reports only
root offenders for overflow, so a failure names the element to fix.

Carries the two size exemptions the spec settled on: links inside running
prose, and header controls, which cannot all reach 44px wide at 375px.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Shared chrome tap targets

Fixes the controls that appear on every page. The audit's `targetScope` starts at `header` so this task's test covers exactly what it fixes.

**Files:**

- Modify: `src/lib/components/Nav.svelte`
- Modify: `src/lib/components/Button.svelte`
- Modify: `src/lib/components/TogglePill.svelte`
- Modify: `e2e/mobile.spec.ts`

**Interfaces:**

- Consumes: `auditInPage`, `toViolations`, `formatViolations`, `INLINE_EXEMPT`, `HEADER_WIDTH_EXEMPT`, `MIN_TARGET`, `MIN_TARGET_WIDTH_EXEMPT` from `./mobile-audit`.
- Produces: `e2e/mobile.spec.ts` exports nothing. It establishes the constants `VIEWPORTS = [320, 375, 768]`, `RULESET = 'usau-official-2026-27'`, and `PUBLIC_ROUTES`, which later tasks extend.

- [ ] **Step 1: Write the failing test**

Replace the whole of `e2e/mobile.spec.ts`. The existing TOC test is preserved at the bottom — do not drop it.

```ts
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
 * `sweep` always returns every violation kind it finds, even ones this task did
 * not fix, so later tasks can widen coverage without changing the sweep itself.
 * Each task's assertion narrows to the kinds it actually fixed. Task 2 only
 * fixed tap targets. Overflow joins at Task 4, covered at Task 5.
 */
function onlyKinds(violations: Violation[], kinds: Violation['kind'][]): Violation[] {
	return violations.filter((v) => kinds.includes(v.kind));
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
			for (const route of PUBLIC_ROUTES) violations.push(...(await sweep(page, route, width, 'header')));
			expect(formatViolations(onlyKinds(violations, ['tap-target']))).toBe('no violations');
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: the three "shared header controls" tests FAIL, listing the nav's undersized controls. At 375 the message should name `a "Rules" 35x15`, `a "Quiz" 26x15`, `a "Ask" 22x15`, `button "Search" 26x30`, and `button "Sign in" 30x30`, each `under 44 tall`. "Ask" also reports `under 24 wide`.

- [ ] **Step 3: Fix the nav**

In `src/lib/components/Nav.svelte`, make four edits. Every control gains 44px of height, which fits inside the bar's existing `min-h-16`. Widths stay as they are, apart from "Ask" clearing the 24px floor.

Search button — add `min-h-11` and `justify-center`, and widen the mobile padding from `px-1` to `px-2`:

```svelte
class="flex min-h-11 items-center justify-center gap-2 rounded-full border border-transparent px-2 py-1.5 text-xs font-semibold tracking-wider text-white/70 uppercase hover:border-white/60 hover:text-white sm:border-white/25 sm:px-3.5"
```

Nav links — the `{#each links}` anchor becomes a flex box with height and a little horizontal padding:

```svelte
class="flex min-h-11 items-center px-1 text-[10px] font-semibold tracking-[0.05em] whitespace-nowrap uppercase transition-colors sm:text-xs sm:tracking-[0.18em]
	{active ? 'text-cardinal' : 'text-white/70 hover:text-white'}"
```

Sign-in button — add `min-h-11` and centering to the shared snippet's class list:

```svelte
'inline-flex min-h-11 items-center justify-center rounded-full border border-white/25 p-1.5 text-[11px] font-semibold tracking-wider whitespace-nowrap text-white/80 uppercase hover:border-white/60 hover:text-white sm:px-4 sm:py-1.5 sm:text-xs'
```

Account menu trigger — the button grows to 44×44 while the avatar circle stays 32px, so the header looks unchanged:

```svelte
<DropdownMenu.Trigger
	aria-label="Account menu"
	class="flex h-11 w-11 items-center justify-center"
>
	<span
		class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/25 text-xs font-bold text-white uppercase hover:border-white/60"
	>
		{#if user.image}
			<img src={user.image} alt="" referrerpolicy="no-referrer" class="h-full w-full object-cover" />
		{:else}
			{user.name?.[0] ?? '?'}
		{/if}
	</span>
</DropdownMenu.Trigger>
```

- [ ] **Step 4: Fix the two shared button components**

`src/lib/components/Button.svelte` — `py-2.5` renders 40px tall. Both variants go to `py-3`:

```ts
const base = $derived(
	variant === 'filled'
		? 'rounded-full bg-cardinal px-6 py-3 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110'
		: 'rounded-full border border-navy/30 px-6 py-3 text-sm font-semibold tracking-wider text-navy uppercase hover:border-navy'
);
```

`src/lib/components/TogglePill.svelte` — `py-1.5` renders 30px tall. `min-h-11` with `inline-flex` centring holds the text where it is:

```svelte
class="inline-flex min-h-11 items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors
	{selected ? 'border-navy bg-navy text-white' : 'border-mist text-navy/70 hover:border-navy/40'}"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: PASS, including "the header stays a single row".

If the header test fails at 73px or more, the account trigger's `h-11 w-11` pushed the bar over. Fall back to `h-11 w-8` there — the height is what the tap-target invariant needs, and `HEADER_WIDTH_EXEMPT` covers the width.

- [ ] **Step 6: Run the full gate**

```bash
npm run check && npm run test && npx prettier --check .
```

Expected: all pass. `Button` and `TogglePill` are used across the quiz and leaderboard pages; a 4px height change breaks no unit test, but run them to be sure.

- [ ] **Step 7: Commit**

```bash
git add e2e/mobile.spec.ts src/lib/components/Nav.svelte src/lib/components/Button.svelte src/lib/components/TogglePill.svelte
git commit -m "$(cat <<'EOF'
fix: give shared chrome controls a 44px tap target

The nav's links and icon buttons measured 15 to 32px tall on a phone. All
of them now clear 44px of height inside the bar's existing min-h-16, so the
header keeps its one-row layout at 375px — a new test pins that.

Widths stay as they are. At 375px the wordmark plus five controls need
roughly 416px against 343px of content width, so the header takes the WCAG
2.2 AA 24px width floor instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Page-level tap targets

Widens `targetScope` to `body` for the public routes and fixes what that surfaces.

**Files:**

- Modify: `e2e/mobile.spec.ts`
- Modify: `src/routes/+page.svelte`, `src/routes/leaderboard/+page.svelte`, `src/routes/quiz/timed/+page.svelte`, `src/routes/rules/[ruleset]/+page.svelte`, `src/routes/rules/[ruleset]/[section]/+page.svelte`
- Modify: `src/lib/components/quiz/QuestionPlayer.svelte`

**Interfaces:**

- Consumes: everything Task 2 established in `e2e/mobile.spec.ts`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

In `e2e/mobile.spec.ts`, change the sweep inside the `for (const width of VIEWPORTS)` loop from `'header'` to `'body'` and rename it:

```ts
test('all controls meet the tap-target minimum', async ({ page }) => {
	const violations: Violation[] = [];
	for (const route of PUBLIC_ROUTES) violations.push(...(await sweep(page, route, width, 'body')));
	expect(formatViolations(onlyKinds(violations, ['tap-target']))).toBe('no violations');
});
```

`onlyKinds` already exists in the file from Task 2. It keeps each task's assertion to the kinds that task fixed, so the suite is green at every commit. Overflow joins the list in Task 4; covered joins in Task 5. Leave the filter at `['tap-target']` here.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: FAIL, naming the page-level controls below. Read the actual output and work from it — the list below is the audit's own findings and should match, but the output is authoritative.

- [ ] **Step 3: Apply the page-level fixes**

Each is a class change on one element. The pattern is the same throughout: `inline-flex min-h-11 items-center` on a text link or small button, `h-11 w-11` on an icon button.

| File | Element | Change |
| --- | --- | --- |
| `src/routes/+page.svelte` | "✦ Ask any question" link | add `min-h-11` to its existing `inline-flex items-center` |
| `src/routes/leaderboard/+page.svelte` | "Try again" button | `px-5 py-2` → `inline-flex min-h-11 items-center px-5 py-2` |
| `src/routes/quiz/timed/+page.svelte` | "See the leaderboard →" (intro) | wrap in `inline-flex min-h-11 items-center` |
| `src/routes/quiz/timed/+page.svelte` | "End run" button | add `min-h-11` |
| `src/routes/quiz/timed/+page.svelte` | nudge "✕" dismiss button | `ml-1` → `ml-1 inline-flex h-11 w-11 items-center justify-center` |
| `src/routes/rules/[ruleset]/+page.svelte` | "Source: … ↗" link | add `min-h-11` to its `inline-flex items-center` |
| `src/routes/rules/[ruleset]/[section]/+page.svelte` | "Quiz me on this section →" | add `min-h-11` to its `inline-flex items-center` |
| `src/routes/rules/[ruleset]/[section]/+page.svelte` | prev/next section links | add `inline-flex min-h-11 items-center` to both anchors |
| `src/lib/components/quiz/QuestionPlayer.svelte` | "Next question" / finish button | `px-6 py-2` → `inline-flex min-h-11 items-center px-6 py-2` |

The rules section page's rule anchors (`15.A.`) and glossary `dfn` terms must **not** change. They are covered by `INLINE_EXEMPT`. If the audit reports them, the exemption selectors are not matching — fix the selector, not the markup.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: PASS at all three widths.

- [ ] **Step 5: Run the full gate**

```bash
npm run check && npm run test && npx prettier --check .
```

- [ ] **Step 6: Commit**

```bash
git add e2e/mobile.spec.ts src/routes src/lib/components/quiz/QuestionPlayer.svelte
git commit -m "$(cat <<'EOF'
fix: raise page-level controls to a 44px tap target

Widens the mobile sweep from the header to the whole body on every public
route, and lifts the links and small buttons it surfaced: the landing ask
link, the leaderboard retry, the timed-run controls, the rules source and
quiz links, section prev/next, and the question player's advance button.

Rule cross-references and glossary terms keep their prose sizing under the
inline exemption.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Admin layout and signed-in routes

Adds the signed-in and admin routes to the sweep, and turns on the overflow invariant. `/admin`'s range-pill row is the one measured overflow in the app.

**Files:**

- Modify: `e2e/mobile.spec.ts`
- Modify: `src/routes/admin/+layout.svelte`, `src/routes/admin/export/+page.svelte`
- Modify: `src/routes/me/+page.svelte`, `src/routes/ask/+layout.svelte`, `src/routes/ask/[[id]]/+page.svelte`
- Modify: `src/lib/components/chat/ChatMessageRow.svelte`
- Modify: `src/lib/components/DisplayNameClaim.svelte`

**Interfaces:**

- Consumes: `signUpTestUser` and `signInAsAdmin` from `./helpers`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `e2e/mobile.spec.ts`. These need a session, so they sign in first and then sweep. Overflow is asserted here for the first time, across every route including the public ones.

```ts
import { signInAsAdmin, signUpTestUser } from './helpers';

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
			expect(formatViolations(onlyKinds(violations, ['tap-target', 'overflow']))).toBe(
				'no violations'
			);
		});

		test('admin routes hold every invariant', async ({ page }) => {
			await signInAsAdmin(page);
			const violations: Violation[] = [];
			for (const route of ADMIN_ROUTES)
				violations.push(...(await sweep(page, route, width, 'body')));
			expect(formatViolations(onlyKinds(violations, ['tap-target', 'overflow']))).toBe(
				'no violations'
			);
		});
	});
}
```

This task is where overflow turns on. Widen the existing public-route test's filter to `['tap-target', 'overflow']` as well, so the invariant applies everywhere rather than only on the routes added here. Covered content stays out until Task 5.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: FAIL. At 375 the admin test reports `[overflow] div.ml-auto.flex.items-center spans x=225..408 past the 375px viewport`, plus undersized admin tabs and range pills. The signed-in test reports `/ask`'s Chats, New chat, and Send controls, `/me`'s links, and the chat row's copy and thumb buttons.

- [ ] **Step 3: Fix the admin layout**

In `src/routes/admin/+layout.svelte`, let the tab bar wrap and give the pill group its own line on narrow screens. The `nav` element:

```svelte
<nav class="mt-3 flex flex-wrap items-center gap-x-4 border-b border-white/15 text-sm">
```

The tabs:

```svelte
class="inline-flex min-h-11 cursor-pointer items-center pb-2 {active(tab.href)
	? 'border-b-2 border-cardinal font-semibold text-cardinal'
	: 'text-white/70 hover:text-white'}"
```

The pill container drops to its own full-width row below `sm`, which is what clears the overflow:

```svelte
<div class="ml-auto flex w-full items-center justify-end gap-2 pb-2 sm:w-auto">
```

The shared pill class gains height:

```ts
const pill = 'inline-flex min-h-11 items-center rounded-full px-2.5 py-1 text-xs font-medium';
```

In `src/routes/admin/export/+page.svelte`, the Download link:

```svelte
class="inline-flex min-h-11 cursor-pointer items-center rounded bg-cardinal px-3 py-1.5 text-sm font-medium text-white"
```

- [ ] **Step 4: Fix the signed-in routes**

`src/routes/ask/+layout.svelte` — the drawer toggle and the New chat pill:

```svelte
<!-- Chats / Close button -->
class="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold tracking-wider text-navy/60 uppercase hover:text-navy"

<!-- New chat link -->
class="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cardinal px-3 py-1.5 text-xs font-semibold tracking-wider text-white uppercase hover:brightness-110"
```

`src/routes/ask/[[id]]/+page.svelte` — the Stop and Send buttons both go from `h-9 w-9` to `h-11 w-11`.

`src/lib/components/chat/ChatMessageRow.svelte` — the copy button and both thumb buttons go from `h-7 w-7` to `h-11 w-11`. The icons inside stay `h-4 w-4`, so the row looks the same with a larger hit area.

`src/routes/me/+page.svelte`:

| Element | Change |
| --- | --- |
| "Leaderboard →" link | `class="eyebrow ..."` → `class="eyebrow inline-flex min-h-11 items-center ..."` |
| "Full mastery grid →" link | add `inline-flex min-h-11 items-center` |
| "Up next" section chips | `px-3 py-1.5` → `inline-flex min-h-11 items-center px-3 py-1.5` |
| bookmark remove button | `shrink-0` → `flex h-11 w-11 shrink-0 items-center justify-center` |

`/me`'s "change" and "remove" links sit inside a sentence (`<b>Name</b> · change · remove`), as do `DisplayNameClaim`'s "join as …" and "use another name". Mark all four with `data-inline-target` rather than resizing them — that is what the opt-in exists for.

In `src/routes/me/+page.svelte`:

```svelte
<button
	type="button"
	data-inline-target
	onclick={startChange}
	class="text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
	>change</button
>
```

Apply the same `data-inline-target` attribute to the "remove" button beside it, and to both buttons in `src/lib/components/DisplayNameClaim.svelte` ("join as …" and "use another name"). Leave the Save and cancel buttons in that component alone — they are discrete controls inside the edit form, and the audit will tell you if they need height.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: PASS.

`/admin/ai` will report no table violations because the local D1 has no conversations. Task 8 covers that; do not treat the pass as proof the table is fine.

- [ ] **Step 6: Run the full gate**

```bash
npm run check && npm run test && npx prettier --check .
```

- [ ] **Step 7: Commit**

```bash
git add e2e/mobile.spec.ts src/routes src/lib/components
git commit -m "$(cat <<'EOF'
fix: stop /admin overflowing and size the signed-in controls

The admin range-pill row ran 33px past a 375px viewport. It now wraps to
its own line below sm, and the tabs and pills clear 44px.

Extends the mobile sweep to the signed-in and admin routes and turns on the
overflow invariant everywhere. Lifts the ask composer, drawer, chat message
actions, and dashboard links that the wider sweep surfaced.

Links that sit inside a sentence on /me opt out via data-inline-target
rather than growing and breaking the line.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Overlapping and covered controls

Two confirmed layout defects: the timed-run header overlaps itself, and the floating TOC pill sits on top of rule text.

**Files:**

- Modify: `src/routes/quiz/timed/+page.svelte`
- Modify: `src/routes/rules/[ruleset]/[section]/+page.svelte`
- Modify: `e2e/mobile.spec.ts`

**Interfaces:**

- Consumes: `sweep` and `VIEWPORTS` from this spec file.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Two edits to `e2e/mobile.spec.ts`.

First, this task is where covered content turns on. Widen every existing `onlyKinds` filter in the file to include `'covered'`, so all three assertions read `onlyKinds(violations, ['tap-target', 'overflow', 'covered'])`. That is what makes the TOC-pill defect fail the sweep. Once done, every violation kind the audit detects is asserted somewhere, and the filter has served its purpose — leave it in place rather than deleting it, since it documents the progression.

Second, append the timed-run case below. It needs the run started before anything can overlap, so the sweep cannot express it.

```ts
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
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: two failures. The new timed-run test fails with "the End run button overlaps the streak line". The `@375px` and `@320px` sweeps fail with `[covered] button.fixed.bottom-5.left-1/2 covers td …` on the scrolled rules route.

- [ ] **Step 3: Fix the timed-run header**

In `src/routes/quiz/timed/+page.svelte`, the "End run" button is absolutely positioned and vertically centred over a two-row flex-wrap container, so it lands on the streak line. Put it back in normal flow and let the streak line own the second row.

Move the `<button>` so it comes immediately after the timer `<p>` in source order, then replace the three elements' classes:

```svelte
<div class="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-navy px-5 py-3">
	<p class="font-mono text-3xl font-bold {run.timeLeft <= 10 ? 'text-cardinal' : 'text-white'}">
		{Math.floor(run.timeLeft / 60)}:{String(run.timeLeft % 60).padStart(2, '0')}
	</p>
	<button
		type="button"
		onclick={() => run.finish()}
		class="inline-flex min-h-11 items-center rounded-full border border-white/30 px-4 py-1.5 text-xs font-semibold tracking-wider whitespace-nowrap text-white/80 uppercase hover:border-white"
	>
		End run
	</button>
	<p
		class="order-last basis-full text-xs font-semibold tracking-wider whitespace-nowrap text-white/70 uppercase sm:order-none sm:basis-auto sm:text-sm"
	>
		Streak {run.streak} · Score {run.records.filter((r) => r.correct).length}
	</p>
</div>
```

Below `sm` this gives the timer and End run one row, with the streak on its own row underneath. At `sm` and up, `sm:order-none` and `sm:basis-auto` restore today's single-row order of timer, streak, End run.

- [ ] **Step 4: Fix the TOC pill clearance**

In `src/routes/rules/[ruleset]/[section]/+page.svelte`, the page reserves no space for the fixed "Sections" pill, so it lands on the last of the rule content. The pill is 34px tall at `bottom-5` (20px), so 96px of bottom padding clears it with room to spare. It only renders below `lg`:

```svelte
<div class="mx-auto flex max-w-6xl gap-8 px-4 pt-8 pb-24 sm:px-6 lg:pb-8">
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: PASS.

- [ ] **Step 6: Run the full gate**

```bash
npm run check && npm run test && npx prettier --check .
```

`src/lib/quiz/timed-run.test.ts` covers the run state, not the header markup, so it should be unaffected. Confirm it still passes.

- [ ] **Step 7: Commit**

```bash
git add e2e/mobile.spec.ts "src/routes/quiz/timed/+page.svelte" "src/routes/rules/[ruleset]/[section]/+page.svelte"
git commit -m "$(cat <<'EOF'
fix: stop mobile controls landing on top of content

The timed run's End run button was absolutely positioned and centred over a
two-row header, so it sat on the streak line at 375px. It moves into normal
flow, with the streak taking the second row below sm and the original order
restored at sm and up.

The rules section page reserved no space for the floating Sections pill,
which covered live rule text at the end of the page. It now pads the bottom
below lg, where the pill renders.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Mobile browser behaviors

Three of these cannot be asserted in Playwright, which simulates neither a retracting URL bar nor an on-screen keyboard. The `/ask` page scroll is measurable and gets a test; the rest are fixed on the strength of the mechanism.

**Files:**

- Modify: `src/routes/ask/[[id]]/+page.svelte`, `src/routes/ask/+layout.svelte`
- Modify: `src/lib/components/DisplayNameClaim.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/components/SearchDialog.svelte`
- Modify: `e2e/mobile.spec.ts`

**Interfaces:**

- Consumes: `signUpTestUser` from `./helpers`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `e2e/mobile.spec.ts`. Two assertions: no input under 16px anywhere, and the `/ask` page does not scroll behind its fixed-height panel.

```ts
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
				...(await page.evaluate((r) =>
					[...document.querySelectorAll('input, textarea, select')]
						.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
						.map(
							(el) =>
								`${r}: ${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') ?? ''}" ${getComputedStyle(el).fontSize}`
						), route))
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
			return { dialog: c.getBoundingClientRect().bottom, vh: document.documentElement.clientHeight };
		});
		// Leaves room for an on-screen keyboard, which Playwright cannot open.
		expect(bottom.dialog).toBeLessThanOrEqual(bottom.vh * 0.7);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: three failures. The input test names `/ask: textarea "Your message" 14px`. The scroll test reports 685 against 667. The search test reports a dialog bottom near 537 against a 467 limit.

- [ ] **Step 3: Raise the inputs to 16px**

`src/routes/ask/[[id]]/+page.svelte`, the composer textarea — `text-sm` becomes `text-base`:

```svelte
class="min-h-0 w-full resize-none rounded-lg bg-transparent p-3 text-base text-navy placeholder:text-navy/40 focus:outline-none"
```

`src/lib/components/DisplayNameClaim.svelte`, the name input — `text-xs` becomes `text-base`, and the field widens from `w-36` so 16px text still fits:

```svelte
class="w-44 rounded-md border border-mist px-2 py-1 text-base focus:border-navy/50 focus:outline-none"
```

- [ ] **Step 4: Fix the ask panel height**

In `src/routes/ask/+layout.svelte`, the panel subtracts 11rem for the surrounding chrome. The real total is the 4rem nav, the 4.5rem footer, and the container's own `py-6`, which is 3rem — 11.5rem:

```svelte
class="flex h-[calc(100dvh-11.5rem)] w-full flex-col overflow-hidden rounded-xl border border-mist bg-white shadow-sm"
```

If the test still reports a few pixels of scroll, adjust this constant until it passes rather than adding `overflow-hidden` to the body. The test is the arbiter; the arithmetic above is the starting point.

- [ ] **Step 5: Fix the hero height and the search dialog**

`src/routes/+page.svelte` — `100vh` resolves against the large viewport on mobile, so the hero overflows while the URL bar shows. `dvh` tracks the visible viewport:

```svelte
class="relative mx-auto flex min-h-[calc(100dvh-4rem-4.5rem)] max-w-6xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6"
```

`src/lib/components/SearchDialog.svelte` — the panel starts lower and the list is capped against the viewport, so an on-screen keyboard cannot push results out of reach. The content wrapper:

```svelte
class="fixed top-16 left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl bg-white shadow-2xl sm:top-24"
```

The results list:

```svelte
class="max-h-[min(24rem,45dvh)] overflow-y-auto p-2"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: PASS. Watch for a knock-on failure in the tap-target sweep: the wider `DisplayNameClaim` input could push `/me`'s timed-best card wider at 320px. If the overflow invariant trips there, reduce the input to `w-40`.

- [ ] **Step 7: Run the full gate**

```bash
npm run check && npm run test && npx prettier --check .
```

Also run the specs that touch these components directly:

```bash
npx playwright test e2e/ai.spec.ts e2e/leaderboard.spec.ts --reporter=line
```

Expected: PASS. `leaderboard.spec.ts` drives `DisplayNameClaim`, and `ai.spec.ts` drives the composer.

- [ ] **Step 8: Commit**

```bash
git add e2e/mobile.spec.ts src/routes src/lib/components/DisplayNameClaim.svelte src/lib/components/SearchDialog.svelte
git commit -m "$(cat <<'EOF'
fix: stop iOS zooming on focus and sizing against the wrong viewport

Raises the ask composer and the display-name field to 16px. iOS Safari
zooms the page whenever focus enters a smaller input.

Switches the landing hero from vh to dvh, since vh resolves against the
large viewport and left the hero taller than the visible area while the URL
bar showed. Corrects the ask panel's chrome allowance to 11.5rem so the
page no longer scrolls behind it, and caps the search result list against
the viewport so an on-screen keyboard cannot hide the lower hits.

The zoom and URL-bar behaviours cannot be observed in Chromium, so the new
tests assert their causes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Touch affordances

The two hover-revealed controls. The rule bookmark button was measured at `opacity: 0`, 16×16 on a touch device: invisible, and reachable only by a tap that lands on it blind.

**Files:**

- Modify: `src/lib/components/rules/RuleNode.svelte`
- Modify: `src/lib/components/chat/ConversationSidebar.svelte`
- Modify: `e2e/mobile.spec.ts`

**Interfaces:**

- Consumes: `signUpTestUser`, `d1`, `d1Select` from `./helpers`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `e2e/mobile.spec.ts`. Bookmarks only render when signed in, and the conversation list needs a seeded row, since creating one for real would call Gemini.

```ts
import { d1, d1Select } from './helpers';

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
		await button.tap();
		await expect(page.locator('button[aria-pressed="true"][aria-label*="rule"]')).toHaveCount(1);
	});

	test('a conversation can be deleted on a touch device', async ({ page }) => {
		const { email } = await signUpTestUser(page, 'mobile-del');
		d1(`DELETE FROM ai_conversations WHERE id LIKE 'mobiledel-%'`);
		const userId = (d1Select(`SELECT id FROM user WHERE email = '${email}'`)[0] as { id: string }).id;
		const now = Date.now();
		d1(
			`INSERT INTO ai_conversations (id, user_id, ruleset_id, title, created_at, updated_at, deleted_at) VALUES ('mobiledel-1', '${userId}', '${RULESET}', 'Seeded mobile convo', ${now}, ${now}, NULL)`
		);

		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /chats/i }).click();

		const del = page.locator('button[aria-label^="Delete conversation"]').first();
		await expect(del).toBeVisible();
		await expect(del).toHaveCSS('opacity', '1');
		await del.tap();
		await expect(page.getByText('Seeded mobile convo')).toHaveCount(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: both fail on `toHaveCSS('opacity', '1')`, receiving `"0"`.

- [ ] **Step 3: Reveal the bookmark button on coarse pointers**

Tailwind 4.3 compiles `pointer-coarse:` to `@media (pointer: coarse)` (verified against the installed version), and Playwright's `isMobile` context matches that query while a desktop context does not. So the variant both fixes the bug and is testable.

In `src/lib/components/rules/RuleNode.svelte`, the button keeps its hover behaviour on a mouse and is always visible on touch, at a 44px target:

```svelte
<button
	type="button"
	aria-pressed={marked}
	aria-label="{marked ? 'Remove bookmark for' : 'Bookmark'} rule {node.id}"
	onclick={() => bookmarks.toggle(rulesetId, node.id)}
	class="flex h-11 w-11 shrink-0 items-center justify-center self-center transition-opacity pointer-coarse:opacity-100 {marked
		? 'text-cardinal opacity-100'
		: 'text-navy/30 opacity-0 group-hover:opacity-100 hover:text-cardinal focus-visible:opacity-100'}"
>
```

- [ ] **Step 4: Reveal the conversation delete button on coarse pointers**

`src/lib/components/chat/ConversationSidebar.svelte` needs three coordinated changes, or the button appears on top of the conversation title with no backdrop.

The delete button itself:

```svelte
class="group/del absolute top-1/2 right-2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded text-navy opacity-0 transition-opacity duration-200 group-hover:opacity-100 pointer-coarse:opacity-100 focus:opacity-100 hover:text-cardinal"
```

The gradient wipe that gives the icon a backdrop, so it is present on touch too:

```svelte
class="pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100 pointer-coarse:opacity-100"
```

The conversation link needs right padding on touch so its title does not run under the always-visible button:

```svelte
class="block rounded-lg px-3 py-2 text-sm text-navy hover:bg-navy/5 pointer-coarse:pr-14 {convo.id ===
activeId
	? 'bg-navy/10 font-semibold'
	: ''}"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: PASS.

If the delete test taps but the row stays, the gradient overlay may be intercepting. It carries `pointer-events-none`; confirm that class survived the edit.

- [ ] **Step 6: Confirm the desktop behaviour is unchanged**

The point of `pointer-coarse:` is that a mouse still gets the hover reveal. Verify by hand:

```bash
npm run dev
```

Open `http://localhost:5173/rules/usau-official-2026-27/15` in a desktop browser signed out, then signed in. The bookmark icon must stay hidden until you hover a rule row. Stop the server when done.

- [ ] **Step 7: Run the full gate**

```bash
npm run check && npm run test && npx prettier --check .
npx playwright test e2e/bookmarks.spec.ts e2e/ai.spec.ts --reporter=line
```

Expected: all pass. `bookmarks.spec.ts` drives the same button on a desktop viewport.

- [ ] **Step 8: Commit**

```bash
git add e2e/mobile.spec.ts src/lib/components/rules/RuleNode.svelte src/lib/components/chat/ConversationSidebar.svelte
git commit -m "$(cat <<'EOF'
fix: make hover-revealed controls reachable on touch

The rule bookmark button rendered at opacity 0 and 16x16 on a phone, so
bookmarking was reachable only by a blind tap. The conversation delete
button used the same pattern. Both now show on coarse pointers at a 44px
target and keep the hover reveal on a mouse.

The sidebar's gradient backdrop follows the button so the icon still has
something to sit on, and the conversation title gains right padding on
touch so it does not run underneath.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: The /admin/ai table

The audit never exercised this table: local D1 had no conversations, so the page rendered its empty state. Five columns with no truncation is a strong candidate for overflow, but that is a prediction. Measure first.

**Files:**

- Modify: `e2e/mobile.spec.ts`
- Modify: `src/routes/admin/ai/+page.svelte` (only if the measurement shows it is needed)

**Interfaces:**

- Consumes: `signInAsAdmin`, `d1`, `d1Select` from `./helpers`; `sweep` and `RULESET` from this spec file.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `e2e/mobile.spec.ts`. Seed a row whose title and email are long enough to be realistic worst cases.

```ts
test.describe('admin conversation table @320px', () => {
	test.use({ viewport: { width: 320, height: 667 }, hasTouch: true, isMobile: true });

	test('the conversation table holds every invariant with real rows', async ({ page }) => {
		await signInAsAdmin(page);
		d1(`DELETE FROM ai_messages WHERE id LIKE 'mobtable-%'`);
		d1(`DELETE FROM ai_conversations WHERE id LIKE 'mobtable-%'`);
		const userId = (
			d1Select(`SELECT id FROM user WHERE email = 'admin@example.test'`)[0] as { id: string }
		).id;
		const now = Date.now();
		d1(
			`INSERT INTO ai_conversations (id, user_id, ruleset_id, title, created_at, updated_at, deleted_at) VALUES ('mobtable-1', '${userId}', '${RULESET}', 'What happens when the thrower fumbles the disc after a contested stall count in the end zone', ${now}, ${now}, NULL)`
		);
		d1(
			`INSERT INTO ai_messages (id, conversation_id, role, content, status, model, feedback, created_at) VALUES ('mobtable-1-u', 'mobtable-1', 'user', 'seeded', NULL, NULL, NULL, ${now})`
		);

		const violations = await sweep(page, '/admin/ai', 320, 'body');
		expect(formatViolations(onlyKinds(violations, ['tap-target', 'overflow', 'covered']))).toBe(
			'no violations'
		);
	});
});
```

- [ ] **Step 2: Run the test and record what it reports**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line -g "conversation table"`

Two outcomes, and both are valid results:

- **It passes.** The table already handles a long title at 320px. Skip step 3 and note this in the commit message. The prediction was wrong, which is worth recording.
- **It fails with an overflow violation.** Continue to step 3.

- [ ] **Step 3: Fix the table, only if step 2 failed**

Apply the same approach `app.css` already uses for wide rule tables: let the table scroll inside its own box rather than pushing the page wide, and truncate the two free-text columns.

In `src/routes/admin/ai/+page.svelte`, wrap the `<table>`:

```svelte
<div class="overflow-x-auto">
	<table class="w-full min-w-[36rem] table-fixed text-sm"></table>
</div>
```

Give the title and user cells a truncating box. `max-w-0` with `table-fixed` is the same technique the leaderboard uses for its player column:

```svelte
<td class="max-w-0 truncate py-2">
<td class="max-w-0 truncate text-navy/70">
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test e2e/mobile.spec.ts --reporter=line`

Expected: PASS, the whole file.

- [ ] **Step 5: Run the full gate**

```bash
npm run check && npm run test && npx prettier --check .
npx playwright test e2e/admin.spec.ts --reporter=line
```

- [ ] **Step 6: Commit**

Pick the message that matches what step 2 found.

If the table needed fixing:

```bash
git add e2e/mobile.spec.ts "src/routes/admin/ai/+page.svelte"
git commit -m "$(cat <<'EOF'
fix: keep the admin conversation table inside the viewport

The audit never reached this table — local D1 had no conversations, so the
page rendered its empty state. Seeding a realistic long title shows it
pushes the page wide at 320px. The table now scrolls in its own box and
truncates the title and user columns, matching how rule tables already
behave.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

If it did not:

```bash
git add e2e/mobile.spec.ts
git commit -m "$(cat <<'EOF'
test: cover the admin conversation table with real rows

The audit never reached this table — local D1 had no conversations, so the
page rendered its empty state, and the spec recorded it as unverified. With
a realistic long title seeded it holds every invariant at 320px, so no
change was needed. The test keeps it that way.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Close out the sweep

Confirms nothing was missed, records the outcome, and checks what the new tests cost CI.

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-04-mobile-compatibility-sweep-design.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Run the whole e2e suite and time it**

```bash
time npx playwright test --reporter=line
```

Expected: PASS. Record the wall-clock figure — the suite is single-worker, and the sweep adds roughly 50 page loads.

If the mobile spec alone takes more than about two minutes, drop 768 from `VIEWPORTS`. It is the least valuable of the three: it is a tablet width where the desktop layout has already taken over on most routes. Note the change in the commit.

- [ ] **Step 2: Confirm no route was missed**

Compare the route lists in `e2e/mobile.spec.ts` against the app's routes:

```bash
find src/routes -name "+page.svelte" | sort
```

Every route with a UI should appear in `PUBLIC_ROUTES`, `SIGNED_IN_ROUTES`, or `ADMIN_ROUTES`, except `/admin/ai/[id]`, which Task 8's seeded row now makes reachable. Add it to `ADMIN_ROUTES` if it is absent, run the sweep, and fix anything it reports.

- [ ] **Step 3: Record the outcome in the spec**

The spec listed one item as unverified and three as unmeasurable. Append a short "Outcome" section to `docs/superpowers/specs/2026-08-04-mobile-compatibility-sweep-design.md` stating what Task 8 found about the `/admin/ai` table, and confirming the three unmeasurable fixes shipped without test coverage. Do not rewrite the earlier sections; the audit record stands as it was measured.

- [ ] **Step 4: Document the harness in the README**

The README's testing coverage is a single table row. Add a short paragraph under the testing section explaining that `e2e/mobile.spec.ts` sweeps every route at three widths for overflow, tap-target size, and covered content, and that the two size exemptions live in `e2e/mobile-audit.ts`. A contributor whose change trips the sweep needs to know where the rule lives.

- [ ] **Step 5: Run the full gate**

```bash
npm run check && npm run test && npm run check:e2e && npx prettier --check .
```

- [ ] **Step 6: Commit**

```bash
git add README.md docs/superpowers/specs/2026-08-04-mobile-compatibility-sweep-design.md e2e/mobile.spec.ts
git commit -m "$(cat <<'EOF'
docs: record the mobile sweep outcome

Notes what the admin conversation table measurement found, and which three
fixes shipped without test coverage because Chromium simulates neither a
retracting URL bar nor an on-screen keyboard.

Documents the sweep in the README so a contributor who trips it knows where
the size exemptions are defined.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage.** Every confirmed defect maps to a task: bookmark visibility (7), `/admin` overflow (4), timed-run overlap (5), 14px textarea (6), TOC pill coverage (5), `/ask` body scroll (6), tap targets (2, 3, 4). The three unmeasurable items are in Task 6. The unverified `/admin/ai` table is Task 8. The harness and its two exemptions are Tasks 1 and 2. The spec's "no visual redesign" constraint is carried by Task 2's single-row header test.

**Placeholders.** None. Task 8 branches on a measurement rather than deferring a decision, and both branches are written out.

**Type consistency.** `AuditConfig`, `RawAudit`, and `Violation` are defined once in Task 1 and consumed unchanged. `auditInPage`, `toViolations`, and `formatViolations` keep their signatures throughout. `sweep(page, route, width, targetScope)` is defined in Task 2 and called with the same four arguments in Tasks 3, 4, and 8. `targetScope` moves `'header'` → `'body'` between Tasks 2 and 3 and stays there.

**Known risk.** Task 2's header change and Task 6's wider display-name input both risk knock-on layout effects at 320px. Both steps say what to do if the sweep trips.
