# Landing Page Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add entrance fade-up motion, a slowly drifting "living" field grid with light pulses, and a self-drawing disc flight arc to the landing page (plus fade-up on the quiz index), per `docs/superpowers/specs/2026-07-15-landing-motion-design.md`.

**Architecture:** All motion is CSS keyframes plus one SMIL `<animateMotion>` inside an inline SVG — no JS animation code, no new dependencies. New utilities/keyframes live in `src/app.css`; the landing route gets decorative markup; the root layout conditionally adds one class.

**Tech Stack:** SvelteKit (Svelte 5 runes), Tailwind CSS v4 (`@utility` / `@layer` syntax in `app.css`), SMIL for the disc path-follow, Playwright CLI for visual verification.

## Global Constraints

- **No new dependencies.** Everything uses what's already installed.
- **Tailwind v4 syntax** in `app.css` (`@utility`, `@theme`, `@layer`) — match the existing file's style exactly (tabs for indentation).
- **Reduced motion:** every CSS animation added by this plan must be inside `@media (prefers-reduced-motion: no-preference)`; the SMIL disc must be hidden under `prefers-reduced-motion: reduce` via CSS (`display: none`). Reduced-motion users see the static page with the arc fully drawn.
- **Grid tile constant is 96px** (matches `field-lines` `background-size: 96px 96px` in `app.css`). Drift and pulse offsets must use multiples of 96px.
- **This is visual work:** the "test" for each task is `npm run check` + `npm run lint` staying green plus a Playwright screenshot you actually look at (Read the PNG). Do not skip the screenshot steps.
- Formatting is prettier-enforced: run `npm run format` before each commit if `npm run lint` complains.
- Dev server for screenshots: `npm run dev` serves `http://localhost:5173` (start it in the background once per task, kill it when done). Save screenshots to your scratchpad/temp directory, not the repo.

---

### Task 1: Motion CSS foundations + layout drift class

**Files:**
- Modify: `src/app.css` (append after the existing `@layer components` block)
- Modify: `src/routes/+layout.svelte:1-11` (script) and `:42` (shell div)

**Interfaces:**
- Produces (used by Tasks 2–3):
  - `animate-fade-up` utility class — fade/slide-in; per-element delay set with inline `style="--stagger: <n>"` (n × 80ms; default 0).
  - `field-lines-live` utility class — slow diagonal grid drift (applied by the layout on `/` only; no other task touches it).
  - `.grid-pulse` + `.grid-pulse-x` / `.grid-pulse-y` classes — traveling light streaks; delay via `--pulse-delay`.
  - `.arc-mask` class — stroke-draw animation for the SVG mask path (expects `pathLength="1"` and `stroke-dasharray="1"` on the element).
  - `.disc-flight` class — hidden under reduced motion.

- [ ] **Step 1: Append motion CSS to `src/app.css`**

Add this block at the end of the file (after the existing `@layer components` block):

```css
/* ---------- landing motion (see docs/superpowers/specs/2026-07-15-landing-motion-design.md) ---------- */

/* entrance fade-up; stagger with inline style="--stagger: <n>" (n × 80ms) */
@utility animate-fade-up {
	@media (prefers-reduced-motion: no-preference) {
		animation: fade-up 450ms ease-out backwards;
		animation-delay: calc(var(--stagger, 0) * 80ms);
	}
}

/* slow diagonal drift of the field-lines grid; landing page only */
@utility field-lines-live {
	@media (prefers-reduced-motion: no-preference) {
		animation: grid-drift 40s linear infinite;
	}
}

@layer components {
	/* light pulses traveling along landing grid lines; idle most of each cycle */
	.grid-pulse {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.grid-pulse-x {
		left: 0;
		height: 1px;
		width: 10rem;
		background: linear-gradient(to right, transparent, rgb(255 255 255 / 0.45), transparent);
	}
	.grid-pulse-y {
		top: 0;
		width: 1px;
		height: 10rem;
		background: linear-gradient(to bottom, transparent, rgb(255 255 255 / 0.45), transparent);
	}
	@media (prefers-reduced-motion: no-preference) {
		.grid-pulse-x {
			animation: pulse-x 14s linear infinite;
			animation-delay: var(--pulse-delay, 0s);
		}
		.grid-pulse-y {
			animation: pulse-y 14s linear infinite;
			animation-delay: var(--pulse-delay, 0s);
		}
	}

	/* disc arc: mask path draws the dashed arc in; fully drawn when animations are off */
	.arc-mask {
		stroke-dashoffset: 0;
	}
	@media (prefers-reduced-motion: no-preference) {
		.arc-mask {
			animation: arc-draw 1.5s ease-out 0.8s both;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.disc-flight {
			display: none;
		}
	}
}

@keyframes fade-up {
	from {
		opacity: 0;
		transform: translateY(12px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

@keyframes grid-drift {
	from {
		background-position: 0 0;
	}
	to {
		background-position: 96px 96px;
	}
}

@keyframes pulse-x {
	0% {
		transform: translateX(-10rem);
		opacity: 0;
	}
	4% {
		opacity: 1;
	}
	32% {
		opacity: 1;
	}
	38% {
		transform: translateX(100vw);
		opacity: 0;
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
	4% {
		opacity: 1;
	}
	32% {
		opacity: 1;
	}
	38% {
		transform: translateY(100vh);
		opacity: 0;
	}
	100% {
		transform: translateY(100vh);
		opacity: 0;
	}
}

@keyframes arc-draw {
	from {
		stroke-dashoffset: 1;
	}
	to {
		stroke-dashoffset: 0;
	}
}
```

