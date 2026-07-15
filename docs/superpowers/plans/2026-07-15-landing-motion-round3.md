# Landing Motion Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the background grid fully static with more frequent gridline pulses, and rework the disc trail into a finite retracting comet tail that fixes the far-right wrap artifact and the two-stage landing fade — per `docs/superpowers/specs/2026-07-15-landing-motion-round3-design.md`.

**Architecture:** Task 1 is a net deletion: the drift animations and the entire phase-sync apparatus (`--drift-sync-delay`, drift layer) go away, and the pulse spawner just gets faster. Task 2 rewrites the two trail `<use>` elements' dash choreography (period-2.0 patterns, finite 0.35 window, two-phase dashoffset: flight + 0.4s collapse anchored at the landing point).

**Tech Stack:** SvelteKit (Svelte 5 runes), Tailwind CSS v4, SMIL, Playwright CLI for visual verification.

## Global Constraints

- **No new dependencies.**
- **Tailwind v4 syntax** in `src/app.css`, tabs, existing comment style.
- **Reduced motion behavior unchanged:** decor SVG hidden via the existing `.disc-flight { display: none }` reduce rule; `GridPulses` still early-returns before scheduling. All remaining CSS animations stay inside `@media (prefers-reduced-motion: no-preference)`.
- **SMIL begin lists:** cross-element `X.begin` syncbase never fires in Chromium; `X.end` does. Flight-start-synced animations keep literal begin lists in lockstep with `disc-flight-anim`'s `"2.3s; disc-flight-anim.end + 15.5s"`; the new collapse animations may use `begin="disc-flight-anim.end"` directly (an `.end` syncbase — the kind that fires).
- **Dash-period rule (new):** every trail `stroke-dasharray` must have period 2.0 (dash + gap = 2) so wrapped pattern copies land beyond the normalized path length 1 and never render at the far right.
- **Visual work regimen:** each task's gate is `npm run check` + `npm run lint` green plus Playwright screenshots you actually Read (PNGs — use the Read tool). `npm run format` before committing if lint complains; touch no unrelated files.
- Dev server: `npm run dev` on `http://localhost:5173` — background it, kill with `lsof -ti:5173 | xargs kill`. Screenshots/scripts to your scratchpad/temp directory, never the repo.

---

### Task 1: Static grid + faster pulses

**Files:**
- Modify: `src/app.css` (delete drift utilities/keyframes)
- Modify: `src/routes/+layout.svelte:10,42-46` (drop live class + import)
- Modify: `src/lib/components/GridPulses.svelte` (full replacement below)

**Interfaces:**
- Consumes: `gridLineOffsets` helper (unchanged), `.grid-pulse*` styles (unchanged).
- Produces: nothing consumed later. `--drift-sync-delay`, `field-lines-live`, `.grid-drift-layer`, `grid-drift`, `grid-drift-translate` cease to exist — nothing else references them after this task.

- [ ] **Step 1: Delete the drift CSS from `src/app.css`**

Remove these four blocks entirely (they are adjacent to the landing-motion section added in rounds 1–2):

1. The whole `@utility field-lines-live { ... }` block (the one containing `animation: grid-drift 40s linear infinite;` and `animation-delay: var(--drift-sync-delay, 0ms);`).
2. The whole `@keyframes grid-drift { ... }` block.
3. The whole `.grid-drift-layer { ... }` rule (inside `@layer components`), including its `/* rides the same 40s diagonal ... */` comment.
4. The whole `@keyframes grid-drift-translate { ... }` block.

Nothing else in `app.css` changes. Afterwards `grep -n "drift" src/app.css` must return nothing.

- [ ] **Step 2: Drop the live class from `src/routes/+layout.svelte`**

Remove the `class:field-lines-live={page.url.pathname === '/'}` directive from the shell `div` (keeping `class="field-lines flex min-h-screen flex-col bg-navy-deep"` — the element likely collapses back to a single-line tag; let prettier settle it) and remove the now-unused `import { page } from '$app/state';` line. `page` has no other use in this file — verify with a grep before deleting.

- [ ] **Step 3: Replace `src/lib/components/GridPulses.svelte` with:**

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { gridLineOffsets } from '$lib/grid-pulse-lines';

	const TILE = 96;
	const MAX_CONCURRENT = 4;

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
		let timer: ReturnType<typeof setTimeout>;
		const schedule = (delay: number) => {
			timer = setTimeout(() => {
				spawn();
				schedule(2500 + Math.random() * 3000);
			}, delay);
		};
		schedule(800);
		return () => clearTimeout(timer);
	});
</script>

<div
	bind:this={container}
	aria-hidden="true"
	class="pointer-events-none absolute inset-0 overflow-hidden"
