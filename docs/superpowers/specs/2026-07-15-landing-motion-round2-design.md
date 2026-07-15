# Landing Motion Round 2 — Design

**Date:** 2026-07-15
**Status:** Approved pending spec review
**Builds on:** `2026-07-15-landing-motion-design.md` (shipped on `feature/visual-improvements`)
**Scope:** Four refinements to the shipped motion work: nav auth-state layout shift, gridline-riding random pulses, entrance motion for `/rules` and `/ask`, and a redesigned disc flight (comet trail + pulse-ring launch + favicon-derived disc art).

## Goals

1. Kill the sign-in-button → avatar snap in the nav on page load.
2. Make grid pulses actually travel *along* gridlines (they currently sit at fixed positions while the drifting grid slides out from under them) and appear at a different, randomly chosen gridline each time.
3. Give `/rules` the quiz-index entrance treatment and `/ask` a fast single fade-up.
4. Replace the disc flight's weak parts: the pre-drawn dashed arc (gone — replaced by a comet trail drawn in sync with the disc), the pop-in at the release dot (replaced by a pulse-ring launch), and the bare-ellipse disc (replaced by a layered disc derived from `static/icons/frisbee-favicon.svg`).

## Non-goals

- No changes to quiz index or landing hero copy/layout beyond the decor.
- No new dependencies, no JS animation libraries. JS is allowed for orchestration (pulse spawning, sync), but all motion remains CSS keyframes / SMIL.
- No page-transition work.

## Design

### 1. Nav auth-state stability (`src/lib/components/Nav.svelte`)

- Replace the boolean `user`-null check with a three-state view: `'pending' | 'signedIn' | 'signedOut'`.
- Subscribe to `authClient.useSession()`; while `isPending`, the view is `pending` unless a localStorage hint overrides it (below). On resolve, set the view from `data` and write the hint.
- **Hint:** `localStorage` key `bp-auth-hint`, value `'1'` (was signed in) or `'0'`, written on every session resolve. The site is fully prerendered (`+layout.ts` sets `prerender = true`), so the static HTML is identical for all visitors and hydration timing is too late to prevent a visible swap on cold loads. The hint therefore applies **before first paint** via the theme-flash pattern:
  - A tiny blocking inline `<script>` in `src/app.html`'s `<head>` reads the hint and, when it is `'0'`, sets `data-auth-hint="0"` on `<html>` (wrapped in try/catch for storage-disabled browsers).
  - The nav's `pending` state renders BOTH the avatar-sized placeholder and an "optimistic" copy of the Sign in button (shared via a Svelte snippet so the markup isn't duplicated); CSS shows exactly one of them: default = placeholder, `html[data-auth-hint='0']` = button.
  - hint `'1'` (or absent) → placeholder on first paint; swap to the avatar causes no shift (same 32px footprint). First-ever visitors see placeholder→button once the session resolves — the one unavoidable case.
  - hint `'0'` → the Sign in button is visible from first paint; the resolved session confirms it — no swap in the common case.
  - `onMount` still reads the hint to set `view = 'signedOut'` at hydration (consistent with what CSS is already showing) and the session subscription remains the source of truth.
- **Placeholder:** a `div` with `h-8 w-8 rounded-full border border-white/15` (same footprint as the avatar button), `aria-hidden="true"`.
- Stale-hint edge cases self-correct when the session resolves; the transient wrong-size element is acceptable (rare).
- SSR renders `pending` (no storage on the server). Guard localStorage access with a `typeof localStorage !== 'undefined'` / `browser` check so SSR doesn't throw.

### 2. Gridline-riding random pulses

**New component `src/lib/components/GridPulses.svelte`**, replacing the three static pulse `div`s in the landing page.

