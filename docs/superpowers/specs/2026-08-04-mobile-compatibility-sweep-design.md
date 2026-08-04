# Mobile compatibility sweep

## Problem

The UI has never been swept at phone width. One e2e test (`e2e/mobile.spec.ts`) covers mobile, and it checks a single flow: the rules TOC dialog navigating between sections. Everything else about the mobile experience is unverified, and nothing in CI fails when a change breaks it.

A measured audit found defects in every class the sweep covers, including one that makes a shipped feature unreachable on a phone.

## Goals

Fix the mobile defects the audit found across every route, including `/admin`. Leave behind a harness that fails CI when a new one appears.

The sweep covers four classes of defect:

- **Layout breakage** — horizontal overflow, overlapping controls, content covered or unreachable.
- **Touch-only interaction failures** — controls revealed only by `:hover`, which never fires on touch.
- **Mobile browser behaviors** — iOS input zoom, and viewport units that resolve against a retracted URL bar.
- **Tap target sizing** — controls below the 44×44 minimum.

## What the audit measured

Every route was loaded at 320, 375, and 768 CSS pixels in a Chromium context with `hasTouch` and `isMobile` set, signed out, signed in, and as admin. At each stop the probe recorded `documentElement.scrollWidth` against `clientWidth`, the bounding box of every interactive element, and the computed font size of every input.

The public routes have no horizontal overflow at any width. The leaderboard table fits at 320px. Those two areas need no work.

### Confirmed defects

| # | Defect | Measurement |
| --- | --- | --- |
| 1 | The rule bookmark button is invisible on touch | Computed `opacity: 0` at 16×16 on a touch device. `RuleNode.svelte` reveals it with `group-hover`. A forced tap toggles it, so the control works and simply cannot be found. |
| 2 | `/admin` scrolls horizontally | `scrollWidth` 409 against a 375 viewport. The range-pill row (`ml-auto flex items-center gap-2 pb-2`) spans x=225 to x=408. |
| 3 | The timed-run header overlaps itself | "End run" occupies y=170–200. The "Streak · Score" line occupies y=197–213 across the same x range, so the text runs under the button. |
| 4 | The `/ask` textarea is 14px | iOS Safari zooms the page when focus enters any input below 16px. |
| 5 | The mobile TOC pill covers rule text | The fixed pill sits at y=613–647. `elementsFromPoint` beneath it returns a `<td>` of live rule content. Nothing reserves space for it. |
| 6 | The `/ask` page scrolls behind a fixed-height panel | `scrollHeight` 685 against `clientHeight` 667. The panel's `h-[calc(100dvh-11rem)]` assumes a chrome height that does not hold. |
| 7 | Tap targets fall below 44×44 site-wide | Every page carries at least eight. In the shared chrome: nav links at 35×15, 26×15, and 22×15; Search at 26×30; Sign in at 30×30; Account menu at 32×32. Per page: quiz toggle pills at 30 tall, admin tabs and pills at 24–30 tall, `/ask` Chats at 82×24, New chat at 116×28, Send at 36×36, and `/me` links at 15–20 tall. |

### Predicted, not measurable

Playwright cannot simulate a retracting URL bar or an on-screen keyboard, so these three are fixed but not asserted:

- The landing hero uses `min-h-[calc(100vh-4rem-4.5rem)]`. On mobile, `100vh` resolves against the large viewport, so the hero exceeds the visible area while the URL bar shows.
- The search dialog's result list ends at y=537 in a 667px viewport. An iOS keyboard takes roughly 300px, which puts the lower results out of reach.
- The conversation delete button in `ConversationSidebar.svelte` uses the same `opacity-0 group-hover:opacity-100` pattern as defect 1. The code is conclusive; the measurement is not, because the probe could not seed a conversation.

### Unverified

`/admin/ai` rendered its empty state during the audit, so its five-column table was never exercised at 375px. Implementation seeds a row with a long title and a long email, measures, and treats the result as a finding or a non-finding accordingly.

## Invariants

The harness enforces three invariants at each route and viewport. They are the contract; the fixes exist to satisfy them.

**No horizontal overflow.** `document.documentElement.scrollWidth` must not exceed `clientWidth`. Content that is genuinely wider than a phone, such as a wide table, satisfies this by scrolling inside its own container.

**No undersized standalone control.** Every interactive element must measure at least 44×44, with one exception below.

**No covered control.** No fixed or sticky element may sit above an interactive element at that element's center point.

### The inline-target exception