>
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
```

(The diffs vs. the current file: `DRIFT_PERIOD_MS` and the `setProperty` call are gone, the drift-layer `div` wrapper is gone, `MAX_CONCURRENT` 3 → 4, schedule `5000 + Math.random() * 4000` → `2500 + Math.random() * 3000`, first spawn 1500 → 800.)

- [ ] **Step 4: Verify checks + unit suite**

Run: `npm run test && npm run check && npm run lint`
Expected: 173 unit tests pass (helper untouched), 0 check errors, lint clean. Also run `grep -rn "drift" src/` — expected: no matches.

- [ ] **Step 5: Visual verification — static grid, aligned + frequent pulses**

Dev server running. Write `<scratchpad>/pulse-check.mjs`:

```js
import { chromium } from '@playwright/test';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5173/');
const counts = [];
for (let i = 0; i < 15; i++) {
	await p.waitForTimeout(1000);
	counts.push(await p.locator('.grid-pulse').count());
}
console.log('pulse counts per second:', counts.join(','));
const box = await p.locator('.grid-pulse').first().boundingBox().catch(() => null);
if (box) {
	await p.screenshot({
		path: process.argv[2] + '/pulse-zoom.png',
		clip: {
			x: Math.max(0, box.x - 60),
			y: Math.max(0, box.y - 60),
			width: 320,
			height: 220
		}
	});
	console.log('pulse at', box.x, box.y);
} else {
	console.log('no pulse at sample time — rerun');
}
await b.close();
```

Run: `node <scratchpad>/pulse-check.mjs <scratchpad>`. Expected: nonzero counts in a clear majority of the 15 samples (spawn every 2.5–5.5s, 5s travel ⇒ pulses visible most of the time, sometimes 2–3 at once). Read `pulse-zoom.png`: streak exactly ON a grid line. Take one more full screenshot 10s apart from the first and Read both to confirm the grid pattern has NOT moved (same line positions relative to the viewport edges — static grid).

- [ ] **Step 6: Commit**

```bash
git add src/app.css src/routes/+layout.svelte src/lib/components/GridPulses.svelte
git commit -m "feat: make grid static and spawn pulses more frequently"
```

---

### Task 2: Retracting comet tail + wrap fix

**Files:**
- Modify: `src/routes/+page.svelte` (the two trail `<use>` elements, the disc opacity keyTimes, and the choreography comment)

**Interfaces:**
- Consumes: existing SMIL skeleton (`disc-flight-anim`, `#disc-path` with `pathLength="1"` on the source path).
- Produces: nothing consumed later.

- [ ] **Step 1: Replace both trail `<use>` blocks**

In `src/routes/+page.svelte`, replace the main-trail `<use>` (currently `stroke-dasharray="1"` with a `<set dur="3.8s">`, a draw animate, and a `stroke-opacity` fade) and its preceding `<!-- comet trail: ... -->` comment with:

```svelte
		<!-- comet tail: finite trail (0.35 of the path) following the disc, then
			 collapsing into the landing point over 0.4s. Dash periods are 2.0 so
			 wrapped pattern copies land beyond the path end instead of rendering
			 at the far right on launch. -->
		<use
			href="#disc-path"
			stroke="white"
			stroke-opacity="0.3"
			stroke-width="2"
			stroke-linecap="round"
			stroke-dasharray="0.35 1.65"
			stroke-dashoffset="0.35"
			opacity="0"
		>
			<!-- window = 2.9s = 2.5s flight + 0.4s collapse; closes the instant the
				 tail finishes sliding off the path end -->
			<set attributeName="opacity" to="1" begin="2.3s; disc-flight-anim.end + 15.5s" dur="2.9s" />
			<animate
				attributeName="stroke-dashoffset"
				from="0.35"
				to="-0.65"
				dur="2.5s"
				begin="2.3s; disc-flight-anim.end + 15.5s"
				calcMode="spline"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
				fill="freeze"
			/>
			<animate
				attributeName="stroke-dashoffset"
				from="-0.65"
				to="-1"
				dur="0.4s"
				begin="disc-flight-anim.end"
				calcMode="spline"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
				fill="freeze"
			/>
		</use>
```

and the hot-tail `<use>` (currently `stroke-dasharray="0.1 0.9"` with a `stroke-opacity` fade animate) plus its comment with:

```svelte
		<!-- hot tail: short bright segment riding just behind the disc, collapsing
			 with the tail into the landing point -->
		<use
			href="#disc-path"
			stroke="white"
			stroke-opacity="0.7"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-dasharray="0.1 1.9"
			stroke-dashoffset="0.1"
			opacity="0"
		>
			<set attributeName="opacity" to="1" begin="2.3s; disc-flight-anim.end + 15.5s" dur="2.9s" />
			<animate
				attributeName="stroke-dashoffset"
				from="0.1"
				to="-0.9"
				dur="2.5s"
				begin="2.3s; disc-flight-anim.end + 15.5s"
				calcMode="spline"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
				fill="freeze"
			/>
			<animate
				attributeName="stroke-dashoffset"
				from="-0.9"
				to="-1"
				dur="0.4s"
				begin="disc-flight-anim.end"
				calcMode="spline"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
				fill="freeze"
			/>
		</use>
```

