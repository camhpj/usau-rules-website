# Codebase improvement pass — design

**Date:** 2026-07-27
**Status:** Approved approach

## Problem

The app reached feature completeness across four phases in a few weeks, almost
entirely through AI-written code. Each session worked in isolation, so the same
concept sometimes landed two or three different ways, and cost problems that
only appear at scale went unnoticed because there is no scale yet.

A six-way parallel review covered components, server and API code, client
library modules, tests, performance, and cross-cutting architecture. It found no
security holes: admin authorization, conversation ownership checks, and the
HMAC-signed timed-run path all hold. The test suite is curated rather than
padded, and almost nothing in it is worth deleting. Several patterns the review
expected to find drifted are in fact single-sourced on purpose, including the
four `payload.ts` modules, localStorage key namespacing, and type sharing across
the `scripts/` and `src/` boundary.

What it did find falls into four groups.

**Content ships to every browser that does not need it.** Two eager
`import.meta.glob` calls force Vite to bundle all generated content into the
client. Measured from the current build output: every `/rules/[ruleset]/[section]`
view downloads all 23 sections as `4PmG3W_Q.js`, 351,569 bytes raw and 65,439
gzipped. Every `/quiz/*` view downloads all 213 questions across 24 chunks,
189,268 bytes raw and roughly 55,865 gzipped. Reading the one-page introduction
downloads the entire rulebook. A ten-question quick quiz downloads the entire
bank and filters in JavaScript. The search index already avoids this by fetching
per ruleset at runtime, so the correct pattern is established elsewhere in the
app. Cost multiplies with each ruleset added.

**One bug loses user data.** In `src/lib/quiz/local.ts`, `writeRaw` mirrors every
write into an in-memory map and swallows `localStorage` failures. `readRaw` falls
back to that map only when `getItem` throws or returns null. After a
quota-exceeded write the key still holds the previous value, so `getItem`
succeeds and returns stale data. The newer quiz result disappears with no error.
The existing test misses this because it never seeds a prior successful write.

**Read-heavy queries scan whole tables.** `/api/leaderboard` is public,
uncached, and filters `mode` and `ruleset_id` against an index covering neither,
so each request scans `quiz_attempts` in full. Admin metrics pulls two entire
tables into the Worker to compute distinct users in a JavaScript `Set`. Neither
cost is bounded by the requesting user's own data. The admin area compounds
this: the AI review page is paginated but its two aggregate subqueries are not,
so every page costs a full pass over `ai_messages`, and the export page runs six
full-table counts per load.

**Roughly 350 lines are duplication.** Around 15 interface and Zod schema pairs
are maintained by hand where `z.infer` would derive one from the other. Five
call sites hand-roll the same fetch-and-degrade sequence. One call-to-action
class string is copy-pasted 13 times, and the sign-in gate twice.

## Goals

Fix the correctness bugs, cut the payload and query costs that grow with usage,
collapse the duplication, and close the test gaps that would let a real
regression ship. Hold the existing green baseline throughout: `svelte-check`
clean, 217 unit tests passing, Prettier clean, e2e passing.

## Non-goals

Reorganizing directories for taste. Adding component-test infrastructure, since
the Playwright suite already covers component behavior well and a jsdom setup
would duplicate it. Rewriting the ask page's data flow, for the reasons in the
decision log.

## Decisions

**The global AI budget is removed.** `AI_GLOBAL_DAILY` capped all users combined
at 200 requests per day, so 20 users at their personal limit exhausted the site.
The Google Cloud balance has auto-reload off, which is already a hard ceiling.
The per-user cap of 10 per day stays. The counter, its `ai_usage` global query,
and the tests covering it go with it.

**Prerendered pages keep fetching their dynamic data client-side.** `/leaderboard`,
`/quiz/timed`, and `/quiz/scenario` are prerendered; `leaderboard.html` is in the
build output today. Moving them to server load functions would un-prerender them
and turn every page view into a Worker invocation plus a D1 query. Only the error
handling is unified.

**Sessions get a pruning cron.** A `triggers.crons` entry plus a scheduled
handler deleting rows where `expires_at` has passed. This is the project's first
scheduled Worker. Analytics tables are left alone.

**CSV exports stream in full, with no row cap.** Today the export returns the
newest 10,000 rows and buffers the whole file into one string. Older rows are
unreachable through the UI. The intended design was to split large exports
across numbered files, but no offset support was ever implemented. Streaming the
response removes the memory limit that motivated splitting, so the export
becomes one complete file: a `ReadableStream` emitting CSV rows while a keyset
cursor pages D1 in chunks. `EXPORT_MAX_ROWS` is removed.

**Merged git state is deleted.** Three worktrees under `.claude/worktrees/` and
five remote branches, all verified as already in `main`. The `admin-dashboard`
worktree looks unmerged to `git merge-base` but was squash-merged as `f3b3dd8`;
its only diff against `main` is deletions of files `main` already has.

