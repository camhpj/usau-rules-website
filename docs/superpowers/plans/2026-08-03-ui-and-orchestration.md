# Centralization (UI half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace copy-pasted UI markup with four shared components and one CSS utility, move two pages' orchestration into testable modules, and close the optimistic-update and silent-failure gaps left in `/me`.

**Architecture:** Components go in `src/lib/components/`, matching the existing typed-`$props()` convention. The `eyebrow` utility joins the `@utility` block in `src/app.css`. Page orchestration moves to `.svelte.ts` classes that each page instantiates per mount, rather than the singleton pattern the existing `.svelte.ts` modules use.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind CSS v4, TypeScript, Vitest, Playwright.

This is the second of two plans covering tranche 3 of
`docs/superpowers/specs/2026-07-27-codebase-improvement-design.md`. The first
(`2026-07-30-centralization-logic.md`) shipped the logic half as PR #8. This
branch stacks on it.

## Research

Gathered directly against this branch on 2026-08-03. Counts below are verified,
not estimates from the spec.

| item | verified |
|---|---|
| `eyebrow` class repeats | 19 across 14 files, 3 colour variants |
| CTA buttons at the shared size | 13 — 9 filled, 4 outline; 11 `<button>`, 2 `<a>` |
| Auth gates | 2, identical mechanism |
| Promo cards in scope | 3 (home ×2, quiz index ×1) |
| Toggle pill blocks | 3 (quick sections, quick difficulties, scenario difficulty) |
| Ask page / timed page | 334 / 327 lines |

## Global Constraints

- `npm run check`, `npm run test`, and `npx prettier --check .` stay green at every commit.
- Code under `src/` runs on Cloudflare Workers. No Node built-ins.
- No new dependencies. No database migration.
- **No visual change.** Every component must render byte-identical markup to what it replaces, including the full Tailwind class string and every aria attribute. This plan is a refactor, not a redesign. Where a call site differs from its siblings, the component takes a prop rather than normalising the difference away.
- Test baseline entering the plan: 294 tests / 44 files.
- The e2e suite is the safety net for the component work. `npx playwright test` must stay at 70 passing.

## Scope decisions already made

The owner settled these; do not re-argue them.

- All five UI items are in scope.
- **Admin filter pills stay out of `TogglePill`.** They are `<a href>` links driven off URL params with their own colour system; absorbing them needs an `href` escape hatch plus a dark variant, each for one caller.
- **The rules-index card stays out of `PromoCard`.** It diverges on icon, padding, hover distance, and an extra badge slot.

---

### Task 1: The `eyebrow` utility

19 occurrences of the same four-class fragment across 14 files. The colour is
not part of it: 10 use `text-navy/50`, 6 use `text-cardinal`, 3 use
`text-white/50`. The utility covers the invariant part and colour stays a
sibling class.

**Files:**
- Modify: `src/app.css`
- Modify: the 14 files listed by `rg -l 'tracking-\[0\.18em\]' src/`

**Interfaces:**
- Produces: an `eyebrow` utility class.

- [ ] **Step 1: Add the utility**

`src/app.css` declares custom utilities as `@utility name { }` with plain CSS
and a purpose comment above. Match that exactly. Add near the other utilities:

```css
/* small-caps label above a heading; colour stays a sibling class */
@utility eyebrow {
	font-size: var(--text-xs);
	line-height: var(--text-xs--line-height);
	font-weight: 600;
	letter-spacing: 0.18em;
	text-transform: uppercase;
}
```

Verify those `--text-xs` variables resolve in this Tailwind v4 setup before
relying on them. If they do not, use the literal values Tailwind's `text-xs`
emits (`0.75rem` / `1rem`) and say so in your report.

- [ ] **Step 2: Replace the four invariant classes at all 19 sites**

`text-xs font-semibold tracking-[0.18em] uppercase` becomes `eyebrow`. **Keep
the colour class**, so `text-xs font-semibold tracking-[0.18em] text-navy/50
uppercase` becomes `eyebrow text-navy/50`.

- [ ] **Step 3: Confirm none remain**

Run: `rg -n 'tracking-\[0\.18em\]' src/`
Expected: zero matches.

- [ ] **Step 4: Verify nothing moved visually**