How to debug (not change) the arithmetic: with `pathLength="1"` on the source path, a dash window is `[−offset, −offset + dashLength]`. Flight phase: offset animates `dashLength → dashLength − 1`, so the window tip `−offset + dashLength` sweeps 0 → 1 with the motion's exact easing (glued to the disc), while the window start clips at the path start until the tail reaches full length. Collapse phase: offset continues to −1, so the window becomes `[1, 1 + dashLength]` — entirely off-path; the visible remainder `[−offset, 1]` shrinks into the landing point. Both phases `fill="freeze"`; the later-begin freeze wins between flights, and both animates restart from their `from` values on the next cycle's begin. The `<set>` window (2.9s) closes at the same instant the collapse ends — there is no frame where a frozen visible state can leak.

- [ ] **Step 2: Tighten the disc's opacity keyTimes**

In the disc group's opacity `<animate>` change `keyTimes="0;0.06;0.9;1"` to `keyTimes="0;0.06;0.94;1"` (values stay `0;1;1;0`) — the disc now stays visible until ~150ms before landing so its vanish reads as part of the tail collapse.

- [ ] **Step 3: Update the top choreography comment**

Replace the SVG-preceding comment block with:

```svelte
	<!-- disc flight: launch rings, retracting comet tail, layered disc (art derived from static/icons/frisbee-favicon.svg) -->
	<!--
		SMIL choreography: Chromium never fires cross-element `X.begin` syncbase
		references, but `X.end` works. Flight-start animations use literal begin
		lists in lockstep with disc-flight-anim's own "2.3s; disc-flight-anim.end + 15.5s"
		(second launch ring +0.15s by design); the tail-collapse animations hang off
		disc-flight-anim.end directly. Trail <set> windows are 2.9s = flight (2.5s)
		+ collapse (0.4s), closing exactly when the collapse completes.
	-->
```

- [ ] **Step 4: Verify checks pass**

Run: `npm run check && npm run lint`
Expected: 0 errors; formatted.

- [ ] **Step 5: Visual verification — the new flight sequence**

Flight 2.3–4.8s; collapse 4.8–5.2s. Dev server running:

```bash
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2500 http://localhost:5173/ <scratchpad>/t2-start.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=3600 http://localhost:5173/ <scratchpad>/t2-mid.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=4950 http://localhost:5173/ <scratchpad>/t2-collapse.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=5500 http://localhost:5173/ <scratchpad>/t2-after.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=8000 http://localhost:5173/ <scratchpad>/t2-between.png
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=3600 http://localhost:5173/ <scratchpad>/t2-mobile.png
```

Read all six and confirm:
- `t2-start.png`: rings firing at the release point, short tail forming behind the disc near the LEFT of the arc — and CRITICALLY nothing rendered at the far right of the path (the old wrap artifact).
- `t2-mid.png`: disc mid-arc with a finite tail behind it (about a third of the arc long), bright segment hugging the disc; the region from the release point to the tail's start is EMPTY (no full-arc line).
- `t2-collapse.png`: disc gone/nearly gone at the landing point; a shrinking tail remnant draining into that point.
- `t2-after.png`: hero completely clean.
- `t2-between.png`: still clean.
- `t2-mobile.png`: sequence scales, no clipping.

If the tail length or collapse speed looks off aesthetically, tune ONLY `stroke-dasharray` window lengths (keeping period 2.0: gap = 2 − dash) and the collapse `dur` on BOTH `<use>` elements plus the two `<set>` windows in lockstep (window = 2.5 + collapse dur) — and update the comments. Re-screenshot after any tune.

- [ ] **Step 6: Reduced-motion spot check**

Write and run `<scratchpad>/reduced-check.mjs` (dev server running):

```js
import { chromium } from '@playwright/test';

const b = await chromium.launch();
const p = await b.newPage({
	viewport: { width: 1440, height: 900 },
	reducedMotion: 'reduce'
});
await p.goto('http://localhost:5173/');
await p.waitForTimeout(3000);
const svgDisplay = await p
	.locator('svg.disc-flight')
	.evaluate((el) => getComputedStyle(el).display);
const pulseCount = await p.locator('.grid-pulse').count();
console.log('decor svg display:', svgDisplay, '| pulses:', pulseCount,
	svgDisplay === 'none' && pulseCount === 0 ? 'OK' : 'FAIL');
await b.close();
```

Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: rework disc trail into retracting comet tail with wrap-safe dash periods"
```

---

### Task 3: Verification sweep

**Files:**
- None expected.

- [ ] **Step 1: Full checks**

Run: `npm run test && npm run check && npm run lint`
Expected: 173 unit pass, 0 errors, clean.

- [ ] **Step 2: E2E smoke**

Run: `npx playwright test e2e/explorer.spec.ts e2e/quiz.spec.ts e2e/mobile.spec.ts e2e/auth.spec.ts`
Expected: 26/26 pass. Report environment failures verbatim; don't "fix" them.

- [ ] **Step 3: Final visual pass**

```bash
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=3600 http://localhost:5173/ <scratchpad>/final-landing.png
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=3600 http://localhost:5173/ <scratchpad>/final-mobile.png
```

Read both: disc mid-flight with finite tail, pulses on gridlines, no horizontal overflow on mobile.

- [ ] **Step 4: Commit any straggler fixes**

Only if needed:

```bash
git add -A src/
git commit -m "fix: address round 3 verification findings"
```