## Work

Five tranches. Each is independently shippable and leaves the baseline green.
Line counts are estimates from the review, not measurements.

### 1. Correctness

Ordered by user impact.

- **localStorage quota data loss.** `src/lib/quiz/local.ts:11-28`. On a failed
  write, evict the key so a later read falls through to the in-memory value
  instead of the stale one. Add a regression test that seeds a successful write
  first, which is the case the current test omits.
- **Gemini calls without timeouts.** `src/lib/server/ai/gemini.ts:66-86,137-175`.
  `createCache` and `generateText` have no abort or timeout, so a hang in either
  runs until the platform kills the request. `streamText` creates its watchdogs
  at line 246, after `callWithCacheFallback` resolves at line 235, leaving the
  cache-creation phase unprotected even for chat. Give the non-streaming paths
  their own controller and timeout, and move `streamText`'s controller ahead of
  the cache-fallback call.
- **Display-name writes misreport failures.** `src/routes/api/profile/display-name/+server.ts:66-79`.
  The catch-all treats any write failure as a name conflict, so a transient D1
  error tells the user their chosen name is taken. Inspect the error for the
  unique-constraint signature and rethrow anything else. The retry path's own
  update at line 78 is unguarded.
- **Timed-run leaderboard nudge fails silently.** `src/routes/quiz/timed/+page.svelte:76-79`.
  A failed rank lookup after a scored run shows the user nothing. Surface it.
- **Keyset pagination can skip rows silently.** `src/lib/server/ai/history.ts`
  pages on `updatedAt` alone via `lt(updatedAt, before)`, and `updatedAt` is a
  plain ms-epoch integer with no uniqueness constraint. Two conversations
  sharing a millisecond across a page boundary means the later one appears on no
  page at all. Tie-break the cursor on `(updatedAt, id)`. This helper backs both
  `/admin/ai` and the user-facing sidebar at `GET /api/ai/conversations`, where a
  user silently losing their own conversation is the more visible failure.
- **CSV export truncates at 10,000 rows with no way to reach the rest.** Covered
  by the streaming decision above. Grouped here because the current behavior
  loses access to data in a tool whose purpose is retrieving it.
- **Screen readers miss both dynamic surfaces.** The ask transcript
  (`src/routes/ask/[[id]]/+page.svelte:194`) has no `aria-live`, so a streaming
  answer is never announced. The quiz reveal (`QuestionPlayer.svelte:134-148`,
  `QuizSummary.svelte:38-41`) conveys correctness only through color and a bare
  glyph. Add live regions, text equivalents, and `aria-hidden` on the glyphs.
  `DisplayNameClaim.svelte:57-63` has no accessible name on its input and does
  not move focus when revealed.
- **Unvalidated data crossing trust boundaries.** `rule-ids.json` is cast to
  `string[]` with no schema (`src/lib/content/rule-id-sets.ts:1-10`) despite
  gating which AI citations render as links. The conversation list response is
  cast with `as` and never parsed (`src/lib/ask/conversations.svelte.ts:17`),
  the one wire shape in the app without runtime validation.
- **Attempt timestamps are unbounded.** `src/routes/api/attempts/+server.ts`
  accepts any `startedAt`, `durationS`, and per-response `at` for quick and
  mastery mode. This affects only the submitting user's own dashboard, never the
  leaderboard, which the signed run token protects. Bound them against `Date.now()`.
- **Stream reader is never cancelled.** `src/lib/ask/chat-stream.svelte.ts:195-223`
  has no `finally` calling `reader.cancel()`. Browsers tear this down via the
  abort controller in practice, so this is defensive.

### 2. Payload and query cost

- **Load sections lazily.** `src/lib/content/load.ts:7-12`. Switch to a
  non-eager glob and parse only the requested ruleset and slug, memoized per
  key. Removes 65KB gzipped from every rules page. `manifests.ts` keeps its
  eager glob, since listing every ruleset is a genuine full scan of small data.
- **Load questions lazily.** `src/lib/quiz/bank.ts:4-14`. Same change. Removes
  roughly 56KB gzipped from every quiz page, and removes the cold-start Zod
  validation of the whole bank.
- **Leaderboard index and cache.** Add a composite index on
  `(ruleset_id, mode, user_id, score, best_streak, created_at)` and cache the
  public entries at the edge for 30 to 60 seconds. The per-user row stays live,
  since it is a find over an already-small array. Move the query and its ranking
  out of the route file into `$lib/server/leaderboard.ts` so it can be tested.
- **Admin metrics in SQL.** `src/lib/server/admin/metrics.ts:63-124`. Replace the
  two unfiltered `selectDistinct` scans and the JavaScript `Set` union with a
  single counting query, and push day bucketing into `GROUP BY`. Add an index on
  `user.created_at`.