Run: `npm run build && npx playwright test`
Expected: build ok, 70 passing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: eyebrow utility for the repeated label style"
```

---

### Task 2: `Button`

13 call sites share one size (`px-6 py-2.5 text-sm`). Two variants: filled
(`bg-cardinal`, 9 sites) and outline (`border-navy/30`, 4 sites). Eleven are
`<button>`, two are `<a>`. Five of the filled ones carry
`disabled:opacity-40`.

One component with an optional `href`, not two components. The two `<a>` sites
are the same visual control with a different activation mechanism, and
splitting them would mean keeping two class strings in sync.

**Files:**
- Create: `src/lib/components/Button.svelte`
- Modify: the 6 files carrying the 13 call sites

**Interfaces:**
- Produces:

```ts
{
	variant?: 'filled' | 'outline';   // default 'filled'
	href?: string;                    // renders <a> when present, <button> otherwise
	type?: 'button' | 'submit';       // <button> only, default 'button'
	disabled?: boolean;
	onclick?: () => void;
	class?: string;                   // extra classes, appended
	children: Snippet;
}
```

- [ ] **Step 1: Read an existing component for the convention**

Read two or three components in `src/lib/components/` and match their style:
how `$props()` is typed, how `children` is declared, whether a `class` prop is
merged and how. Do not invent a new convention. Quote the one you followed in
your report.

- [ ] **Step 2: Write the component**

The two class strings, verbatim from the call sites:

```
filled:  rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110
outline: rounded-full border border-navy/30 px-6 py-2.5 text-sm font-semibold tracking-wider text-navy uppercase hover:border-navy
```

`disabled:opacity-40` is appended whenever the element can be disabled, which
is every `<button>`. Confirm that leaves the four non-disabled filled `<button>`
sites rendering identically — an unused `disabled:` variant emits no styles
unless the element is actually disabled, so it should. Verify rather than
assume, and report what you found.

- [ ] **Step 3: Adopt at all 13 sites**

Each site keeps its own `onclick`, `disabled` expression, and label. Extra
positioning classes (`w-full`, `mt-4`) pass through `class`.

- [ ] **Step 4: Confirm the class strings are gone**

Run: `rg -n 'px-6 py-2\.5 text-sm font-semibold' src/ --glob '!**/Button.svelte'`
Expected: zero matches. Report any that remain with the reason.

- [ ] **Step 5: Verify and commit**

Run: `npm run check && npm run test && npx prettier --check . && npx playwright test`

```bash
git add -A
git commit -m "refactor: shared Button for the call-to-action controls"
```

---

### Task 3: `AuthGate`

`src/routes/ask/+layout.svelte` and `src/routes/quiz/scenario/+page.svelte`
both gate on sign-in with the identical mechanism: `authClient.useSession()`
inside `onMount`, tracked by a `sessionReady` flag. They differ only in
`callbackURL` and the copy.

**Files:**
- Create: `src/lib/components/AuthGate.svelte`
- Modify: `src/routes/ask/+layout.svelte`, `src/routes/quiz/scenario/+page.svelte`

**Interfaces:**
- Produces:

```ts
{
	callbackURL: string;   // where Google returns the user
	heading: string;
	children: Snippet;     // rendered once signed in
}
```

- [ ] **Step 1: Read both sites in full**

Note every difference, including the pending state each renders before the
session resolves. If they differ there too, the component needs a prop or a
snippet for it — say which you chose.

- [ ] **Step 2: Write the component**

Move the `onMount` session subscription and its teardown inside. Preserve the
unsubscribe: leaking a session subscription per mount is a real regression.

- [ ] **Step 3: Adopt at both sites**

- [ ] **Step 4: Verify and commit**

The e2e suite covers both gates. Run `npx playwright test e2e/ai.spec.ts` and
report the count.

```bash
git add -A
git commit -m "refactor: shared AuthGate for the two sign-in gates"
```

---

### Task 4: `PromoCard` and `TogglePill`

Two small components, one commit. Both are mechanical.

**`PromoCard`** — 3 sites in scope: two in `src/routes/+page.svelte`, one in
`src/routes/quiz/+page.svelte`. The rules-index card and the
`rules/[ruleset]` card stay as they are.

**`TogglePill`** — 3 blocks, byte-identical markup: quick's section pills and
difficulty pills (both multi-select), scenario's difficulty pills
(single-select, including a `null` "any" option). All are `<button
type="button">` with `aria-pressed` and a selected/unselected class ternary.
The component takes `selected` and `onclick` and owns no state.

**Files:**
- Create: `src/lib/components/PromoCard.svelte`, `src/lib/components/TogglePill.svelte`
- Modify: `src/routes/+page.svelte`, `src/routes/quiz/+page.svelte`, `src/routes/quiz/quick/+page.svelte`, `src/routes/quiz/scenario/+page.svelte`

**Interfaces:**
- Produces:

```ts
// TogglePill
{ selected: boolean; onclick: () => void; children: Snippet }
```

Derive `PromoCard`'s props from the three call sites. If the two home cards
and the quiz card need more than about four props between them, stop and
report — that is the signal they are not the same component.

- [ ] **Step 1: `TogglePill`, with its exact class string**

```
rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors
selected:   border-navy bg-navy text-white
unselected: border-mist text-navy/70 hover:border-navy/40
```

`aria-pressed={selected}` must survive — it is the only thing telling a screen
reader these are toggles.

- [ ] **Step 2: Adopt at the 3 pill blocks**

Selection state stays in the pages. Scenario's is single-select and quick's two
are multi-select; the component does not care, and must not.

- [ ] **Step 3: `PromoCard`, then adopt at the 3 card sites**

- [ ] **Step 4: Verify and commit**

Run the full gate plus `npx playwright test`.

```bash
git add -A
git commit -m "refactor: shared PromoCard and TogglePill"
```

---

### Task 5: Fix `/me`'s optimistic updates and its silent failures

**This task is not in the original spec.** It closes a gap the logic half
missed: that plan's research covered client modules under `src/lib` and never
looked in `src/routes`, so these two call sites were never inventoried.

`src/routes/me/+page.svelte` has two optimistic updates, `removeBookmark`
(lines 38-51) and `removeName` (lines 53-62). Both have the exact defect
`createKeyedMutex` was built to fix, and both fail silently:

- They snapshot (`const prev = marks`) and restore on failure (`marks = prev`), discarding any concurrent change rather than applying an inverse.
- They do not serialize, so two rapid removals race.
- They use raw `fetch` rather than `safeFetch`.
- On failure the row silently reappears with no explanation.

**Files:**
- Modify: `src/routes/me/+page.svelte`
- Create: `src/routes/me/page-state.svelte.ts` only if the logic does not fit cleanly in the component — implementer's choice, say which you picked and why

**Interfaces:**
- Consumes: `safeFetch` from `$lib/fetch`, `createKeyedMutex` from `$lib/optimistic`.

- [ ] **Step 1: Read `src/lib/optimistic.ts` and one adopting call site**

`src/lib/bookmarks.svelte.ts` shows the pattern. The rule that matters: every
read of current state happens INSIDE the serialized task, and the revert is an
inverse computed from live state, never a restored snapshot.

- [ ] **Step 2: Rewrite `removeBookmark`**

Serialize on the bookmark key. Read `marks` inside the task. On failure,
re-insert that one bookmark into the current array rather than restoring the
old one, preserving the existing order.

- [ ] **Step 3: Rewrite `removeName`**

Serialize on a constant key — there is only one display name, so any two
removals contend. Revert by restoring the name into current state.

- [ ] **Step 4: Surface both failures**

Add `errorMessage: string | null`, matching the six sites that already use that
exact shape. Render it the way this page's siblings do — read one first and
match its markup and aria attributes rather than inventing a treatment.

Copy: `"Couldn't remove that bookmark — try again."` and `"Couldn't remove your
name — try again."`

