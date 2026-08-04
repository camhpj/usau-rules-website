# Test Coverage Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the coverage gaps left by tranches 1-3, and make CI trustworthy by fixing two flaky end-to-end tests.

**Architecture:** Mostly new test files alongside the code they cover, following the existing `*.test.ts` convention. Two exceptions: a Playwright config change for flake retries, and a new dev-server smoke test that boots `npm run dev` and fetches a page.

**Tech Stack:** Vitest (`environment: 'node'`), Playwright, SvelteKit 2, Svelte 5 runes, Drizzle/D1.

This is tranche 4 of `docs/superpowers/specs/2026-07-27-codebase-improvement-design.md`.

## What is NOT here, and why

The spec's tranche 4 list is partly stale. Three of its items were closed
incidentally by tranches 3a and 3b. Verified against current `main`:

| spec item | where it was already covered |
|---|---|
| Leaderboard ranking with 3+ competitors | `src/lib/server/leaderboard.test.ts:18,46,109` |
| The localStorage quota regression | `src/lib/quiz/storage.test.ts:80,100,125` |
| Rollback paths in bookmarks and conversations | `bookmarks.svelte.test.ts`, `conversations.svelte.test.ts:92,107,122` |

Do not re-add them. If a task below appears to duplicate one, stop and ask.

Two further items were considered and dropped by the owner as costing more
than they catch. Both are recorded as accepted risks in the spec:

- **Screenshot/appearance testing.** Brittle across platforms and font
  rendering; the usual outcome is a suite people stop trusting.
- **Google OAuth end-to-end.** Needs either live credentials in CI or a stub
  identity provider so heavy it mostly tests itself.

## Global Constraints

- `npm run check`, `npm run test`, and `npx prettier --check .` stay green at every commit.
- Code under `src/` runs on Cloudflare Workers. No Node built-ins there. Test files and anything under `scripts/` run in Node and may use them.
- No new **runtime** dependencies. A dev-only dependency is acceptable only if a task cannot be done without one, and must be justified in that task's report.
- No database migration. No production behaviour change.
- **This tranche adds tests. It does not change application code**, with two exceptions, each explicitly scoped: Task 2 may change `playwright.config.ts`, and Task 4 may export a predicate from `src/hooks.server.ts`. Any other production edit means you have found a bug — stop and report it rather than fixing it silently.
- Test baseline: **328 tests / 47 files**, 70 Playwright. The unit count must rise.
- `.npmrc` carries `min-release-age=7`. Do not remove it. If it blocks an install, report rather than working around it.

## A standing rule for every task

**A test that cannot fail is not coverage.** For each test you write, state in
your report whether it would fail against a deliberately broken implementation,
and how you know. Where a task names a specific mutation, apply it, watch the
test fail, then revert it.

This project has shipped three non-discriminating tests that were caught only
in review. Treat this as the main deliverable, not paperwork.

---

### Task 1: Fix the two flaky e2e tests, and add CI retries

CI has failed four times on timing, never on an assertion. Two distinct tests:

- `e2e/ai.spec.ts` — `conversation history (seeded D1)`, failed three times with `watchdog: no answer text within budget`, `watchdog: stream exceeded max duration`, and a 60s page timeout. Predates this work.
- `e2e/admin.spec.ts` — `export: users CSV omits secrets`, failed once with `socket hang up` on a sign-up POST, then passed unchanged on re-run.

Both block merges and cost a manual re-run each time.

**Files:**
- Modify: `playwright.config.ts`
- Modify: `e2e/ai.spec.ts`, `e2e/admin.spec.ts` (only if you find a real cause)

- [ ] **Step 1: Add retries on CI only**

```ts
retries: process.env.CI ? 2 : 0,
```

Local runs keep zero retries, so a flake you introduce while developing still
shows up immediately. Put a comment above it naming the two tests this exists
for, so a future reader knows it is a known-flake mitigation and not a default.

- [ ] **Step 2: Investigate the actual causes**

Retries hide the problem; they do not fix it. Spend real effort here.