Design notes you must preserve:
- `animate-fade-up` uses `backwards` (NOT `both` / `forwards`): after the animation ends the element returns to natural styles, so the cards' existing `card-link` hover `transform` keeps working. Do not change the fill mode.
- `.arc-mask { stroke-dashoffset: 0 }` outside the media query is the reduced-motion fallback (arc fully drawn). Do not remove it.

- [ ] **Step 2: Add the conditional drift class in `src/routes/+layout.svelte`**

Add the `page` import to the script block (after the existing imports, line ~10):

```svelte
	import { page } from '$app/state';
```

Change line 42 from:

```svelte
<div class="field-lines flex min-h-screen flex-col bg-navy-deep">
```

to:

```svelte
<div
	class="field-lines flex min-h-screen flex-col bg-navy-deep {page.url.pathname === '/'
		? 'field-lines-live'
		: ''}"
>
```

(Exact wrapping per prettier — run `npm run format` and accept its layout.)

- [ ] **Step 3: Verify checks pass**

Run: `npm run check && npm run lint`
Expected: `svelte-check found 0 errors`; prettier reports all files formatted (run `npm run format` first if not).

- [ ] **Step 4: Verify the drift class is applied only on `/`**

```bash
npm run dev   # start in background, wait for "Local: http://localhost:5173"
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2000 http://localhost:5173/ <scratchpad>/t1-landing.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2000 http://localhost:5173/quiz <scratchpad>/t1-quiz.png
```

Read both PNGs: pages must look identical to before (no layout shift, grid visible). Then confirm the class wiring:

```bash
curl -s http://localhost:5173/ | grep -o 'field-lines[^"]*' | head -1
curl -s http://localhost:5173/quiz | grep -o 'field-lines[^"]*' | head -1
```

Expected: the `/` response contains `field-lines-live`; the `/quiz` response does not. Kill the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/app.css src/routes/+layout.svelte
git commit -m "feat: add motion CSS foundations and landing grid drift"
```

---

### Task 2: Landing page — pulses, disc arc, entrance stagger

**Files:**
- Modify: `src/routes/+page.svelte` (full replacement below)

**Interfaces:**
- Consumes from Task 1: `animate-fade-up` (+ `--stagger`), `.grid-pulse*` (+ `--pulse-delay`), `.arc-mask`, `.disc-flight`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace `src/routes/+page.svelte` with:**

```svelte
<script lang="ts">
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
</script>

<svelte:head><title>Best Perspective — USA Ultimate Rules</title></svelte:head>

