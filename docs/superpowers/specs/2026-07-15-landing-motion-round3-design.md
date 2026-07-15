# Landing Motion Round 3 — Design

**Date:** 2026-07-15
**Status:** Approved pending spec review
**Builds on:** rounds 1–2 (`2026-07-15-landing-motion-design.md`, `2026-07-15-landing-motion-round2-design.md`), shipped on `feature/visual-improvements`
**Scope:** Two user-feedback refinements: (1) stop the grid drift entirely and make pulses more frequent; (2) fix two disc-flight defects — the hot tail's wrap-around artifact at the far right on launch, and the two-stage disc-then-trail fade at landing, replaced by a retracting comet tail.

## Goals

1. The background grid is completely static; gridline pulses appear noticeably more often.
2. No trail fragment ever appears at the far right of the path at flight start.
3. The flight ends in one continuous motion: the disc vanishes at the landing point and the tail collapses into that point right behind it — no lingering full-arc line, no separate delayed fade.

## Design

### 1. Static grid, more frequent pulses

Removing the drift deletes the entire phase-sync apparatus — this is a simplification, not a feature:

- **`src/app.css`:** delete the `field-lines-live` utility, the `grid-drift` and `grid-drift-translate` keyframes, and the `.grid-drift-layer` rule. The base `field-lines` texture is untouched (static everywhere, as before round 1).
- **`src/routes/+layout.svelte`:** remove the `class:field-lines-live` directive and the now-unused `page` import.
- **`src/lib/components/GridPulses.svelte`:**
  - Delete the drift-layer `div` — pulses render directly inside the clipped container — and the `--drift-sync-delay` `setProperty` call plus the `DRIFT_PERIOD_MS` constant.
  - Frequency: first spawn at ~800ms, then every 2.5–5.5s (`2500 + Math.random() * 3000`); `MAX_CONCURRENT` raised 3 → 4.
  - Everything else (random axis, random gridline via `gridLineOffsets`, `animationend` removal, reduced-motion early return, timer cleanup) is unchanged, and the helper + its tests are untouched.
- With the grid static, pulses positioned at `96·k − containerPageOffset` are exactly on gridlines at all times — the alignment guarantee no longer depends on any animation sync.

### 2. Disc flight: wrap fix + retracting comet tail

All in the landing decor SVG (`src/routes/+page.svelte`). Launch rings, disc art/wobble, motion timing (2.5s flight, `begin="2.3s; disc-flight-anim.end + 15.5s"`, 18s cycle), and the begin-list lockstep rule are unchanged.

- **Wrap-around fix (both trail elements):** SVG dash patterns tile with the pattern period. The hot tail's `stroke-dasharray="0.1 0.9"` has period 1.0 — equal to the normalized path length — so at flight start its dash wraps and renders at the far *end* of the path (the user-visible artifact). Fix: make every trail dash period 2.0 (gap = 2 − dash), so wrapped copies always land beyond the path and off-screen.
- **Main trail, first iteration (superseded — see "In-flight absorption" below):**
  - `stroke-dasharray="0.35 1.65"` — a tail 0.35 of the path long, visible window `[pos − 0.35, pos]`, clipped naturally at the path start while the flight ramps up.
  - Flight phase: `stroke-dashoffset` animates `0.35 → −0.65` with the motion's exact `dur`/`keySplines` (window tip glued to the disc), `fill="freeze"`.
  - Landing phase: a second `stroke-dashoffset` animate, `−0.65 → −1.0`, `dur="0.4s"`, `begin="disc-flight-anim.end"`, `fill="freeze"` (a later-begin freeze wins over the earlier one) — the tail window slides off the path's end point, i.e. collapses into the landing spot. At offset −1.0 the window is `[1.0, 1.35]`: fully off-path, nothing visible.
  - The `<set>` opacity window becomes `dur="2.9s"` (2.5s flight + 0.4s collapse — closes the instant the collapse completes). The old post-landing `stroke-opacity` fade animate is deleted; the old full-path draw (`1 → 0`) is replaced by the window animation above.
