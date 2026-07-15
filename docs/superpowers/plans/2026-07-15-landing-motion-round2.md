# Landing Motion Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the nav auth layout shift, make grid pulses spawn on random gridlines and ride them through the background drift, add entrance motion to `/rules` and `/ask`, and rebuild the disc flight as a comet trail with a pulse-ring launch and favicon-derived disc art — per `docs/superpowers/specs/2026-07-15-landing-motion-round2-design.md`.

**Architecture:** Motion stays CSS keyframes + SMIL. New JS is orchestration only: a `GridPulses` Svelte component spawns pulses on randomly chosen gridlines inside a drift layer phase-locked to the background via a shared `--drift-sync-delay` CSS variable, and `Nav.svelte` gains a three-state auth view backed by a localStorage hint.

**Tech Stack:** SvelteKit (Svelte 5 runes), Tailwind CSS v4, SMIL, Vitest for the one pure helper, Playwright CLI for visual verification.

## Global Constraints

- **No new dependencies.**
- **Tailwind v4 syntax** in `src/app.css` (`@utility`, `@layer`), tabs for indentation, match existing comment style.
- **Reduced motion:** every CSS animation added stays inside `@media (prefers-reduced-motion: no-preference)`; the decor SVG is hidden entirely under `prefers-reduced-motion: reduce` (rule already exists as `.disc-flight { display: none }` — the class moves to the `<svg>` element); `GridPulses` never spawns and never sets the sync variable when `matchMedia('(prefers-reduced-motion: reduce)')` matches. Reduced-motion users get a clean static hero: no disc, no trail, no rings, no pulses, no drift phase reset.
- **Grid tile constant is 96px**; the drift period is **40s**; both the background drift and the pulse drift layer must use `animation-delay: var(--drift-sync-delay, 0ms)`.
- **SMIL begin lists:** cross-element `X.begin` syncbase references never fire in Chromium; `X.end` references do. Every SMIL animation synced to the flight uses a literal begin list in lockstep with `disc-flight-anim`'s own `begin="2.3s; disc-flight-anim.end + 15.5s"` (offset where the design says so). One comment in the SVG covers the whole group.
- **Visual work regimen:** each task's gate is `npm run check` + `npm run lint` green plus Playwright screenshots you actually Read (they are PNGs — use the Read tool). `npm run format` before committing if lint complains; the repo has pre-existing prettier drift in `src/routes/rules/+page.svelte` — Task 3 modifies that file, so Task 3 (and only Task 3) commits its formatting; other tasks must not touch unrelated files.
- Dev server: `npm run dev` on `http://localhost:5173` — background it, kill with `lsof -ti:5173 | xargs kill` when done. Screenshots go to your scratchpad/temp directory, never the repo.

---

### Task 1: Nav auth-state stability

**Files:**
- Modify: `src/lib/components/Nav.svelte:15-36` (script) and `:79-140` (auth section of template)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks. localStorage key `bp-auth-hint` (`'1'` signed in, `'0'` signed out).

- [ ] **Step 1: Replace the auth state in the script block**

Replace lines 15-35 (the `SessionUser` type through the end of `onMount`) with:

```svelte
	type SessionUser = { name: string; email: string; image?: string | null };
	type AuthView = 'pending' | 'signedIn' | 'signedOut';
	const AUTH_HINT_KEY = 'bp-auth-hint';

	let user = $state<SessionUser | null>(null);
	let view = $state<AuthView>('pending');

	onMount(() => {
		// localStorage hint renders the likely final state before the session
		// resolves; onMount runs pre-paint, so the correction is never visible
		if (localStorage.getItem(AUTH_HINT_KEY) === '0') view = 'signedOut';
		const store = authClient.useSession();
		return store.subscribe((s) => {
			if (s.isPending) return;
			user = s.data?.user ?? null;
			view = user ? 'signedIn' : 'signedOut';
			localStorage.setItem(AUTH_HINT_KEY, user ? '1' : '0');
		});
	});
```