<div class="relative overflow-hidden">
	<!-- decorative light pulses along the field grid -->
	<div aria-hidden="true" class="absolute inset-0">
		<div class="grid-pulse grid-pulse-x" style="top: 224px; --pulse-delay: 2s"></div>
		<div class="grid-pulse grid-pulse-y" style="left: 288px; --pulse-delay: 7.5s"></div>
		<div class="grid-pulse grid-pulse-y" style="left: 1056px; --pulse-delay: 12s"></div>
	</div>

	<!-- disc flight arc: dashed playbook curve that draws itself; disc glides along it -->
	<svg
		aria-hidden="true"
		class="pointer-events-none absolute top-1/2 left-1/2 w-[min(56rem,92vw)] -translate-x-1/2 -translate-y-1/2"
		viewBox="0 0 800 400"
		fill="none"
	>
		<defs>
			<path id="disc-path" d="M 40 340 C 240 120, 560 80, 760 200" />
			<mask id="arc-reveal" maskUnits="userSpaceOnUse">
				<use
					href="#disc-path"
					class="arc-mask"
					stroke="white"
					stroke-width="12"
					pathLength="1"
					stroke-dasharray="1"
				/>
			</mask>
		</defs>
		<g mask="url(#arc-reveal)">
			<use
				href="#disc-path"
				stroke="white"
				stroke-opacity="0.15"
				stroke-width="2"
				stroke-linecap="round"
				stroke-dasharray="2 10"
			/>
			<circle cx="40" cy="340" r="4" fill="var(--color-cardinal)" />
		</g>
		<g class="disc-flight" opacity="0">
			<ellipse rx="11" ry="4.5" stroke="white" stroke-opacity="0.9" stroke-width="2" />
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
				begin="disc-flight-anim.begin"
			/>
		</g>
	</svg>

	<section
		class="relative mx-auto flex min-h-[calc(100vh-4rem-4.5rem)] max-w-6xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6"
	>
		<h1 class="display animate-fade-up mt-5 text-[clamp(3.5rem,8vw,6.5rem)] text-white">
			Know the<br /><span class="text-cardinal">Rules.</span>
		</h1>
		<p class="animate-fade-up mt-5 mb-3 max-w-xl text-lg text-white/70" style="--stagger: 1">
			Learn the rules of Ultimate and test your knowledge.
		</p>

		<div class="mt-4 grid w-full max-w-3xl gap-4 text-left sm:grid-cols-2">
			<a
				href="/rules/{DEFAULT_RULESET_ID}"
				class="group animate-fade-up relative card card-link p-6"
				style="--stagger: 2"
			>
				<h2 class="display text-2xl">Explore the rules</h2>
				<p class="mt-1.5 pr-8 text-sm text-navy/70">
					The whole rule book in a readable and searchable format.
				</p>
				<span
					aria-hidden="true"
					class="absolute top-6 right-6 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-1"
					>→</span
				>
			</a>
			<a
				href="/quiz"
				class="group animate-fade-up relative card card-link p-6"
				style="--stagger: 3"
			>
				<h2 class="display text-2xl">Test yourself</h2>
				<p class="mt-1.5 pr-8 text-sm text-navy/70">
					Quick quizzes, game scenarios, and section mastery grounded with citations.
				</p>
				<span
					aria-hidden="true"
					class="absolute top-6 right-6 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-1"
					>→</span
				>
			</a>
		</div>

		<a
			href="/ask"
			class="animate-fade-up mt-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"
			style="--stagger: 4"
		>
			<span aria-hidden="true" class="text-cardinal">✦</span> Ask any question
		</a>
	</section>
</div>
```

Why it's shaped this way (do not "fix" these):
- The outer `div.relative.overflow-hidden` clips pulses and arc; the `section` gains `relative` so it paints above the absolutely-positioned decor (positioned elements stack in DOM order).
- Pulse offsets sit on 96px grid lines. The layout's grid starts at the page's top-left and the section starts 64px down (the `min-h-16` nav), so x-pulse `top: 224px` = 288px page-space = 3 × 96. The y-pulse `left` values are already page-space multiples of 96 (288 = 3 × 96, 1056 = 11 × 96). The 1056px pulse is simply clipped on narrow screens — that's fine.
- The mask (`.arc-mask`, `pathLength="1"`, `stroke-dasharray="1"`) is what animates the draw; the visible dashed path underneath never animates, so the decorative dashes don't fight the reveal.
- The SMIL `begin="2.3s; disc-flight-anim.end + 15.5s"` self-reference makes the flight recur every ~18s (2.5s flight + 15.5s idle). The `<animate>` on opacity keeps the disc invisible between flights (default `fill="remove"` returns it to `opacity="0"`).
- The h1 has no `--stagger` (defaults to 0).

- [ ] **Step 2: Verify checks pass**

Run: `npm run check && npm run lint`
Expected: 0 errors; formatted (run `npm run format` if needed — but do not let prettier mangle the SVG `d` attribute; it won't, it only reflows whitespace).

- [ ] **Step 3: Visual verification — animated states**

With the dev server running:

```bash
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=800 http://localhost:5173/ <scratchpad>/t2-during-draw.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=3500 http://localhost:5173/ <scratchpad>/t2-disc-midflight.png
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=6000 http://localhost:5173/ <scratchpad>/t2-settled.png
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=6000 http://localhost:5173/ <scratchpad>/t2-mobile.png
```

Read all four and confirm:
- `t2-during-draw.png`: hero text visible (fade-up done or in progress), arc partially drawn or absent (draw starts at 0.8s).
- `t2-disc-midflight.png`: full dashed arc + cardinal release dot visible; white disc ellipse somewhere along the curve.
- `t2-settled.png`: arc fully drawn, disc gone (between flights), layout otherwise identical to the pre-change landing page.
- `t2-mobile.png`: no horizontal scrollbar/overflow, arc scaled down behind the headline, nothing clipped awkwardly.

If the arc sits badly against the headline (e.g., too high/low), adjust only the SVG's positioning classes (`top-1/2`, width) — not the path — and re-screenshot.

- [ ] **Step 4: Reduced-motion verification**

```bash
node -e "
const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: process.env.OUT });
  await b.close();
})();
" 
# with OUT=<scratchpad>/t2-reduced.png
```

Read it and confirm: hero content fully visible immediately (no fade), arc fully drawn, **no disc ellipse anywhere**, page otherwise static-looking.

- [ ] **Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: add disc flight arc, grid pulses, and entrance motion to landing page"
```