For the `ai.spec.ts` watchdog failures: read `chat-stream.svelte.ts`'s stall
timer and the watchdog budget in `src/lib/server/ai/config.ts`. Determine
whether the budget is simply too tight for a cold CI runner, or whether the
test is racing its own fixture setup.

For the `admin.spec.ts` socket hang up: it failed on the FIRST request of the
7th test, right after a test that pages through admin AI review. A `socket hang
up` means the dev worker closed the connection. Determine whether the preceding
test leaves a request or stream open.

Report your findings for both, even if you cannot fix them. A precise "this is
a cold-start timing budget, not a bug" is a useful result.

- [ ] **Step 3: Fix what you can, without weakening assertions**

Increasing a timeout is acceptable where the evidence says the budget is too
tight. Deleting or loosening an assertion to make a test pass is not — if that
seems like the only option, stop and report.

- [ ] **Step 4: Verify**

Run: `npx playwright test` three times in a row. Report the results of all
three. If any run fails, report which test and why rather than re-running until
green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: retry known-flaky e2e on CI, and fix what causes them"
```

---

### Task 2: Unit tests for `chat-stream.svelte.ts`

277 lines, no test file, and the most branch-heavy client code in the app. It
owns NDJSON stream parsing, a stall watchdog, abort handling, a concurrency
cap, and five status-code branches.

**Files:**
- Create: `src/lib/ask/chat-stream.test.ts`
- Read: `src/lib/quiz/sync.test.ts` for the established `globalThis.fetch` stubbing pattern

**Interfaces:**
- Consumes: `ChatStreamState`, `StreamJob`, `MAX_CONCURRENT_STREAMS`, `SendResult` from `./chat-stream.svelte`.

- [ ] **Step 1: Read the module and map its branches**

List every distinct outcome `send()` can produce and every early return.
Put the list in your report. You are aiming to cover them, so you need to know
what they are before writing tests.

- [ ] **Step 2: Write tests covering, at minimum**

1. **NDJSON split across chunk boundaries.** A single JSON line delivered in two chunks must parse once. This is the highest-value case: a naive line-splitter passes a whole-line test and fails this one.
2. **A trailing line with no newline terminator** must still be handled at stream end.
3. **The stall watchdog** fires when no data arrives within the budget, and does not fire when data keeps arriving.
4. **Abort mid-stream** — `stop(job)` — leaves partial text and reports the stopped-by-user outcome rather than an error.
5. **Truncation** — a `{t:'truncated'}` fragment surfaces as truncated, not as success.
6. **The concurrency cap** — `MAX_CONCURRENT_STREAMS` is 3; a 4th concurrent send is refused.
7. **Each error status branch** (429, 400, 409, 503, 401/404) maps to its own user-facing message. Assert the actual strings, copied from the source.
8. **Headers** — `x-bp-ai-remaining`, `x-bp-conversation-id`, `x-bp-message-id` are read and applied.

Build a `ReadableStream` from an array of `Uint8Array` chunks so you control
exactly where the boundaries fall. Do not test through a real network.

- [ ] **Step 3: Prove case 1 discriminates**

Deliberately break the line-buffering so it assumes each chunk is a whole line.
Confirm the split-boundary test fails. Revert. Report the failure message you
saw.

- [ ] **Step 4: Verify and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "test: cover chat-stream's parsing, watchdog, abort, and error branches"
```

---

### Task 3: Exercise the real `/api/ai/chat` handler

The handler that owns quota enforcement, conversation persistence, the message
cap, and streaming has never executed in any test. Unit tests mock below it;
`e2e/ai.spec.ts` intercepts the route with `route.fulfill`.

This task covers the handler's logic up to the point where it calls Gemini.
Gemini itself stays mocked — the spec already records the live HTTP contract as
an accepted risk.