Why `view` starts `'pending'` and is corrected in `onMount` rather than initialized from localStorage: SSR has no storage, and diverging from server markup during hydration causes mismatches; `onMount` runs before the browser paints, so hint `'0'` users still see the Sign in button on first paint with no placeholder flash.

- [ ] **Step 2: Replace the auth section of the template**

The template currently switches on `{#if user}` (line 79). Replace that whole block — from `{#if user}` through the closing `{/if}` after the sign-in button (line 140) — with a three-way switch. The DropdownMenu block and the sign-in button are IDENTICAL to what is there now; only the `{#if}`/`{:else if}` scaffolding and the new placeholder are new:

```svelte
				{#if view === 'pending'}
					<div aria-hidden="true" class="h-8 w-8 rounded-full border border-white/15"></div>
				{:else if view === 'signedIn' && user}
					<DropdownMenu.Root>
						<!-- ... existing DropdownMenu block from the current file, unchanged ... -->
					</DropdownMenu.Root>
				{:else}
					<!-- ... existing sign-in <button> from the current file, unchanged ... -->
				{/if}
```

(Copy the existing DropdownMenu and button markup verbatim from the current file — the comments above stand in for them here only to keep this plan readable; the shipped file must contain the real markup, not comments.)

- [ ] **Step 3: Verify checks pass**

Run: `npm run check && npm run lint`
Expected: 0 errors; formatted.

- [ ] **Step 4: Verify shift behavior in a real browser**

With the dev server running, write this to `<scratchpad>/nav-shift-check.mjs` and run `node <scratchpad>/nav-shift-check.mjs`:

```js
import { chromium } from '@playwright/test';

const b = await chromium.launch();

// hint '0' (returning signed-out visitor): button renders immediately, no shift
const ctx1 = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx1.addInitScript(() => localStorage.setItem('bp-auth-hint', '0'));
const p1 = await ctx1.newPage();
await p1.goto('http://localhost:5173/');
const early = await p1.locator('nav a[href="/quiz"]').boundingBox();
await p1.waitForTimeout(2500);
const late = await p1.locator('nav a[href="/quiz"]').boundingBox();
console.log('hint=0 quiz-link x early/late:', early.x, late.x, Math.abs(early.x - late.x) < 1 ? 'STABLE' : 'SHIFTED');

// hint '1' (returning signed-in visitor): 32px placeholder circle until resolve
const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx2.addInitScript(() => localStorage.setItem('bp-auth-hint', '1'));
const p2 = await ctx2.newPage();
await p2.goto('http://localhost:5173/');
const ph = await p2.locator('nav div[aria-hidden="true"].rounded-full').boundingBox();
console.log('hint=1 placeholder:', ph ? `${ph.width}x${ph.height}` : 'MISSING (session resolved to signed-out already — rerun with network throttling if so)');
await b.close();
```

Expected: `hint=0 ... STABLE` and `hint=1 placeholder: 32x32` (the second may print MISSING if the session endpoint resolves before the check — the STABLE line is the load-bearing assertion; re-run once if needed).

- [ ] **Step 5: Run the auth e2e spec**