- **Container:** `div` `pointer-events-none absolute inset-0 overflow-hidden` `aria-hidden="true"`; inside it a **drift layer** `div` (`absolute inset-0`) whose transform animates `translate(0, 0) → translate(96px, 96px)` over 40s linear infinite — the same vector, duration, and easing as the background `grid-drift`, so pulses spawned on a line move with that line.
- **Phase lock:** both the background drift (`field-lines-live`) and the drift layer read `animation-delay: var(--drift-sync-delay, 0ms)`. On mount, the component sets `--drift-sync-delay` to `-(performance.now() % 40000)ms` on `document.documentElement` once. Both animations restart from a shared epoch and stay phase-locked (both are linear + infinite + 40s). The background restart causes at most a sub-5px reposition of 3–4%-opacity lines, once, at hydration — imperceptible.
- **Spawning:** on mount (skipped entirely when `matchMedia('(prefers-reduced-motion: reduce)')` matches):
  - Loop with `setTimeout` at a random 5–9s interval; also spawn the first pulse after ~1.5s so the page doesn't feel inert.
  - Each spawn: measure the container's page-space rect (`getBoundingClientRect()` + scroll offset), pick a random orientation (horizontal or vertical), and pick a random gridline index `k` whose page-space coordinate `96·k` lies within the container (with a half-tile margin at the edges). Compute the pulse's offset inside the drift layer as `96·k − containerPageOffset`.
  - Push into a `pulses` state array rendered with `{#each}`; each pulse `div` runs a single-pass 5s travel animation (`pulse-x-run` / `pulse-y-run`: translate across the container's full span with opacity ramping in over the first ~8% and out over the last ~15%); remove the pulse from the array on `animationend`.
  - Cap concurrent pulses at 3 (skip a spawn if at cap).
  - Clear the timeout on destroy.
- **Gridline math helper:** a pure function (e.g. `src/lib/grid-pulse-lines.ts`) `gridLineOffsets(pageOffset: number, spanLength: number, tile: number): number[]` returning the valid in-container offsets — unit-tested (offsets are multiples of `tile` in page space, within bounds, empty when the span is smaller than one tile).
- **CSS changes (`src/app.css`):** replace the looping `pulse-x`/`pulse-y` keyframes with single-run variants; add the drift-layer class + `grid-drift-translate` keyframes; add `animation-delay: var(--drift-sync-delay, 0ms)` to `field-lines-live` and the drift layer. The `.grid-pulse*` visual styles (1px gradient streaks) stay.

### 3. `/rules` and `/ask` entrance

- **`src/routes/rules/+page.svelte`:** same treatment as the quiz index — `animate-fade-up` with `--stagger` 0 on the kicker `<p>`, 1 on the `<h1>`, 2 on the intro `<p>`, and `3 + i` on each ruleset card (the `{#each}` gains an index).
- **`src/routes/ask/+page.svelte`:** `animate-fade-up` on the outer `<section>` only (stagger 0/default). Applying it to the section wrapper means the session-resolve swap (skeleton → sign-in card or form) does not re-trigger the animation.

### 4. Disc flight redesign (`src/routes/+page.svelte` + `src/app.css`)

The pre-drawn dashed arc, its mask, and the cardinal release dot are **removed** (including the now-unused `.arc-mask` CSS and `arc-draw` keyframes). The flight path `d` (`M 40 340 C 240 120, 560 80, 760 200`) and the ~18s SMIL schedule survive. Each flight is a self-contained sequence:

- **Timing base:** the existing `<animateMotion id="disc-flight-anim" dur="2.5s" begin="2.3s; disc-flight-anim.end + 15.5s" calcMode="spline" keySplines="0.4 0 0.6 1">`. All other animations reuse the duplicated literal begin list (or `disc-flight-anim.end`-anchored begins, which Chromium does fire). ONE comment covers the group, replacing round 1's comment: cross-element `.begin` syncbase never fires in Chromium, `.end` does — keep the literal begin lists in lockstep with the motion's.
- **Launch rings:** two `<circle>`s at the release point `(40, 340)`, stroke `var(--color-cardinal)`, no fill, base opacity 0. At flight begin each animates `r` 3→22 and opacity ~0.8→0 over 700ms, the second starting 150ms later. SMIL `<animate>` with literal begin lists (`2.3s; …` and `2.45s; …`).
- **Disc scale-in:** the disc body group scales 0.3→1 over 300ms at flight begin (SMIL `<animateTransform type="scale">` on an inner group — the outer group carries `animateMotion`, so transforms don't collide). Combined with the existing opacity ramp (values `0;1;1;0`, tightened so the disc is fully visible by ~0.06 of the flight).
- **Comet trail:** the same path element(s), redrawn per flight, synced to the disc:
  - *Main trail:* the flight path with `pathLength="1" stroke-dasharray="1"`, base opacity 0, soft white hairline (`stroke-width` ~2, `stroke-opacity` ~0.3, round caps). Per flight: a `<set>` raises opacity to 1 for the flight duration + fade window; an `<animate>` on `stroke-dashoffset` 1→0 with the **same dur and keySplines as the motion** so the trail tip tracks the disc; after landing (`begin="disc-flight-anim.end + 0.3s"`) an opacity fade 1→0 over ~1s. Between flights everything is at base opacity 0 — the hero is clean.
  - *Hot tail:* a second copy of the path with a short visible dash window (`stroke-dasharray="0.1 1" pathLength="1"`, brighter white ~0.7, width ~2.5) whose dashoffset animates from `1.1 → 0` with the same timing, so a short bright segment rides just behind the disc; it shares the trail's opacity choreography (visible during flight, gone after).
  - Exact dash/offset arithmetic may be tuned during implementation — the binding requirements are: trail tip visually glued to the disc throughout the flight, short bright segment immediately behind the disc, everything fades within ~1.5s after landing, nothing visible between flights.
- **Disc art** (derived from `static/icons/frisbee-favicon.svg`, recolored for the navy background; drawn at the same ~24×12 scale as the current ellipse, centered on the motion origin):
  - Underside rim ellipse: fill dark cardinal (`#7d1528`), slightly lower than the top.
  - Top surface ellipse: fill `var(--color-cardinal)`.
  - Concave inner ring: `fill="none"`, stroke darker cardinal (`#8f1a30`), thin.
  - Gloss arc along the leading edge: light stroke (`#f2a9b4` or `white` at ~0.6), round caps.
  - Base tilt ~−12° (transform on the disc body group), with a CSS wobble animation (±3° around the base tilt, ~1.2s ease-in-out infinite alternate) on the innermost group — CSS class `disc-body`, guarded by `prefers-reduced-motion: no-preference` (moot given the reduce fallback below, but consistent).
- **Reduced motion:** the whole SVG keeps `class="disc-flight"`-equivalent hiding — with no persistent arc anymore, the reduced-motion landing hero is simply clean/static (no disc, no trail, no rings). The round-1 CSS rule hiding `.disc-flight` under `reduce` moves up to hide the entire decor SVG.

## Files touched

| File | Change |
| --- | --- |
| `src/lib/components/Nav.svelte` | three-state auth view + localStorage hint + placeholder |
| `src/lib/components/GridPulses.svelte` | new: random gridline pulse spawner + drift layer |
| `src/lib/grid-pulse-lines.ts` | new: pure gridline-offset helper |
| `src/lib/grid-pulse-lines.test.ts` (or repo's unit-test convention) | unit tests for the helper |
| `src/routes/+page.svelte` | remove static pulses + dashed arc/mask; add `<GridPulses />`, launch rings, comet trail, layered disc |
| `src/routes/rules/+page.svelte` | entrance stagger (quiz treatment) |
| `src/routes/ask/+page.svelte` | single section fade-up |
| `src/app.css` | single-run pulse keyframes, drift-layer + sync var, remove `.arc-mask`/`arc-draw`, add wobble + decor-SVG reduce hiding |

## Verification

- Unit: helper tests green alongside the existing 169.
- `npm run check`, `npm run lint`, e2e smoke (explorer/quiz/mobile) green.
- Playwright screenshots: launch moment (rings + scale-in), mid-flight (trail glued to disc, hot tail visible), just after landing (trail fading), between flights (clean hero), zoomed crop proving a pulse lies exactly on a gridline, mobile viewport, reduced-motion (clean hero, no disc/trail/rings, no fade-ups pending).
- Nav: with a signed-in storage state, verify no layout shift between first paint and session resolve (screenshot pair or bounding-box comparison of the nav links).