- **Admin AI review.** `src/routes/admin/ai/+page.server.ts:12-22`. The page is
  already paginated, but `limit` bounds nothing that matters: `msgCount` groups
  over all of `ai_messages` and `downFlag` scans every `feedback = 'down'` row,
  both materialized before the join. Page 1 and page 50 cost the same full-table
  pass. Replace the derived-table joins with correlated per-row subqueries the
  existing `(conversation_id, created_at)` index can serve, and add an index
  supporting the `feedback` filter. The query also orders by `updated_at`
  globally with no user filter, which the `(user_id, updated_at)` index cannot
  serve, so add `(updated_at)`.
- **Admin AI review paging control.** `src/routes/admin/ai/+page.svelte:41-46`.
  "Load more" is a link that navigates to a fresh page of the next 30 and
  replaces the current rows rather than appending, with no previous link and no
  position indicator. Relabel it and add backward navigation.
- **Admin export page counts.** `src/routes/admin/export/+page.server.ts:6-13`
  runs six full-table `COUNT(*)` queries per page load, one per dataset, via the
  `total` helper in `datasets.ts:21-22`. Cache them briefly or drop exact counts.
- **CSV export.** `src/lib/server/admin/datasets.ts` and
  `src/lib/server/admin/csv.ts`. Implement the streaming, uncapped export from
  the decisions above: `rows` gains a keyset cursor, `toCsv` yields rows instead
  of joining them, and the route returns a `ReadableStream`. The global
  `ORDER BY created_at DESC` in each dataset has no supporting index, so add
  single-column indexes on `created_at` for `quiz_attempts`, `ai_messages`, and
  `user`, and on `at` for `question_responses`.
- **Attempt lookups.** Extend `quiz_attempts`'s `(user_id, created_at)` index to
  `(user_id, ruleset_id, mode, created_at)`, which covers the existing uses too.
- **Session pruning cron.** `triggers.crons` in `wrangler.jsonc` plus a scheduled
  handler.

Index changes need a migration. `db:migrate:remote` applies to production and is
a separate, deliberate step.

### 3. Centralization

Largest reductions first.

- Derive types from schemas with `z.infer` across `quiz/types.ts`,
  `quiz/payload.ts`, `ai/payload.ts`, `leaderboard/payload.ts`,
  `profile/payload.ts`, and `content/types.ts`. `RuleNode` keeps its hand-written
  interface, which `z.lazy` needs for the self-reference, and gets a comment
  saying why. Around -90.
- `safeFetchJson(url, init, schema)` replacing five hand-rolled fetch-and-degrade
  blocks in `bookmarks.svelte.ts`, `conversations.svelte.ts`, and `sync.ts`.
  This also supplies the missing validation above. Around -40.
- Shared UI components: `Button` for the 13 copy-pasted call-to-action strings,
  `AuthGate` for the sign-in gate duplicated between `ask/+layout.svelte` and
  `quiz/scenario/+page.svelte`, `PromoCard` for the hero tile in three pages,
  `TogglePill` for the four pill blocks, and an `eyebrow` utility in `app.css`
  for a class fragment repeated 16 times. Around -120.
- `parseJsonBody(request, schema)` in a new `$lib/server/http.ts`, replacing nine
  near-identical parse-and-400 blocks. Around -20.
- Query helpers shared between `/me` and the API routes that duplicate them:
  response history, timed best, bookmarks, display-name state. The
  `MAX_RESPONSES = 2000` constant is currently declared in two files. Around -30.
- `recordAttempt` shared by `/api/attempts` and `/api/timed/finish`, which
  duplicate the dedup check and batch insert. `attempts` currently lacks the
  race-retry that `timed/finish` has, so this closes that gap. Around -20.
- `getOwnedConversation` for the ownership predicate repeated three times.
  Around -15.
- `requireAiQuota` for the availability-and-quota preflight duplicated between
  chat and scenario. The global-cap removal lands here. Around -10.
- `utcDay` in `src/lib/time.ts`, replacing three separate definitions. One of
  them sets the AI quota reset boundary.
- An optimistic-update helper for the snapshot-apply-revert sequence in
  `bookmarks.svelte.ts` and `conversations.svelte.ts`. Around -15.
- A `bookmarks/payload.ts` following the convention of the other four, since
  bookmarks is the one wire shape without one. Around +20.
- Move the orchestration in `ask/[[id]]/+page.svelte:1-183` and
  `quiz/timed/+page.svelte:36-144` into `.svelte.ts` modules. Line count is flat;
  the point is testability of the race guards.
- Type `App.Locals.auth` and `db` as optional. They are declared required but
  `hooks.server.ts` only populates them for allowlisted paths, so the compiler
  currently permits a new route that crashes at runtime.