Run: `npx playwright test e2e/auth.spec.ts`
Expected: pass (covers signed-in nav rendering via test sign-in).

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/Nav.svelte
git commit -m "fix: eliminate nav auth-state layout shift with pending view and localStorage hint"
```

---

### Task 2: Gridline-riding random pulses

**Files:**
- Create: `src/lib/grid-pulse-lines.ts`
- Create: `src/lib/grid-pulse-lines.test.ts`
- Create: `src/lib/components/GridPulses.svelte`
- Modify: `src/app.css` (pulse keyframes + drift layer + sync var)
- Modify: `src/routes/+page.svelte:8-13` (replace static pulse divs)

**Interfaces:**
- Consumes: `.grid-pulse` / `.grid-pulse-x` / `.grid-pulse-y` visual styles (existing).
- Produces: `gridLineOffsets(pageOffset: number, spanLength: number, tile: number): number[]`; `<GridPulses />` component (no props); CSS var `--drift-sync-delay` set on `document.documentElement`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/grid-pulse-lines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gridLineOffsets } from './grid-pulse-lines';

describe('gridLineOffsets', () => {
	it('returns offsets that are gridline positions in page space', () => {
		const offsets = gridLineOffsets(64, 800, 96);
		expect(offsets.length).toBeGreaterThan(0);
		for (const offset of offsets) {
			expect((offset + 64) % 96).toBe(0);
		}
	});

	it('keeps offsets within the span with a half-tile margin', () => {
		const offsets = gridLineOffsets(64, 800, 96);
		for (const offset of offsets) {
			expect(offset).toBeGreaterThanOrEqual(48);
			expect(offset).toBeLessThanOrEqual(800 - 48);
		}
	});

	it('returns an empty list when the span is smaller than one tile', () => {
		expect(gridLineOffsets(0, 90, 96)).toEqual([]);
	});

	it('handles a container aligned exactly on a gridline', () => {
		expect(gridLineOffsets(96, 384, 96)).toEqual([96, 192, 288]);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/grid-pulse-lines.test.ts`
Expected: FAIL — cannot resolve `./grid-pulse-lines`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/grid-pulse-lines.ts`:

```ts
/**
 * Offsets (relative to a container) of the page-space gridlines — multiples
 * of `tile` — that fall inside a container starting at `pageOffset` and
 * spanning `spanLength`. Lines within half a tile of either edge are
 * excluded so pulses never hug the container boundary.
 */
export function gridLineOffsets(pageOffset: number, spanLength: number, tile: number): number[] {
	const margin = tile / 2;
	const first = Math.ceil((pageOffset + margin) / tile);
	const last = Math.floor((pageOffset + spanLength - margin) / tile);
	const offsets: number[] = [];
	for (let k = first; k <= last; k++) offsets.push(k * tile - pageOffset);
	return offsets;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/grid-pulse-lines.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Rework the pulse CSS in `src/app.css`**

Three changes, all in the landing-motion block added by round 1:

**(a)** In the `field-lines-live` utility, add the sync delay line:

```css
@utility field-lines-live {
	@media (prefers-reduced-motion: no-preference) {
		animation: grid-drift 40s linear infinite;
		animation-delay: var(--drift-sync-delay, 0ms);
	}
}
```

**(b)** Inside the `@layer components` block, replace the pulse animation wiring (the `@media (prefers-reduced-motion: no-preference)` block that currently sets `animation: pulse-x 14s linear infinite` with `--pulse-delay`) with single-run animations plus the drift layer. Keep the `.grid-pulse`, `.grid-pulse-x`, `.grid-pulse-y` base-style rules (position/size/gradient) exactly as they are:

```css
	@media (prefers-reduced-motion: no-preference) {
		.grid-pulse-x {
			animation: pulse-x 5s linear;
		}
		.grid-pulse-y {
			animation: pulse-y 5s linear;
		}
	}

	/* rides the same 40s diagonal as the background grid, phase-locked via --drift-sync-delay */
	.grid-drift-layer {
		@media (prefers-reduced-motion: no-preference) {
			animation: grid-drift-translate 40s linear infinite;
			animation-delay: var(--drift-sync-delay, 0ms);
		}
	}
```

**(c)** Replace the `pulse-x` / `pulse-y` keyframes (currently 14s loops with long idle) with single-run shapes, and add the drift-translate keyframes:

```css
@keyframes pulse-x {
	0% {
		transform: translateX(-10rem);
		opacity: 0;
	}
	8% {
		opacity: 1;
	}
	85% {
		opacity: 1;
	}
	100% {
		transform: translateX(100vw);
		opacity: 0;
	}
}

@keyframes pulse-y {
	0% {
		transform: translateY(-10rem);
		opacity: 0;
	}
	8% {
		opacity: 1;
	}
	85% {
		opacity: 1;
	}
	100% {
		transform: translateY(100vh);
		opacity: 0;
	}
}

@keyframes grid-drift-translate {
	from {
		transform: translate(0, 0);
	}
	to {
		transform: translate(96px, 96px);
	}
}
```

The `--pulse-delay` custom property is no longer referenced anywhere — remove its remnants.

- [ ] **Step 6: Create `src/lib/components/GridPulses.svelte`**

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { gridLineOffsets } from '$lib/grid-pulse-lines';

	const TILE = 96;
	const DRIFT_PERIOD_MS = 40_000;
	const MAX_CONCURRENT = 3;

	type Pulse = { id: number; axis: 'x' | 'y'; offset: number };

	let container: HTMLDivElement;
	let pulses = $state<Pulse[]>([]);
	let nextId = 0;

	function spawn() {
		if (pulses.length >= MAX_CONCURRENT) return;
		const rect = container.getBoundingClientRect();
		const axis: 'x' | 'y' = Math.random() < 0.5 ? 'x' : 'y';
		const offsets =
			axis === 'x'
				? gridLineOffsets(rect.top + window.scrollY, rect.height, TILE)
				: gridLineOffsets(rect.left + window.scrollX, rect.width, TILE);
		if (offsets.length === 0) return;
		const offset = offsets[Math.floor(Math.random() * offsets.length)];
		pulses = [...pulses, { id: nextId++, axis, offset }];
	}

	function remove(id: number) {
		pulses = pulses.filter((p) => p.id !== id);
	}

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		// phase-lock the background grid drift and this component's drift layer
		document.documentElement.style.setProperty(
			'--drift-sync-delay',
			`${-(performance.now() % DRIFT_PERIOD_MS)}ms`
		);
		let timer: ReturnType<typeof setTimeout>;
		const schedule = (delay: number) => {
			timer = setTimeout(() => {
				spawn();
				schedule(5000 + Math.random() * 4000);
			}, delay);
		};
		schedule(1500);
		return () => clearTimeout(timer);
	});