- [ ] **Step 5: Write the tests these paths never had**

Cover, at minimum:

1. `removeBookmark` fails and the bookmark returns to its original position.
2. `removeBookmark(a)` is in flight when an unrelated change lands; the removal fails; the unrelated change survives.
3. `removeName` fails, the name comes back, and `errorMessage` is set.
4. Two rapid `removeBookmark` calls on the same key resolve to one consistent final state.

If a test passes against the pre-fix code, it is not testing the bug — say so
and fix the test.

- [ ] **Step 6: Verify and commit**

```bash
git add -A
git commit -m "fix: /me optimistic removals no longer clobber or fail silently"
```

---

### Task 6: Extract the ask page's orchestration

`src/routes/ask/[[id]]/+page.svelte` is 334 lines. Its request lifecycle and
race guards are untestable inside a `.svelte` file.

**Files:**
- Create: `src/lib/ask/ask-page.svelte.ts`, `src/lib/ask/ask-page.test.ts`
- Modify: `src/routes/ask/[[id]]/+page.svelte`

**Interfaces:**
- Produces: an exported **class**, not a singleton instance.

Every existing `.svelte.ts` module here exports a singleton
(`export const bookmarks = new BookmarksStore()`). **Do not follow that here.**
This state is per-page-mount: a singleton would carry one visit's generation
counters and in-flight guards into the next, so a stale response could land
against a freshly mounted page. Export the class; the page does `new
AskPageState(...)` in its `<script>`.

- [ ] **Step 1: Map the file before changing it**