**Files:**
- Create: `src/routes/api/ai/chat/server.test.ts` (or the closest location matching this repo's convention for route tests — check whether any route is tested today and follow it; if none is, say so and put it beside the route)
- Read: `src/routes/api/ai/chat/+server.ts`

- [ ] **Step 1: Determine what the handler needs injected**

It reads `locals.db`, `locals.auth`, `platform.env`, and the request. Work out
the smallest fake that lets the handler run. If the handler cannot be invoked
without a real D1, say so plainly and report what would be needed — do not
build an elaborate mock cathedral.

- [ ] **Step 2: Cover, at minimum**

1. **The message cap.** `prior.length >= CONVERSATION_MESSAGE_CAP` returns 400 with `'This conversation is full — start a new one'`. Assert the exact string.
2. **The cap does NOT apply to a retry.** A retry body reaches `pickRetryTarget` instead. This asymmetry is easy to break and nothing covers it.
3. **Quota exhaustion** returns 429 with the route's message, and the counter is incremented exactly once on a successful request.
4. **Ownership.** A conversation id belonging to another user returns 404, indistinguishable from a missing one.
5. **The single body read.** This route reads the request body ONCE and shares it across two `safeParse` calls. A test that sends a valid retry body and a test that sends a valid new-message body must both work — that pins the shared-read behaviour that made this route a deliberate non-candidate for `parseJsonBody`.

- [ ] **Step 3: Verify and commit**

```bash
git add -A
git commit -m "test: exercise the real /api/ai/chat handler"
```

---

### Task 4: Assert every dynamic route is in the hooks allowlist

`src/hooks.server.ts` populates `locals.db` and `locals.auth` only for paths
matching its allowlist. A new server route outside that list compiles fine and
fails at runtime. `requireDb`/`requireAuth` turn that into a clear 500, but
nothing catches it before deploy.

Note: `src/lib/server/session.test.ts` covers the ADMIN EMAIL allowlist, which
is a different thing. Do not confuse them.

**Files:**
- Modify: `src/hooks.server.ts` (export the predicate — the only production change this task may make)
- Create: `src/hooks.server.test.ts`

- [ ] **Step 1: Extract and export the predicate**

The `dynamic` boolean is currently computed inline. Lift it to an exported
function, for example `isDynamicRoute(pathname: string): boolean`, and have
`handle` call it. Behaviour must be identical.

- [ ] **Step 2: Write the test that imports the predicate**

The test must **import** `isDynamicRoute`, never restate the path list. A test
that hardcodes its own copy of the allowlist passes forever while the real one
drifts.

Enumerate the app's server routes by walking `src/routes` for `+server.ts`,
`+page.server.ts`, and `+layout.server.ts` files, convert each to its URL path
(`[param]` → any placeholder), and assert `isDynamicRoute` returns true for
each. Use `fs` — this is a test file running in Node, so that is allowed.

- [ ] **Step 3: Prove it discriminates**

Add a throwaway `src/routes/zzz-probe/+server.ts`, run the test, and confirm it
FAILS naming that route. Delete the probe. Report the failure message.

This is the whole point of the task. A test that passes whatever you add is
worthless here.

- [ ] **Step 4: Verify and commit**

```bash
git add -A
git commit -m "test: assert every server route is matched by the hooks allowlist"
```

---

### Task 5: A dev-server smoke test

Nothing exercises `npm run dev`. Unit tests import modules directly and
Playwright runs `npm run build && wrangler dev`, so a dev-only break passes the
full gate. This is not hypothetical: a non-eager `import.meta.glob` added in
tranche 2 made every rule section 404 under `npm run dev` while CI stayed
green, and it reached the owner's machine.

**Files:**
- Create: `e2e/dev-server.spec.ts`, or a standalone script under `scripts/` — implementer's choice
- Modify: `.github/workflows/ci.yml` if the check needs its own step

- [ ] **Step 1: Decide the mechanism and justify it**

Two workable shapes:

- A Playwright project with its own `webServer` running `npm run dev` on a different port, containing one test.
- A small Node script that spawns `npm run dev`, polls until it responds, fetches one rule section page, asserts the content rendered, and exits non-zero otherwise.

The script is likely simpler and avoids entangling the main Playwright config,
which currently assumes a single `wrangler dev` on port 8787. Pick one, say
why, and keep it small.

- [ ] **Step 2: Assert on rendered content, not a 200**

The tranche 2 bug returned a page; the *section content* 404'd underneath.
A status-code check would have passed. Assert that actual rule text from the
section appears in the response body.

- [ ] **Step 3: Prove it discriminates**

Temporarily remove `content` from `server.fs.allow` in `vite.config.ts` — that
is the exact tranche 2 breakage. Confirm the smoke test fails. Restore it.
Report what you saw.

- [ ] **Step 4: Wire it into CI**

Add a step to `.github/workflows/ci.yml`. Place it before the e2e step. Keep
the runtime small; this should be seconds, not minutes.

- [ ] **Step 5: Verify and commit**

```bash
git add -A
git commit -m "test: smoke-test the dev server, which nothing exercised"
```

---

### Task 6: The remaining assertion-level gaps

Four small, independent tests plus one deletion. One commit.

**Files:**
- Modify: `src/lib/server/ai/history.test.ts`
- Modify or create: a test for `src/routes/api/attempts/+server.ts`'s section check
- Modify: `src/lib/server/admin/datasets.test.ts` if it exists, else create it
- Modify: `src/lib/quiz/types.test.ts`

- [ ] **Step 1: Keyset paging across a tie**

`src/lib/server/ai/history.test.ts` covers cursor parsing but never paging
across duplicate cursor values. Two rows sharing an `updatedAt` that straddle a
page boundary must both appear exactly once — neither dropped nor repeated.
This is the bug the compound `(updated_at, id)` cursor exists to prevent.

Test `pageRows` and the cursor derivation together against a row set with a
deliberate tie at the boundary.

- [ ] **Step 2: `/api/attempts` section mismatch**

`src/routes/api/attempts/+server.ts:32-35` rejects a payload whose
`sectionSlug` does not match the answered questions, with
`'sectionSlug does not match the answered questions'`. Nothing covers it.
Assert the 400 and the exact message, and assert that a matching payload passes.

- [ ] **Step 3: Streaming CSV chunk boundary**

`src/lib/server/admin/csv.test.ts` covers the formatter, not the streaming
route's paging. `CHUNK_SIZE` is 2000 in
`src/routes/admin/export/[dataset].csv/+server.ts`.

Test the paging behaviour: a dataset larger than one chunk emits every row
exactly once, in order, with the header emitted exactly once. Test at the
`datasets.ts` cursor-paging layer rather than by streaming a real 2000-row
response, unless you can do the latter cheaply.

- [ ] **Step 4: Delete the tautological assertion**

`src/lib/quiz/types.test.ts:28` asserts `DIFFICULTY_LABELS[3]` equals
`'Observer'` — a restatement of a constant. Delete that line. If deleting it
empties its enclosing `it()`, delete the block too.

Test count arithmetic: this removes coverage that was never coverage. Report
the net change honestly rather than backfilling to keep the number up.

- [ ] **Step 5: Verify and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "test: keyset tie, section mismatch, CSV chunk paging; drop a tautology"
```

---

## Verification

After Task 6:

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

Then report:

- Test count before and after, and the count of test FILES. The baseline is 328 / 47.
- For each task, which tests were proven to discriminate and how.
- Whether the three flaky-test runs in Task 1 Step 4 all passed.
- Any production bug found while writing tests. Finding one is a good outcome; fixing it silently in a test PR is not.

## Decision log

**Screenshot testing and OAuth end-to-end were dropped**, not deferred. Both
cost more than they catch: screenshot suites are brittle across platforms and
tend to be ignored once they flake, and OAuth in CI needs live credentials or a
stub that mostly tests itself. Recorded as accepted risks in the spec.

**Three spec items were dropped as already done.** Tranches 3a and 3b closed
them incidentally. Verified individually against `main` rather than assumed.

**Retries are a mitigation, not the fix.** Task 1 requires investigating both
flaky tests even though the retry makes CI green either way. A retry that hides
a real intermittent bug is worse than the flake.

**Gemini stays mocked in Task 3.** The task covers the handler's own logic —
quota, cap, ownership, persistence. The live Gemini HTTP contract remains an
accepted risk already recorded in the spec.