</script>

<div
	bind:this={container}
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 overflow-hidden"
>
	<div class="grid-drift-layer absolute inset-0">
		{#each pulses as pulse (pulse.id)}
			{#if pulse.axis === 'x'}
				<div
					class="grid-pulse grid-pulse-x"
					style="top: {pulse.offset}px"
					onanimationend={() => remove(pulse.id)}
				></div>
			{:else}
				<div
					class="grid-pulse grid-pulse-y"
					style="left: {pulse.offset}px"
					onanimationend={() => remove(pulse.id)}
				></div>
			{/if}
		{/each}
	</div>
</div>
```

Why the geometry works: the background grid's lines sit at page-space multiples of 96px, shifted by the drift `d(t)`. A pulse at layer-offset `96·k − containerPageOffset` sits at page position `96·k + d(t)` because the drift layer translates by exactly `d(t)` (same keyframe vector, same duration, same shared negative delay). So the pulse stays on its line for the whole flight.

- [ ] **Step 7: Swap the component into the landing page**

In `src/routes/+page.svelte`: add the import to the script block:

```svelte
	import GridPulses from '$lib/components/GridPulses.svelte';
```

and replace the static pulse block (the `<div aria-hidden="true" class="pointer-events-none absolute inset-0">` containing the three `grid-pulse` divs) with:

```svelte
	<!-- decorative light pulses along the field grid -->
	<GridPulses />
```

- [ ] **Step 8: Verify checks + full unit suite**

Run: `npm run test && npm run check && npm run lint`
Expected: 173 unit tests pass (169 + 4 new), 0 check errors, lint clean apart from pre-existing drift.

- [ ] **Step 9: Visual verification — pulse alignment**

Dev server running. Write `<scratchpad>/pulse-crop.mjs`:

```js
import { chromium } from '@playwright/test';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5173/');
// first pulse spawns at ~1.5s and travels 5s; sample twice mid-flight
await p.waitForTimeout(3500);
await p.screenshot({ path: process.argv[2] + '/pulse-a.png' });
await p.waitForTimeout(2000);
await p.screenshot({ path: process.argv[2] + '/pulse-b.png' });
const box = await p.locator('.grid-pulse').first().boundingBox().catch(() => null);
if (box) {
	await p.screenshot({
		path: process.argv[2] + '/pulse-zoom.png',
		clip: {
			x: Math.max(0, box.x - 60),
			y: Math.max(0, box.y - 60),
			width: Math.min(320, 1440 - box.x + 60),
			height: 220
		}
	});
	console.log('pulse at', box.x, box.y);
} else {
	console.log('no pulse visible at sample time — rerun');
}
await b.close();
```

Run: `node <scratchpad>/pulse-crop.mjs <scratchpad>` (rerun if it samples between pulses). Read the PNGs — the zoom crop must show the streak lying ON a grid line (brightening it), not floating in a gap between lines. If it's offset, debug the sync (most likely: `--drift-sync-delay` not applied to one of the two animations) before proceeding.

- [ ] **Step 10: Commit**

```bash
git add src/lib/grid-pulse-lines.ts src/lib/grid-pulse-lines.test.ts src/lib/components/GridPulses.svelte src/app.css src/routes/+page.svelte
git commit -m "feat: spawn grid pulses on random gridlines riding the background drift"
```

---

### Task 3: `/rules` and `/ask` entrance motion

**Files:**
- Modify: `src/routes/rules/+page.svelte:8-46` (template only)
- Modify: `src/routes/ask/+page.svelte:133` (section class only)

**Interfaces:**
- Consumes: `animate-fade-up` + `--stagger` (existing utility from round 1).

- [ ] **Step 1: Add stagger to `src/routes/rules/+page.svelte`**

Replace the template (from `<div class="mx-auto...` to the closing `</div>`) with:

```svelte
<div class="mx-auto max-w-6xl px-4 py-12 sm:px-6">
	<p class="animate-fade-up text-xs font-semibold tracking-[0.18em] text-white/50 uppercase">
		Explore
	</p>
	<h1 class="display animate-fade-up mt-2 text-4xl text-white sm:text-5xl" style="--stagger: 1">
		Rule<span class="text-cardinal">books</span>
	</h1>
	<p class="animate-fade-up mt-3 max-w-xl text-sm text-white/60" style="--stagger: 2">
		Pick a ruleset to browse its full table of contents.
	</p>

	<div class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
		{#each data.rulesets as ruleset, i (ruleset.id)}
			{@const ruleCount = ruleset.sections.reduce((sum, s) => sum + s.ruleCount, 0)}
			<a
				href="/rules/{ruleset.id}"
				class="group animate-fade-up relative block card card-link p-6 pr-14"
				style="--stagger: {3 + i}"
			>
				<Chip label={ruleset.edition} tone="dark" />
				<h2 class="display mt-4 text-2xl text-navy">{ruleset.shortTitle}</h2>
				<p class="mt-2 text-sm text-navy/60">
					{ruleset.sections.length} sections · {ruleCount} rules
				</p>
				<span
					class="absolute top-6 right-6 flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-0.5"
					aria-hidden="true"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.4"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg
					>
				</span>
			</a>
		{/each}
	</div>
</div>
```

This file has pre-existing prettier drift — run `npm run format` on it and commit whatever prettier settles on for this file (this is the one task allowed to absorb that drift, since it's modifying the file anyway).

- [ ] **Step 2: Add the fade to `src/routes/ask/+page.svelte`**

Change line 133 from:

```svelte
<section class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
```

to:

```svelte
<section class="animate-fade-up mx-auto max-w-3xl px-4 py-10 sm:px-6">
```

Nothing else in the file changes — the fade sits on the section wrapper precisely so the session-resolve swap inside it (skeleton → card/form) does not re-animate.

- [ ] **Step 3: Verify checks pass**

Run: `npm run check && npm run lint`
Expected: 0 errors; lint now fully clean (the rules-page drift is absorbed here).

- [ ] **Step 4: Visual verification**

```bash
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2500 http://localhost:5173/rules <scratchpad>/t3-rules.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2500 http://localhost:5173/ask <scratchpad>/t3-ask.png
```

Read both: `/rules` identical to before (header + ruleset cards fully visible at 2.5s); `/ask` shows the sign-in card (or skeleton) fully visible, section not mid-animation.

- [ ] **Step 5: Commit**

```bash
git add src/routes/rules/+page.svelte src/routes/ask/+page.svelte
git commit -m "feat: add entrance motion to rules index and ask page"
```

---

### Task 4: Disc flight redesign — comet trail, pulse-ring launch, layered disc

**Files:**
- Modify: `src/routes/+page.svelte` (the decor `<svg>` block)
- Modify: `src/app.css` (remove `.arc-mask`/`arc-draw`; add `.disc-body` wobble; retarget the reduce-hide rule)

**Interfaces:**
- Consumes: `.disc-flight` reduce-hide rule (retargeted in this task); flight path `d` and 18s schedule (kept).
- Produces: nothing consumed later.

- [ ] **Step 1: Replace the decor SVG in `src/routes/+page.svelte`**

Replace the entire `<svg ...>...</svg>` block (currently the mask/dashed-arc/ellipse version) with:

```svelte
	<!-- disc flight: launch rings, comet trail, layered disc (art derived from static/icons/frisbee-favicon.svg) -->
	<!--
		SMIL choreography: Chromium never fires cross-element `X.begin` syncbase
		references, but `X.end` works. Every literal begin list below must stay in
		lockstep with disc-flight-anim's own "2.3s; disc-flight-anim.end + 15.5s"
		(the second launch ring is offset +0.15s by design).
	-->
	<svg
		aria-hidden="true"
		class="disc-flight pointer-events-none absolute top-1/2 left-1/2 w-[min(56rem,92vw)] -translate-x-1/2 -translate-y-1/2"
		viewBox="0 0 800 400"
		fill="none"
	>
		<defs>
			<path id="disc-path" d="M 40 340 C 240 120, 560 80, 760 200" />
		</defs>

		<!-- launch rings -->
		<circle cx="40" cy="340" r="3" stroke="var(--color-cardinal)" stroke-width="2" opacity="0">
			<animate
				attributeName="r"
				values="3;22"
				dur="0.7s"
				begin="2.3s; disc-flight-anim.end + 15.5s"
			/>
			<animate
				attributeName="opacity"
				values="0.8;0"
				dur="0.7s"
				begin="2.3s; disc-flight-anim.end + 15.5s"
			/>
		</circle>
		<circle cx="40" cy="340" r="3" stroke="var(--color-cardinal)" stroke-width="1.5" opacity="0">
			<animate
				attributeName="r"
				values="3;22"
				dur="0.7s"
				begin="2.45s; disc-flight-anim.end + 15.65s"
			/>
			<animate
				attributeName="opacity"
				values="0.6;0"
				dur="0.7s"
				begin="2.45s; disc-flight-anim.end + 15.65s"
			/>
		</circle>

		<!-- comet trail: faint full path drawn in sync with the disc, fading after landing -->
		<use
			href="#disc-path"
			stroke="white"
			stroke-opacity="0.3"
			stroke-width="2"
			stroke-linecap="round"
			pathLength="1"
			stroke-dasharray="1"
			stroke-dashoffset="1"
			opacity="0"
		>
			<set attributeName="opacity" to="1" begin="2.3s; disc-flight-anim.end + 15.5s" dur="4s" />
			<animate
				attributeName="stroke-dashoffset"
				from="1"
				to="0"
				dur="2.5s"
				begin="2.3s; disc-flight-anim.end + 15.5s"
				calcMode="spline"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
				fill="freeze"
			/>
			<animate
				attributeName="stroke-opacity"
				values="0.3;0"
				dur="1s"
				begin="disc-flight-anim.end + 0.3s"
			/>
		</use>

		<!-- hot tail: short bright segment riding just behind the disc -->
		<use
			href="#disc-path"
			stroke="white"
			stroke-opacity="0.7"
			stroke-width="2.5"
			stroke-linecap="round"
			pathLength="1"
			stroke-dasharray="0.1 0.9"
			stroke-dashoffset="0.1"
			opacity="0"
		>
			<set attributeName="opacity" to="1" begin="2.3s; disc-flight-anim.end + 15.5s" dur="2.5s" />
			<animate
				attributeName="stroke-dashoffset"
				from="0.1"
				to="-0.9"
				dur="2.5s"
				begin="2.3s; disc-flight-anim.end + 15.5s"
				calcMode="spline"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
			/>
			<animate
				attributeName="stroke-opacity"
				values="0.7;0.7;0"
				keyTimes="0;0.85;1"
				dur="2.5s"
				begin="2.3s; disc-flight-anim.end + 15.5s"
			/>
		</use>

		<!-- disc -->
		<g opacity="0">
			<animateMotion
				id="disc-flight-anim"
				dur="2.5s"
				begin="2.3s; disc-flight-anim.end + 15.5s"
				calcMode="spline"
				keyPoints="0;1"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
			>
				<mpath href="#disc-path" />
			</animateMotion>
			<animate
				attributeName="opacity"
				values="0;1;1;0"
				keyTimes="0;0.06;0.9;1"
				dur="2.5s"
				begin="2.3s; disc-flight-anim.end + 15.5s"
			/>
			<g>
				<animateTransform
					attributeName="transform"
					type="scale"
					values="0.3;1"
					dur="0.3s"
					begin="2.3s; disc-flight-anim.end + 15.5s"
					fill="freeze"
				/>
				<g transform="rotate(-12)">
					<g class="disc-body">
						<ellipse cx="0" cy="1.6" rx="12" ry="5" fill="#7d1528" />
						<ellipse cx="0" cy="0" rx="12" ry="5" fill="var(--color-cardinal)" />
						<ellipse cx="0" cy="0" rx="7.5" ry="3" fill="none" stroke="#8f1a30" stroke-width="1.2" />
						<path
							d="M -10 -1.8 A 12 5 0 0 1 10 -1.8"
							fill="none"
							stroke="#f2a9b4"
							stroke-width="1.2"
							stroke-linecap="round"
							opacity="0.75"
						/>
					</g>
				</g>
			</g>
		</g>
	</svg>
```

How the trail arithmetic works (so you can debug, not change, it): with `pathLength="1"`, the main trail's `stroke-dasharray="1"` + dashoffset animating 1→0 reveals the path from the start, and because the dashoffset animation shares the motion's `dur` and `keySplines`, the reveal tip tracks the disc exactly. The hot tail's `stroke-dasharray="0.1 0.9"` shows a 0.1-long segment whose position is `offset`-shifted; animating dashoffset 0.1→−0.9 keeps that segment ending exactly at the disc's current position. `fill="freeze"` on the main-trail dashoffset keeps the trail fully drawn during the 1s post-landing fade; the `<set>` opacity windows make everything invisible between flights.

- [ ] **Step 2: Update `src/app.css`**

**(a)** Delete the `.arc-mask` rules (both the base `stroke-dashoffset: 0` rule and its `no-preference` animation block) and the `arc-draw` keyframes — nothing references them after Step 1.

**(b)** The reduce-hide rule stays exactly as is (`.disc-flight { display: none }` under `prefers-reduced-motion: reduce`) — the class now sits on the `<svg>` element, hiding rings, trail, and disc together.

**(c)** Add the wobble (inside `@layer components`, near the other landing rules):

```css
	/* in-flight disc wobble; base tilt comes from the wrapping rotate(-12) group */
	.disc-body {
		transform-box: fill-box;
		transform-origin: center;
	}
	@media (prefers-reduced-motion: no-preference) {
		.disc-body {
			animation: disc-wobble 1.2s ease-in-out infinite alternate;
		}
	}
```

and the keyframes (top level, with the others):

```css
@keyframes disc-wobble {
	from {
		transform: rotate(-3deg);
	}
	to {
		transform: rotate(3deg);
	}
}
```

`transform-box: fill-box; transform-origin: center` is load-bearing: without it, CSS transforms on SVG elements rotate around the viewBox origin and the disc would orbit instead of wobble.

- [ ] **Step 3: Verify checks pass**

Run: `npm run check && npm run lint`
Expected: 0 errors; formatted.

- [ ] **Step 4: Visual verification — the flight sequence**

Dev server running. The flight starts at 2.3s and lands at 4.8s; the trail fades until ~6.1s:

```bash
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2600 http://localhost:5173/ <scratchpad>/t4-launch.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=3600 http://localhost:5173/ <scratchpad>/t4-midflight.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=5300 http://localhost:5173/ <scratchpad>/t4-fading.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=8000 http://localhost:5173/ <scratchpad>/t4-between.png
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=3600 http://localhost:5173/ <scratchpad>/t4-mobile.png
```

Read all five and confirm:
- `t4-launch.png`: cardinal ring(s) visible around the lower-left release point; disc small/appearing; only a short piece of trail exists.
- `t4-midflight.png`: layered disc (cardinal top, dark underside, gloss) mid-arc; faint trail from the release point to the disc, with a brighter short segment right behind the disc; NO trail ahead of the disc.
- `t4-fading.png`: disc gone; full trail visible but fading.
- `t4-between.png`: hero completely clean — no trail, no rings, no disc.
- `t4-mobile.png`: sequence scales, nothing clipped oddly.

The trail-tip-glued-to-disc check matters most: in `t4-midflight.png`, if the trail extends visibly PAST the disc or lags far behind it, the dashoffset animation's `dur`/`keySplines` no longer match the motion's — fix the mismatch, don't restyle around it. Iterate on ring radius / trail widths only if something looks wrong, keeping the begin lists untouched, and re-screenshot.

- [ ] **Step 5: Reduced-motion verification**

Write `<scratchpad>/reduced-check.mjs`:

```js
import { chromium } from '@playwright/test';

const b = await chromium.launch();
const p = await b.newPage({
	viewport: { width: 1440, height: 900 },
	reducedMotion: 'reduce'
});
await p.goto('http://localhost:5173/');
await p.waitForTimeout(3000);
await p.screenshot({ path: process.argv[2] + '/t4-reduced.png' });
const svgDisplay = await p
	.locator('svg.disc-flight')
	.evaluate((el) => getComputedStyle(el).display);
console.log('decor svg display:', svgDisplay, svgDisplay === 'none' ? 'OK' : 'FAIL');
await b.close();
```

Run `node <scratchpad>/reduced-check.mjs <scratchpad>`, expect `OK`, and Read the PNG: hero fully visible and static, no disc/trail/rings/pulses.

- [ ] **Step 6: Commit**

```bash
git add src/routes/+page.svelte src/app.css
git commit -m "feat: rebuild disc flight with comet trail, pulse-ring launch, and layered disc"
```

---

### Task 5: Full verification sweep

**Files:**
- None expected (fixes only if something fails).

- [ ] **Step 1: Unit tests, type check, lint**

Run: `npm run test && npm run check && npm run lint`
Expected: 173 unit tests pass, 0 check errors, lint fully clean (Task 3 absorbed the rules-page drift).

- [ ] **Step 2: E2E smoke**

Run: `npx playwright test e2e/explorer.spec.ts e2e/quiz.spec.ts e2e/mobile.spec.ts e2e/auth.spec.ts`
Expected: pass. Environment failures get reported verbatim, not "fixed".

- [ ] **Step 3: Final visual pass**

Dev server running; take and Read:

```bash
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=4000 http://localhost:5173/ <scratchpad>/final-landing.png
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=4000 http://localhost:5173/ <scratchpad>/final-mobile.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2500 http://localhost:5173/rules <scratchpad>/final-rules.png
```

Confirm: no regressions, no horizontal overflow on mobile, disc/trail rendering mid-flight on the landing shots, rules page settled.

- [ ] **Step 4: Commit any straggler fixes**

Only if Steps 1–3 required changes:

```bash
git add -A src/
git commit -m "fix: address verification findings for landing motion round 2"
```