List every `$state`, `$derived`, `$effect`, and function with its line number,
and mark each as orchestration or view binding. Put the map in your report.
Orchestration moves; view binding stays.

- [ ] **Step 2: Read the convention**

`src/lib/ask/conversations.svelte.ts` and `src/lib/ask/chat-stream.svelte.ts`
show how a class holds `$state` fields, uses `#`-private members, and exposes
computed values as plain getters. Match it, except for the singleton export.

- [ ] **Step 3: Move the orchestration**

Everything the class needs — the initial conversation id from `page.params`,
page data — is injected through the constructor. The class must not import
`$app/state`; that keeps it testable in `environment: 'node'`.

- [ ] **Step 4: Write the tests the extraction unlocks**

At least four, covering behavior that was unreachable before. Aim at the race
guards: a response arriving after the user navigated to a different
conversation must not apply; a second send while one is in flight; an error
mid-stream leaving recoverable state.

- [ ] **Step 5: Verify and commit**

Run the full gate plus `npx playwright test e2e/ai.spec.ts`. The e2e suite is
what proves the page still works.

```bash
git add -A
git commit -m "refactor: extract the ask page's orchestration into a testable module"
```

---

### Task 7: Extract the timed quiz page's orchestration

`src/routes/quiz/timed/+page.svelte` is 327 lines with 14 `$state` fields and
a `runGeneration` counter guarding four separate await points.

**Files:**
- Create: `src/lib/quiz/timed-run.svelte.ts`, `src/lib/quiz/timed-run.test.ts`
- Modify: `src/routes/quiz/timed/+page.svelte`

**Interfaces:**
- Consumes: the class-not-singleton decision from Task 6, for the same reason.
- Produces: an exported class.

- [ ] **Step 1: Map the file, as in Task 6 Step 1**

- [ ] **Step 2: Document the `runGeneration` guard before moving it**

It appears at four await points in `resolveBoardStatus` and around the bank
load. Write down, in your report, exactly which concurrent sequence each guard
protects against. Moving a guard you have not understood is how they get
subtly broken.

Also confirm and preserve one ordering: the run token is minted **after** the
question bank resolves. The reverse ordering spent the server's grace window on
a slow network fetch and silently voided completed runs. There must be no
network wait between the mint and the clock starting.

- [ ] **Step 3: Move the orchestration**

`boardError` and `errorMessage` are two different concerns in this file —
bank-load failure and leaderboard-lookup failure — rendered under different
ARIA roles. Keep them separate. Do not unify the names.

- [ ] **Step 4: Write the tests**

At least five. The generation guard is the point: a leaderboard response
arriving after the user started a new run must not write to the new run's
state. That is impossible to test today and is the whole reason for this task.
Also cover the mint-after-bank ordering.

- [ ] **Step 5: Verify and commit**

Run the full gate plus `npx playwright test e2e/timed-sync.spec.ts e2e/leaderboard.spec.ts`.

```bash
git add -A
git commit -m "refactor: extract the timed run's orchestration into a testable module"
```

---

## Verification

After Task 7:

```bash
npm run check
npm run test
npx prettier --check .
npm run check:scripts
npm run check:e2e
npm run validate:content
npm run build
npx playwright test
```

Then report honestly:

- Net LOC: `git diff --stat <base>..HEAD`, split into source, tests, and docs. The component work is expected to be roughly LOC-neutral — the value is one definition per pattern, not fewer lines. Do not report a reduction that did not happen.
- Test count before and after. Tasks 5, 6, and 7 all add tests.
- Confirm the e2e suite is still at 70 passing. That is the only automated proof the components render identically.

## Decision log

**The error-surfacing item is narrower than the spec described.** The spec
called for standardising error state on `errorMessage: string | null`. That is
already the convention: six sites use exactly that shape and all six render.
There is no sprawl to unify. The real gap is two handlers in `/me` that fail
silently, which Task 5 fixes. `boardError` in the timed page is deliberately
left alone: it is a different concern from the `errorMessage` in the same
component, rendered under a different ARIA role, so renaming it would collide.

**Orchestration modules export a class, not a singleton.** Against the
precedent of every existing `.svelte.ts` module here, because their state is
per-mount rather than app-wide.

**Task 5 was added to this plan.** It is not in the spec. The logic half's
research scoped optimistic updates to `src/lib`, so these two `src/routes`
call sites were never inventoried and kept the defect that plan set out to
remove.

**`Button` is one polymorphic component, not two.** Two of thirteen sites are
`<a>`. Splitting on element type would put the same class string in two files.