Links inside running prose are exempt from the 44×44 floor. WCAG 2.2 carries this exception at both AA (24×24) and AAA (44×44) for targets "in a sentence or block of text," and the app has three such cases: rule cross-references in `.rule-html`, glossary `dfn` terms, and the footer's "not affiliated" sentence.

Enforcing the floor on them would require a 44px min-height on every rule row and a 44px line-height in rule prose. That roughly doubles the length of every rulebook page and destroys the dense outline structure that makes it scannable.

The exception is a selector list in the test file, not a computed heuristic:

```ts
const INLINE_EXEMPT = [
	'.rule-html a', // rule cross-references
	'dfn[data-rule]', // glossary terms
	'footer a',
	'footer button', // the "not affiliated" sentence
	'[data-inline-target]' // opt-in for anything added later
];
```

A heuristic on computed `display` would silently exempt real buttons as the code changes. A list makes every exemption a reviewable diff. Keep it short; a growing list is a signal that a control is in the wrong place, not that the list needs another entry.

Inline targets stay small, and someone will occasionally miss one. Every inline destination is reachable another way: rule anchors from the TOC and from search, glossary terms from their own rule pages.

## Deliverable 1: the harness

`e2e/mobile.spec.ts`, rewritten as a data-driven sweep over routes and viewports at 320, 375, and 768. It covers signed-out routes, signed-in routes (`/me`, `/ask`), and admin routes, reusing `signUpTestUser` and `signInAsAdmin` from `e2e/helpers.ts`.

A failure names the offending element: its tag, its classes, and its measured box. A bare "the page overflowed" costs more time than the test saves.

Three interaction tests carry what the invariants cannot express:

- Bookmarking a rule works on a touch device with no hover.
- Deleting a conversation works on a touch device with no hover.
- The mobile TOC dialog navigates between sections. This is today's test, kept.

Runtime is the constraint that shapes this. The suite runs single-worker against one wrangler dev server and one D1 file, so the sweep visits each route once per viewport and asserts all three invariants from a single DOM evaluation rather than reloading per assertion.

## Deliverable 2: the fixes

Build the harness first and run it red. Its output is the working defect list; the table above is the estimate that justified the work.

Fixes land in five groups, shared components first because they clear most of the tap-target findings at once.

1. **Shared components.** `Nav.svelte`, `Button.svelte`, `TogglePill.svelte`, and the icon buttons. The nav's `min-h-16` already leaves room for 44px controls, so padding gets there without changing the header's height.
2. **Page layout.** The `/admin` pill row overflow, the timed-run header overlap, and bottom clearance under the mobile TOC pill.
3. **Mobile browser behaviors.** Inputs to 16px, `vh` to `dvh` on the landing hero, and a viewport-relative cap on the search dialog's result list.
4. **Touch affordances.** The rule bookmark button and the conversation delete button. Both need to be visible without hover on a touch device while staying unobtrusive on a pointer device.
5. **The `/admin/ai` table**, if seeding shows it needs it.

Each group must leave `npm run check`, `npm run test`, and `npx prettier --check .` passing.

## Out of scope

Visual redesign. The sweep fixes what is broken or unreachable on a phone and changes nothing else about how the app looks.

Tablet and desktop layouts, except where a fix at 768 affects them.

The `vitest` setup. It runs in a node environment with no DOM, and mobile behavior is a function of viewport and input method, so it cannot be asserted there. Adding jsdom to test layout would produce confident assertions about a renderer that does not lay anything out.

## Open questions

None blocking. The `/admin/ai` table is unverified rather than unknown, and implementation resolves it by measuring.

## Decision log

**Inline prose links are exempt from the 44×44 floor.** Rejected: applying the floor everywhere, which requires a 44px min-height per rule row and a 44px line-height in rule prose, roughly doubling every rulebook page. Also rejected: a 24×24 floor for inline targets (WCAG 2.2 AA), which changes almost nothing in practice because the line box at `leading-relaxed` already measures about 24px, and which adds a second threshold to the test for that non-result.

**The exemption is a selector list, not a heuristic.** Rejected: exempting by computed `display`, which would silently exempt real buttons as the codebase changes.

**Coverage is a data-driven invariant sweep, not a second Playwright project.** Rejected: re-running every existing spec at a mobile viewport, which roughly doubles a single-worker suite that already runs long, mostly to re-test logic that does not depend on viewport. Also rejected: a hand-written test per page, where coverage stops at the pages someone thought to enumerate.

**The harness is built before the fixes.** Its red output is the defect list of record. The audit table above was measured with a throwaway probe that is not part of the deliverable.
