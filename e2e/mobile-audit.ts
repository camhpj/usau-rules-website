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

/**
 * Controls in the site's sticky header — see MIN_TARGET_WIDTH_EXEMPT. Scoped to
 * `#site-header` (set on the `<header>` in Nav.svelte) rather than a bare `header
 * nav`, which also matched the unrelated admin `<header><nav>` and let its pill
 * row pass the width floor for the wrong reason.
 */
export const HEADER_WIDTH_EXEMPT = ['#site-header nav a', '#site-header nav button'];

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
	// The page-level scrollWidth-vs-viewport comparison in toViolations is the gate:
	// content that is genuinely wider than the phone satisfies this invariant by
	// scrolling inside its own container, so it must not reach the offender list at
	// all. An element contained by an ancestor with overflow-x: auto or scroll can
	// scroll within that ancestor without ever widening the document; one with
	// overflow-x: hidden is clipped and never visible past its ancestor either way.
	// Report only root offenders among what remains. A child of an overflowing box
	// overflows too, and listing the whole chain buries the element that actually
	// needs fixing.
	const isClipped = (el: Element): boolean => {
		for (let p = el.parentElement; p; p = p.parentElement) {
			const ox = getComputedStyle(p).overflowX;
			if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
		}
		return false;
	};
	const overflowing = new Set<Element>();
	for (const el of document.querySelectorAll('body *')) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) continue;
		if ((r.right > vw + 1 || r.left < -1) && !isClipped(el)) overflowing.add(el);
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
			reason:
				short && narrow
					? 'too small'
					: short
						? `under ${config.minSize} tall`
						: `under ${minW} wide`
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
	// scrollWidth vs. viewportWidth is the gate: it is what "the page scrolls
	// horizontally" actually means. raw.overflow is the diagnosis, already
	// filtered to non-clipped root offenders in auditInPage, so it names what to
	// fix when the gate trips.
	if (raw.scrollWidth > raw.viewportWidth) {
		if (raw.overflow.length > 0) {
			for (const o of raw.overflow)
				out.push({
					kind: 'overflow',
					route,
					width,
					detail: `${o.el} spans x=${o.left}..${o.right} past the ${raw.viewportWidth}px viewport`
				});
		} else {
			// Every candidate offender was contained by a scroll or clipping
			// ancestor, yet the page still scrolls. Name the page-level numbers
			// rather than pass silently — something is causing this that the
			// per-element scan didn't catch.
			out.push({
				kind: 'overflow',
				route,
				width,
				detail: `document scrollWidth ${raw.scrollWidth} exceeds the ${raw.viewportWidth}px viewport (no offending element identified)`
			});
		}
	}
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
