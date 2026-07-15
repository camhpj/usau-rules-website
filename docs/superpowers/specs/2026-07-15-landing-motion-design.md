# Landing Page Motion — Design

**Date:** 2026-07-15
**Status:** Approved pending spec review
**Scope:** Visual polish — entrance motion, living field grid, and a disc flight arc animation. No functional changes.

## Goal

The site looks clean but static. Add a small set of deterministic CSS/SVG animations that make the landing page feel alive and memorable, without distracting from reading or quizzing elsewhere on the site.

## Non-goals

- No page-transition (View Transitions API) work in this iteration.
- No quiz feedback animations (answer pulse/shake, countdown ring) in this iteration.
- No JS-driven animation libraries (Lottie, GSAP, etc.). Everything is CSS keyframes or SMIL inside an inline SVG.
- No athlete line art.

## Design

### 1. Entrance motion (landing + quiz index)

- One shared `fade-up` keyframe: `opacity 0 → 1`, `translateY(12px) → 0`, ~450ms, ease-out, runs once on load, both directions fill.
- Exposed as a Tailwind v4 `@utility` (e.g. `animate-fade-up`) that reads a `--stagger` custom property for `animation-delay`, so markup sets `style="--stagger: 2"` (or a per-element class) and elements cascade ~80ms apart.
- Applied to:
  - Landing hero: headline, tagline, the two cards, the "Ask any question" link.
  - Quiz index (`/quiz`): kicker, headline, intro paragraph, and the four mode cards.
- Elements must not flash visible-then-hidden: initial state comes from the animation (`animation-fill-mode: both`), and the whole utility is wrapped in the reduced-motion media query so reduced-motion users simply see static content immediately.

### 2. Living field grid (landing only)

- The root layout keeps the existing static `field-lines` grid on every page.
- When `page.url.pathname === '/'`, the layout adds a `field-lines-live` class to the same element. That class animates `background-position` diagonally by exactly one tile (96px × 96px) over ~40s, linear, infinite — a seamless loop that reads as slow peripheral drift.
- **Pulses:** the landing hero section contains 2–3 absolutely-positioned streak elements (`pointer-events-none`, `aria-hidden`, clipped by an `overflow-hidden` wrapper):
  - Each is a thin (1–2px) gradient line (transparent → white/25 → transparent) lying on a grid line — positioned at a multiple of 96px from the viewport origin so it aligns with the background grid.
  - Each animates a translate across the full viewport dimension on a long cycle (~10s travel + idle time, staggered delays so at most one or two are visible at once). Mix of one horizontal and one/two vertical pulses.
- Pulses exist only on the landing page, so no route-conditional logic is needed for them; only the drift class lives in the layout.

### 3. Disc flight arc (landing hero)

- An inline SVG in the landing hero, absolutely positioned behind/around the headline, `aria-hidden`, `pointer-events-none`, responsive via `viewBox` + `preserveAspectRatio`.
- **The arc:** a single dashed cubic curve shaped like a playbook flight path (huck arc). Stroke: white at ~15% opacity; a small cardinal accent marker (dot or short segment) at the release point. The path draws itself with the stroke-dashoffset technique over ~1.5s, starting ~0.8s after load (after the entrance fade lands). Once drawn, the arc remains visible.
  - Note: because the path is dashed, the draw effect uses a wrapper/mask approach or a computed dash pattern so the "draw" reveal and the decorative dashes don't conflict (implementer's choice; visually verify).
- **The disc:** a small white ring ellipse (slightly flattened, suggesting a disc seen at an angle) that glides along the same path using SMIL `<animateMotion>` with `<mpath>` — scales with the viewBox, no JS.
  - First flight begins as the arc finishes drawing (~2.3s after load).
  - Replays roughly every 18s thereafter (SMIL `begin` list / `repeatDur` with dead time — implementer's choice). The disc is invisible (opacity 0) between flights.

### 4. Accessibility / reduced motion

- Every CSS animation in this feature (fade-up, grid drift, pulses, arc draw) is defined inside `@media (prefers-reduced-motion: no-preference)`.
- SMIL does not respect that media query, so the disc element is hidden with CSS (`display: none`) under `prefers-reduced-motion: reduce`.
- Reduced-motion experience: today's static page, plus the fully-drawn arc as a static decorative graphic. No fades, no drift, no pulses, no disc.

## Files touched

| File | Change |
| --- | --- |
| `src/app.css` | `fade-up`, grid-drift, pulse, and arc-draw keyframes; `animate-fade-up` and `field-lines-live` utilities; reduced-motion wrapping |
| `src/routes/+layout.svelte` | Conditionally add `field-lines-live` when on `/` |
| `src/routes/+page.svelte` | Arc SVG + disc, pulse elements, stagger classes on hero elements |
| `src/routes/quiz/+page.svelte` | Stagger classes on header + mode cards |

## Verification

- Iterate on the arc shape, disc motion, and pulse look with Playwright screenshots against the dev server (`npm run dev`), including a reduced-motion emulation check.
- Existing Playwright e2e smoke tests stay green.
- `npm run check` (svelte-check) and lint/format stay clean.