---

### Task 3: Quiz index entrance stagger

**Files:**
- Modify: `src/routes/quiz/+page.svelte:70-104` (template only; script block unchanged)

**Interfaces:**
- Consumes from Task 1: `animate-fade-up` + `--stagger`.

- [ ] **Step 1: Add stagger classes to the quiz index template**

Replace the template section (from `<section ...>` to `</section>`) with:

```svelte
<section class="mx-auto max-w-6xl px-4 py-12 sm:px-6">
	<p class="animate-fade-up text-xs font-semibold tracking-[0.18em] text-cardinal uppercase">
		Test yourself
	</p>
	<h1 class="display animate-fade-up mt-3 text-5xl text-white sm:text-6xl" style="--stagger: 1">
		Pick your game.
	</h1>
	<p class="animate-fade-up mt-4 max-w-2xl text-white/70" style="--stagger: 2">
		Every question is grounded in the official rules, with citations to relevant rules.
	</p>

	<div class="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		{#each modes as mode, i (mode.href)}
			<a
				href={mode.href}
				class="group animate-fade-up relative flex flex-col card card-link p-6"
				style="--stagger: {3 + i}"
			>
				<h2 class="display pr-10 text-2xl">
					{#if mode.href === '/quiz/quick'}
						Quick <br class="hidden xl:block" />Quiz
					{:else}
						{mode.title}
					{/if}
				</h2>
				<p class="mt-1.5 pr-8 text-sm text-navy/70">{mode.body}</p>
				{#if mode.stat}
					<p class="mt-auto pt-4 text-xs font-semibold tracking-wider text-navy/50 uppercase">
						{mode.stat}
					</p>
				{/if}
				<span
					aria-hidden="true"
					class="absolute top-6 right-6 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-1"
					>→</span
				>
			</a>
		{/each}
	</div>
</section>
```

The only changes vs. the current file: `animate-fade-up` + `--stagger` on the kicker `<p>`, `<h1>`, intro `<p>`, and each card; and the `{#each}` gains the index `i`. Everything else must stay byte-identical.

- [ ] **Step 2: Verify checks pass**

Run: `npm run check && npm run lint`
Expected: 0 errors, formatted.

- [ ] **Step 3: Visual verification**

With the dev server running:

```bash
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=2500 http://localhost:5173/quiz <scratchpad>/t3-quiz.png
```

Read it: identical to the pre-change quiz page (all four cards + stats visible — by 2.5s all staggered animations have finished). Hover behavior unaffected (cards still lift; nothing to screenshot, just don't touch `card-link`).

- [ ] **Step 4: Commit**

```bash
git add src/routes/quiz/+page.svelte
git commit -m "feat: add entrance stagger to quiz index"
```

---

### Task 4: Full verification sweep

**Files:**
- None expected (fixes only if something fails).

- [ ] **Step 1: Unit tests, type check, lint**

Run: `npm run test && npm run check && npm run lint`
Expected: all pass. These pages have no unit-tested logic changes, so failures here mean something structural broke — fix before proceeding.

- [ ] **Step 2: E2E smoke (landing + quiz + mobile specs)**

Run: `npx playwright test e2e/explorer.spec.ts e2e/quiz.spec.ts e2e/mobile.spec.ts`
Expected: pass. If tests fail for environment reasons (e.g., missing local D1 setup), report the exact error to the main agent rather than "fixing" tests.

- [ ] **Step 3: Final visual pass**

Dev server running; take and Read:

```bash
npx playwright screenshot --viewport-size=1440,900 --wait-for-timeout=6000 http://localhost:5173/ <scratchpad>/final-landing.png
npx playwright screenshot --viewport-size=390,844 --wait-for-timeout=6000 http://localhost:5173/ <scratchpad>/final-mobile.png
```

Confirm no regressions, no horizontal overflow on mobile, arc drawn.

- [ ] **Step 4: Commit any straggler fixes**

Only if Steps 1–3 required changes:

```bash
git add -A src/
git commit -m "fix: address verification findings for landing motion"
```