- **Hot tail (removed after user feedback):** the bright thick segment behind the disc read as a visual defect on the live page and was removed entirely — the faint main tail is the only trail.
- **In-flight absorption (final design, after two rounds of user feedback):** any two-phase choreography (flight animate, then post-landing collapse animate) has a velocity discontinuity at the handoff — the tail dead-stops at touchdown, then restarts. The post-landing tail phase was therefore eliminated: the tail is *absorbed into the disc during the final 0.5s of flight*, so everything settles together at touchdown. Mechanism: dash windows anchor at the pattern origin, so the tail is drawn on a **reversed copy of the path** (`#disc-path-rev`), where the anchored window edge sits at the disc; the dashoffset sweeps `−1 → 0` with the motion's spline (tip glued to the disc) while a `stroke-dasharray` animate shrinks the window `0.35 → 0` from flight-start+2.0s to touchdown (`begin="4.3s; discFlightAnim.end + 17.5s"`, dur 0.5s), eating the tail from its far end. The trail `<set>` window is 2.5s (flight only); the disc's settle-and-fade after landing is `dur="0.3s"`, `keyTimes="0;0.4;1"`.
- **Boundary race-proofing:** the `<use>`'s base `stroke-dasharray` is `"0 2"` (invisible zero-length window); a hold `<set to="0.35 1.65" dur="2.1s">` supplies the working tail length through the pre-absorption flight, overlapping the shrink animate by 0.1s. Every same-instant handoff (hold→shrink at 4.3s, shrink-revert + opacity-window close at 4.8s) therefore resolves to an invisible state regardless of browser sub-frame ordering — this class of race previously flashed the full tail over the disc for one frame at touchdown.
- **Disc (amended during implementation, user-ratified):** the disc *lands and settles* rather than vanishing at touchdown. `animateMotion` gains `fill="freeze"` so the disc holds at the landing point through the collapse; its flight opacity animate becomes `values="0;1;1"` (freeze at 1), and a second opacity animate (`begin="discFlightAnim.end"`, `dur="0.3s"`, `values="1;1;0"`, `keyTimes="0;0.4;1"`, freeze) keeps it solid while the tail retracts into it, fading it only in the last ~120ms.
- **SMIL id rule (discovered during implementation, repro-confirmed):** in Chromium a hyphenated id's *self*-referencing begin list works, but *cross-element* `id.end` references to a hyphenated id silently never fire. `disc-flight-anim` is renamed `discFlightAnim` everywhere; ids used in time-values must stay camelCase. (This also explains round 2's reported exit ugliness: the old trail fade hung off a cross-element hyphenated `.end` reference and never actually ran — the trail was vanishing abruptly at the `<set>` window edge.)
- **Mobile placement (amended during implementation, user-ratified):** below `sm` the stacked cards' opaque backgrounds cover the vertically-centered flight path, so the SVG anchors small and high above the headline (`top-4 w-[48vw]`); at `sm+` the original centered placement applies.
- **Comment:** the SVG choreography comment is updated for the new windows (2.5s opacity / 2.1s dasharray hold), the dash-period-2 wrap rule, the camelCase-id rule, and the freeze-based landing sequence.

### 3. Footer (added after user feedback)

The footer was transparent over the layout's `field-lines` background, so gridlines showed through it. Its root element gains `bg-navy-deep`, hiding the grid behind the footer band on every page.

### Non-goals

- No changes to nav auth, `/rules`, `/ask`, quiz, launch rings, disc art, timing skeleton, or reduced-motion behavior (the decor SVG stays hidden under `reduce`; GridPulses still spawns nothing).

## Files touched

| File | Change |
| --- | --- |
| `src/app.css` | delete `field-lines-live`, `grid-drift`, `grid-drift-translate`, `.grid-drift-layer` |
| `src/routes/+layout.svelte` | drop `class:field-lines-live` + unused import |
| `src/lib/components/GridPulses.svelte` | drop drift layer + sync var; retime spawner; cap 4 |
| `src/routes/+page.svelte` | trail dash/offset rework, disc keyTimes, comment update |

## Verification

- 173 unit + check + lint + e2e smoke stay green (no test-facing changes).
- Screenshots: flight start (~2.5s — NO fragment at far right), mid-flight (finite tail behind disc, bright segment at tip, nothing spanning the full arc), landing (~4.9–5.1s — tail collapsing into the landing point, disc gone), post-landing (~5.5s — completely clean), between-flights clean, pulse-alignment zoom crop (static grid — pulse exactly on a line), reduced-motion (clean static hero).
- Pulse frequency sanity: over a ~15s observation window, expect ≥3 pulse sightings (vs ~2 before).