- Standardize error surfacing on `errorMessage: string | null`, already used in
  three places, and note where silence is deliberate.

### 4. Tests

- Unit tests for `chat-stream.svelte.ts`, 271 lines with no test file and the
  most branch-heavy client code in the app. Cover NDJSON split across chunk
  boundaries, the stall timer, abort mid-stream, truncation, the concurrency
  cap, and the error branches. Follow `sync.test.ts`'s fetch-stubbing pattern.
- Leaderboard ranking with three or more competitors. Every current test seeds
  one scorer, so the tie-break ordering has never executed.
- The localStorage quota regression described in tranche 1.
- Rollback paths in `bookmarks.svelte.ts:35-55` and
  `conversations.svelte.ts:77-91`, untested at every level today.
- A test asserting every dynamic route is matched by `hooks.server.ts`'s
  allowlist, importing the predicate rather than restating it. A new server
  route outside the list silently loses `locals.db` in production.
- Concurrent duplicate submissions to `/api/timed/finish` and concurrent retries
  in `/api/ai/chat`, whose race-handling branches only sequential tests reach.
- The conversation message cap and `/api/attempts`'s section-mismatch check.
- Keyset paging across a tie: two rows sharing an `updatedAt` straddling a page
  boundary must both appear. `history.ts` has tests today, but none covering
  duplicate cursor values.
- The streaming CSV export: a dataset larger than one internal chunk emits every
  row exactly once, with the header emitted once.
- Delete the `DIFFICULTY_LABELS[3]` assertion in `quiz/types.test.ts:27-29`,
  which restates a constant. It is the only test worth removing.

The Gemini HTTP contract is mocked at every layer, so a change to Google's SSE
framing or error vocabulary would ship green. Recording this as a known,
accepted risk rather than adding a live call to CI.

### 5. Hygiene

- README corrections: the model is `gemini-3.6-flash`, not `gemini-3-flash-preview`
  (line 92); the bank holds 213 questions, not 212 (lines 10 and 185); the
  roadmap omits the shipped Admin feature the README documents elsewhere; the
  export description at line 126 must drop the 10,000-row cap once exports
  stream.
- Delete `src/lib/index.ts`, scaffold boilerplate never imported. Move
  `grid-pulse-lines.ts` beside its only consumer. Move `collectRuleIds` into
  `scripts/ingest/`, its only caller.
- Unify appendix-anchor matching. `scripts/ingest/parse.ts:44` matches `[a-g]`
  while `src/lib/content/rule-ids.ts:5` matches `[a-gA-G]`, so an uppercase
  anchor would classify differently in ingest than in the app.
- Assert in `validate-content.ts` that `DEFAULT_RULESET_ID` resolves to an
  ingested ruleset.
- Delete the three merged worktrees and five merged remote branches.

## Verification

Every tranche holds `npm run check`, `npm run test`, and `npx prettier --check .`
green, with `.github/workflows/ci.yml` as the full gate. The payload claims in
tranche 2 are verified by rebuilding and confirming the section and question
chunks are no longer static imports of their route nodes.

## Decision log

**Prerendered pages keep client-side fetching.** The cross-cutting review
recommended moving `/leaderboard` and `/ask` to server load functions for
consistency with `/me`. Rejected for the prerendered routes: they are static
files on the asset CDN today, and a server load would make every view a Worker
invocation plus a D1 query, worsening the same leaderboard cost this document
sets out to fix. `/ask` is genuinely dynamic and could take a load function, but
its initial fetch is entangled with `chat-stream.svelte.ts`'s background-stream
ownership and view-generation guards. Deferred until that module has tests.

**No component-test infrastructure.** Adding jsdom and a testing library would
let `.svelte` files be unit-tested, which nothing currently allows. Rejected
because the Playwright suite already covers component behavior in depth,
including glossary keyboard navigation, quiz shortcuts, and search combobox
semantics. Revisit if component regressions start recurring.

**Global AI cap removed rather than raised.** Raising the constant moves the
same wall further out. A prepaid balance with auto-reload off already bounds
total spend. The tradeoff accepted: the global counter also limited how fast a
runaway retry loop could drain the balance, so removal trades a slower drain for
a faster one at the same total.

**Streamed single-file exports rather than numbered parts.** The original design
called for splitting exports across files past 10,000 rows, which was never
built. Splitting existed to keep any one buffered file small, and streaming
removes that constraint. A single file also cannot be partially collected, and
avoids `OFFSET` paging, whose cost grows with depth so that later parts are
slower than earlier ones. Rejected alternative: implement the numbered parts as
originally intended.

**No retention policy beyond sessions.** Archival or rollup of
`question_responses` would mean choosing what history to discard permanently,
which is a product decision with no current pressure behind it.
