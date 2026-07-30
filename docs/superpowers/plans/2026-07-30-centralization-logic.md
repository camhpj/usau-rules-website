# Centralization (logic half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse duplicated type declarations, server route boilerplate, and client fetch handling into shared helpers, and fix the three optimistic-update races that centralizing them exposes.

**Architecture:** Schemas become the single source of truth for wire types via `z.infer`, reversing today's `z.ZodType<T>` annotation. New server helpers live in `src/lib/server/http.ts` and `src/lib/server/quiz/record-attempt.ts`; new client helpers in `src/lib/fetch.ts` and `src/lib/optimistic.svelte.ts`. Each helper replaces call sites in the same task that introduces it, so no task leaves a half-adopted abstraction.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Zod 4, Drizzle ORM, D1, Vitest.

This is the first of two plans covering tranche 3 of
`docs/superpowers/specs/2026-07-27-codebase-improvement-design.md`. The second
covers shared UI components, page orchestration extraction, and error
surfacing. Splitting was agreed because a single PR spanning type definitions,
server routes, and Svelte components is not reviewable in one sitting.

## Research inputs

Three read-only inventories were produced against `4041862`. They contain
verbatim current source for every call site named below. Implementers read the
section their task names rather than re-deriving it.

- `<SCRATCH>/tranche3/A-types.md` — every schema/type pair, with equivalence analysis
- `<SCRATCH>/tranche3/B-client-fetch.md` — 12 fetch sites, 3 optimistic sites, bookmarks wire shape
- `<SCRATCH>/tranche3/D-server.md` — parse blocks, attempt recording, ownership predicate, quota, `utcDay`, locals

`<SCRATCH>` is
`/private/tmp/claude-501/-Users-cameronjohnson-Documents-repos-usau-rules-website/664a2e4e-a58d-4c9c-b235-bd2f4f882ebe/scratchpad`.

## Global Constraints

- `npm run check`, `npm run test`, and `npx prettier --check .` stay green at every commit.
- Code under `src/` runs on Cloudflare Workers. No Node built-ins. Scripts under `scripts/` run under `tsx` and may use them.
- `content/rulesets/**` and `static/search/**` are generated. Do not hand-edit.
- No new dependencies.
- No database migration. This plan changes no table, column, or index.
- Every helper introduced must be adopted at every call site the task names, in the same commit range. A helper with one caller is a failed task.
- Behavior is preserved unless a task explicitly states a behavior change. Three tasks do: Task 6 (global AI cap removal), Task 7 (race retry added to `/api/attempts`), Task 11 (stale optimistic reverts stop firing).
- User-facing error copy is unchanged except where a task quotes the new string.

---

### Task 1: Derive wire types from schemas with `z.infer`

Today every wire shape is declared twice: a hand-written `interface`, then a
schema annotated `z.ZodType<Interface>` so the compiler checks the schema
against the interface. Reverse the direction. The schema becomes the
declaration and the type is inferred from it.

Two reasons beyond line count. The `z.ZodType<T>` annotation erases the
concrete schema type, so `.shape`, `.extend()`, and `.pick()` are unavailable
on these schemas today. And the annotation cannot reject a schema *wider* than
its interface — an extra `z.object` field is structurally assignable and would
pass through at runtime unnoticed.

**Files:**
- Modify: `src/lib/quiz/types.ts` (33 lines)
- Modify: `src/lib/quiz/payload.ts` (84 lines)
- Modify: `src/lib/ai/payload.ts` (106 lines)
- Modify: `src/lib/leaderboard/payload.ts` (31 lines)
- Modify: `src/lib/profile/payload.ts` (23 lines)
- Modify: `src/lib/content/types.ts` (91 lines)
- Modify: `src/lib/server/quiz/run-token.ts` (`RunClaims`)
- Modify: `src/lib/server/ai/scenario.ts` (`ScenarioDraft`)
- Read for context: `<SCRATCH>/tranche3/A-types.md` — the complete pair list with verbatim source

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the same exported type names as today, now type aliases rather than interfaces. Every downstream import keeps working unchanged. `EntrySchema` in `leaderboard/payload.ts` becomes exported as `LeaderboardEntrySchema`.

- [ ] **Step 1: Prove the widening hole is real before relying on it as justification**

Write a scratch file (do not commit it) containing:

```ts
import { z } from 'zod';
interface Narrow {
	a: string;
}
const WiderSchema: z.ZodType<Narrow> = z.object({ a: z.string(), extra: z.number() });
const out = WiderSchema.parse({ a: 'x', extra: 1 });
console.log(out);
```

Run `npx tsc --noEmit` on it. Record in your report whether it compiles. If it
compiles, the hole is real and the justification stands. If it errors, say so
plainly in your report — the task still proceeds on the LOC and `.shape`
grounds, but do not repeat a claim the compiler contradicts.

- [ ] **Step 2: Flip `src/lib/profile/payload.ts`, the smallest file, first**

Replace the whole file with:

```ts
import { z } from 'zod';

/** Wire shapes shared by the dashboard/nudge UI and /api/profile/display-name. */

export const DisplayNameStateSchema = z.object({
	displayName: z.string().nullable(),
	suggestion: z.string()
});
export type DisplayNameState = z.infer<typeof DisplayNameStateSchema>;

export const PutDisplayNameSchema = z.object({
	displayName: z.string().max(200).nullable(),
	resolveConflict: z.boolean().optional()
});
export type PutDisplayName = z.infer<typeof PutDisplayNameSchema>;
```

- [ ] **Step 3: Run the type checker**

Run: `npm run check`
Expected: 0 errors. If a consumer breaks, that consumer relied on something
`z.infer` does not reproduce — record which, and fix the consumer rather than
reverting the flip.

- [ ] **Step 4: Flip `src/lib/leaderboard/payload.ts`, including the unexported schema**

`EntrySchema` is currently unexported and unannotated — the one file deviating
from the pattern. Export it under a name matching its type.

```ts
import { z } from 'zod';

/** Wire shapes shared by /leaderboard, the timed nudge, and /api/leaderboard. */

export const LEADERBOARD_SIZE = 10;

export const LeaderboardEntrySchema = z.object({
	rank: z.number().int().positive(),
	displayName: z.string(),
	score: z.number().int(),
	bestStreak: z.number().int(),
	/** attempt createdAt, epoch ms */
	at: z.number()
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResponseSchema = z.object({
	entries: z.array(LeaderboardEntrySchema),
	me: LeaderboardEntrySchema.nullable()
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
```

`src/lib/server/leaderboard.ts:15` declares `interface RankedWithCaller extends
LeaderboardEntry`. A type alias for an object type is a valid `extends` target,
so this should compile. Verify it does.

- [ ] **Step 5: Run the type checker and the tests**

Run: `npm run check && npm run test`
Expected: 0 errors, 251 tests passing.

- [ ] **Step 6: Flip the remaining four files**

Work through `src/lib/quiz/types.ts`, `src/lib/quiz/payload.ts`,
`src/lib/ai/payload.ts`, and `src/lib/content/types.ts` the same way, then
`RunClaims` in `src/lib/server/quiz/run-token.ts` and `ScenarioDraft` in
`src/lib/server/ai/scenario.ts`. `<SCRATCH>/tranche3/A-types.md` lists all 21
pairs with their verbatim current source.

Preserve member comments by moving them onto the schema field, as shown for
`at` in Step 4. One is a real JSDoc block — `ConversationSummary.pending` — and
must survive as a comment on its schema field. Hover documentation will not
carry through `z.infer`; that is an accepted loss, not a reason to skip the
field's comment.

**`RuleNode` in `src/lib/content/types.ts` keeps its hand-written interface.**
It is self-referential and `z.lazy` cannot infer a recursive type without an
explicit annotation. Add a comment on it saying exactly that, so the next
reader does not "finish the job". Check whether any sibling type in that file
has the same constraint and leave those too.

- [ ] **Step 7: Confirm no `z.ZodType<` annotations remain in the flipped files**

Run: `rg 'z\.ZodType<' src/lib`
Expected: matches only in `content/types.ts` for the `RuleNode` recursion, and
in any sibling you identified in Step 6. Report every remaining match with its
reason.

- [ ] **Step 8: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "refactor: derive wire types from their Zod schemas"
```

---

### Task 2: Unify `utcDay` into `src/lib/time.ts`

Three byte-identical definitions of a UTC day-boundary helper exist. One of
them sets the AI quota reset moment.

**Files:**
- Modify: `src/lib/time.ts` (currently exports only `timeAgo`)
- Modify: `src/lib/server/ai/guardrails.ts` (remove its `utcDay`, import instead)
- Modify: `src/lib/server/admin/metrics-math.ts` (same)
- Modify: `src/routes/me/+page.svelte` (its copy is named `isoDay`)
- Test: `src/lib/time.test.ts` (create if absent)

**Interfaces:**
- Produces: `export function utcDay(now: number): string` in `src/lib/time.ts`, returning `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { utcDay } from './time';

describe('utcDay', () => {
	it('returns the UTC calendar day as YYYY-MM-DD', () => {
		expect(utcDay(Date.UTC(2026, 6, 30, 12, 0, 0))).toBe('2026-07-30');
	});

	it('uses UTC, not local time, at the day boundary', () => {
		// 23:30 UTC on the 30th is still the 30th regardless of the host zone.
		expect(utcDay(Date.UTC(2026, 6, 30, 23, 30, 0))).toBe('2026-07-30');
		// 00:30 UTC on the 31st has already rolled over.
		expect(utcDay(Date.UTC(2026, 6, 31, 0, 30, 0))).toBe('2026-07-31');
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/time.test.ts`
Expected: FAIL — `utcDay` is not exported from `./time`.

- [ ] **Step 3: Add the implementation**

Append to `src/lib/time.ts`:

```ts
/** UTC calendar day as YYYY-MM-DD. Sets the AI quota reset boundary. */
export function utcDay(now: number): string {
	return new Date(now).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/time.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace all three definitions with imports**

Delete the local definition in each of the three files and import from
`$lib/time`. In `src/routes/me/+page.svelte` the local name is `isoDay` — update
its call sites to `utcDay`.

`guardrails.ts` currently re-exports `utcDay`. Check whether anything imports
`utcDay` *from* `guardrails.ts`; if so, update those importers to `$lib/time`
rather than leaving a re-export in place.

- [ ] **Step 6: Confirm one definition remains**

Run: `rg -n 'function utcDay|function isoDay' src/`
Expected: exactly one match, in `src/lib/time.ts`.

- [ ] **Step 7: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "refactor: single utcDay definition in \$lib/time"
```

---

### Task 3: `parseJsonBody` for the parse-and-400 blocks

Seven API routes repeat the same parse-and-400 sequence. Two more sites look
similar but are not candidates: `/api/ai/chat`'s `retryParse` branches instead
of erroring, and `/api/timed/start` silently defaults. Leave both alone.

All seven return HTTP 400 with SvelteKit's `{ message: string }` error body, so
unifying them changes no response shape. Confirm this while working — if any
site differs, stop and report rather than normalizing it silently.

**Files:**
- Create: `src/lib/server/http.ts`
- Create: `src/lib/server/http.test.ts`
- Modify: the seven routes listed in `<SCRATCH>/tranche3/D-server.md` section 1, which gives each one's verbatim current source

**Interfaces:**
- Produces: `export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>, message?: string): Promise<T>` — throws SvelteKit `error(400, message)` on malformed JSON or schema failure.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/http.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonBody } from './http';

const Schema = z.object({ name: z.string() });

function req(body: string): Request {
	return new Request('https://example.test/', { method: 'POST', body });
}

describe('parseJsonBody', () => {
	it('returns the parsed value on a valid body', async () => {
		await expect(parseJsonBody(req('{"name":"ada"}'), Schema)).resolves.toEqual({ name: 'ada' });
	});

	it('throws a 400 on malformed JSON', async () => {
		await expect(parseJsonBody(req('{not json'), Schema)).rejects.toMatchObject({ status: 400 });
	});

	it('throws a 400 when the body fails the schema', async () => {
		await expect(parseJsonBody(req('{"name":42}'), Schema)).rejects.toMatchObject({ status: 400 });
	});

	it('uses the caller-supplied message', async () => {
		await expect(parseJsonBody(req('{}'), Schema, 'invalid bookmark payload')).rejects.toMatchObject(
			{ body: { message: 'invalid bookmark payload' } }
		);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/server/http.test.ts`
Expected: FAIL — cannot resolve `./http`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/http.ts`:

```ts
import { error } from '@sveltejs/kit';
import type { z } from 'zod';

/**
 * Parse and validate a JSON request body, or throw a 400.
 *
 * Malformed JSON and schema failures are deliberately not distinguished: the
 * client cannot act differently on the two, and the distinction leaks shape
 * information about the endpoint.
 */
export async function parseJsonBody<T>(
	request: Request,
	schema: z.ZodType<T>,
	message = 'invalid request body'
): Promise<T> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, message);
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw error(400, message);
	return parsed.data;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/server/http.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Adopt at all seven routes**

Replace each parse-and-400 block with a `parseJsonBody` call, passing that
route's existing error message verbatim so no user-facing string changes.

- [ ] **Step 6: Confirm the blocks are gone**

Run: `rg -n 'safeParse' src/routes/api`
Expected: only the two deliberate non-candidates remain (`ai/chat`'s
`retryParse`, `timed/start`'s silent default). Report any other match.

- [ ] **Step 7: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "refactor: parseJsonBody for the repeated parse-and-400 blocks"
```

---

### Task 4: `requireDb` and `requireAuth` accessors for `App.Locals`

`hooks.server.ts` populates `locals.db` and `locals.auth` only for allowlisted
paths, but `app.d.ts` declares both as required. No route is currently outside
the allowlist, so this is a latent authoring hazard rather than a live bug: a
new route added outside the list compiles fine and fails at runtime with
"cannot read property of undefined".

Typing them optional would be the strongest guarantee but adds a guard block at
20 unguarded read sites. Instead, add accessors that throw a named 500. Paired
with the allowlist test planned for the next tranche, this covers the same
failure at a fraction of the noise.

**Files:**
- Modify: `src/lib/server/http.ts`
- Modify: `src/lib/server/http.test.ts`
- Modify: the 22 `locals.db` read sites and 4 `locals.auth` read sites listed in `<SCRATCH>/tranche3/D-server.md` section 7

**Interfaces:**
- Consumes: `src/lib/server/http.ts` from Task 3.
- Produces: `requireDb(locals: App.Locals): Db` and `requireAuth(locals: App.Locals): Auth`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/http.test.ts`:

```ts
import { requireDb } from './http';

describe('requireDb', () => {
	it('returns the binding when present', () => {
		const db = {} as never;
		expect(requireDb({ db } as never)).toBe(db);
	});

	it('throws a 500 naming the binding when absent', () => {
		expect(() => requireDb({} as never)).toThrowError(
			expect.objectContaining({ status: 500 })
		);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/server/http.test.ts`
Expected: FAIL — `requireDb` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/server/http.ts`:

```ts
/**
 * Read `locals.db`, or fail loudly.
 *
 * `hooks.server.ts` populates the binding only for allowlisted paths, so a
 * route added outside that list would otherwise fail with an unattributable
 * "cannot read property of undefined".
 */
export function requireDb(locals: App.Locals): App.Locals['db'] {
	if (!locals.db) throw error(500, 'database binding missing — route not in the hooks allowlist');
	return locals.db;
}

export function requireAuth(locals: App.Locals): App.Locals['auth'] {
	if (!locals.auth) throw error(500, 'auth binding missing — route not in the hooks allowlist');
	return locals.auth;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/server/http.test.ts`
Expected: PASS.

- [ ] **Step 5: Adopt at every read site**

Replace `locals.db` with `requireDb(locals)` and `locals.auth` with
`requireAuth(locals)`, binding once per handler:

```ts
const db = requireDb(locals);
```

Where a handler already destructures or guards, keep the existing shape and
just change the source. Do not add a second guard on top of the accessor.

- [ ] **Step 6: Confirm no direct reads remain**

Run: `rg -n 'locals\.(db|auth)' src/routes src/lib`
Expected: matches only inside `requireDb`/`requireAuth` themselves and in
`src/hooks.server.ts`, which assigns them. Report anything else.

- [ ] **Step 7: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "refactor: requireDb/requireAuth accessors for hook-populated locals"
```

---

### Task 5: `getOwnedConversation` for the ownership predicate

The predicate `and(eq(id, X), eq(userId, user.id), isNull(deletedAt))` appears
three times. All three collapse "missing" and "owned by someone else" into one
outcome on purpose — it denies an attacker an existence oracle for a foreign
conversation id. Preserve that. The helper returns the row or `null`; each
caller keeps its own response, because the DELETE route deliberately returns
`{ ok: true }` where the other two 404.

**Files:**
- Create: `src/lib/server/ai/conversations.ts`
- Modify: `src/routes/api/ai/chat/+server.ts`
- Modify: `src/routes/api/ai/conversations/[id]/+server.ts` (GET and DELETE)
- Read for context: `<SCRATCH>/tranche3/D-server.md` section 3

**Interfaces:**
- Produces: `getOwnedConversation(db, id, userId)` returning `{ id: string; rulesetId: string } | null`.

- [ ] **Step 1: Write the implementation**

Create `src/lib/server/ai/conversations.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { aiConversations } from '$lib/server/db/schema';

/**
 * Look up a conversation the caller owns and has not deleted.
 *
 * Returns null for "no such conversation" and "not yours" alike. Callers must
 * keep collapsing the two: distinguishing them hands an attacker an existence
 * oracle for a foreign conversation id.
 */
export async function getOwnedConversation(
	db: Db,
	id: string,
	userId: string
): Promise<{ id: string; rulesetId: string } | null> {
	const rows = await db
		.select({ id: aiConversations.id, rulesetId: aiConversations.rulesetId })
		.from(aiConversations)
		.where(
			and(
				eq(aiConversations.id, id),
				eq(aiConversations.userId, userId),
				isNull(aiConversations.deletedAt)
			)
		)
		.limit(1);
	return rows[0] ?? null;
}
```

- [ ] **Step 2: Adopt at all three sites**

Each becomes a call plus that site's existing outcome. The two 404 sites keep
`error(404, 'conversation not found')` and their `// no existence oracle`
comment. The DELETE site keeps returning `json({ ok: true })` unconditionally
and its `// idempotent; no existence oracle` comment.

- [ ] **Step 3: Confirm the predicate appears once**

Run: `rg -n 'aiConversations.userId' src/`
Expected: one match inside the new helper, plus any structurally different
query. `messages/[id]/feedback` uses an `innerJoin` and is not one of the three
— leave it.

- [ ] **Step 4: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "refactor: shared getOwnedConversation lookup"
```

---

### Task 6: `requireAiQuota`, and remove the global AI budget cap

Two near-identical availability-and-quota preflights differ only in `AiKind`
and message text. Extract one helper.

**This task also deletes the all-user daily cap**, which the repository owner
approved: their Google Cloud account holds a fixed prepaid balance with
auto-reload off, so spend is already bounded by a hard wall. The per-user cap of
10 per day stays. `ai_usage` stays — per-user counting still needs it, so there
is no migration.

**Files:**
- Modify: `src/lib/server/ai/config.ts` (delete `AI_GLOBAL_DAILY`)
- Modify: `src/lib/server/ai/guardrails.ts` (drop the global branch, the `globalCount` param, and the `UsageStore.globalCount` method)
- Modify: `src/lib/server/ai/guardrails.test.ts` (delete global-cap cases)
- Modify: `src/routes/api/ai/chat/+server.ts`
- Modify: `src/routes/api/ai/scenario/+server.ts`
- Modify: `README.md`
- Read for context: `<SCRATCH>/tranche3/D-server.md` section 4, which carries the exhaustive touch-list

**Interfaces:**
- Consumes: `requireDb` from Task 4.
- Produces: `requireAiQuota(store: UsageStore, userId: string, kind: AiKind, now: number): Promise<{ remaining: number; day: string }>`, throwing 429 when over quota. It takes a `UsageStore`, not a `Db`, so it stays testable with the existing fake store. `QuotaDecision` loses its `'global-cap'` reason. `evaluateQuota(kind, userCount)` loses its third parameter.

- [ ] **Step 1: Delete the global-cap tests first, and watch the suite go red**

Remove the cases in `src/lib/server/ai/guardrails.test.ts` that assert
`'global-cap'`, then run `npx vitest run src/lib/server/ai/guardrails.test.ts`.
Expected: the remaining tests still compile against the current three-parameter
`evaluateQuota` and pass. This confirms you removed only global-cap coverage.

- [ ] **Step 2: Narrow `evaluateQuota`**

In `src/lib/server/ai/guardrails.ts`:

```ts
export type QuotaDecision = { allowed: true; remaining: number } | { allowed: false; reason: 'user-cap' };

/** Pure cap check; `userCount` is from BEFORE the current request. */
export function evaluateQuota(kind: AiKind, userCount: number): QuotaDecision {
	if (userCount >= DAILY_CAPS[kind]) return { allowed: false, reason: 'user-cap' };
	return { allowed: true, remaining: DAILY_CAPS[kind] - userCount - 1 };
}
```

Drop `AI_GLOBAL_DAILY` from the import, delete it from `config.ts`, and delete
the `globalCount` method from both the `UsageStore` interface and
`d1UsageStore`. Import `utcDay` from `$lib/time` (Task 2 moved it) and delete
the local copy.

- [ ] **Step 3: Run the tests**

Run: `npm run test`
Expected: green, with fewer tests than the 251 baseline. Report the new count.

- [ ] **Step 4: Write the preflight helper**

Add to `src/lib/server/ai/guardrails.ts`:

```ts
/**
 * Availability-and-quota preflight shared by the chat and scenario routes.
 * Throws 503 when AI is not configured, 429 when the caller is over quota.
 */
export async function requireAiQuota(
	store: UsageStore,
	userId: string,
	kind: AiKind,
	now: number
): Promise<{ remaining: number; day: string }> {
	const day = utcDay(now);
	const used = await store.userCount(day, userId, kind);
	const decision = evaluateQuota(kind, used);
	if (!decision.allowed) throw error(429, QUOTA_MESSAGE[kind]);
	return { remaining: decision.remaining, day };
}
```

`QUOTA_MESSAGE` is a `Record<AiKind, string>` holding each route's existing
message verbatim. Read both routes and copy the two strings exactly — do not
invent new copy. Keep the availability check (the 503 for a missing API key)
wherever it lives today; if both routes perform it identically, fold it in and
say so in your report.

- [ ] **Step 5: Adopt at both routes**

Replace each preflight with a `requireAiQuota` call.

- [ ] **Step 6: Confirm the global cap is gone**

Run: `rg -n 'AI_GLOBAL_DAILY|global-cap|globalCount' src/ docs/ README.md`
Expected: zero matches in `src/`. Matches in `docs/superpowers/specs/` are
historical record and stay. Any match in `README.md` must be fixed in Step 7.

- [ ] **Step 7: Correct the README**

Find the passage describing the AI caps and remove the all-user limit, leaving
the per-user limit described accurately. Quote the before and after in your
report.

- [ ] **Step 8: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "feat: remove the global AI budget cap, extract requireAiQuota"
```

---

### Task 7: `recordAttempt` shared by the two attempt-writing routes

`/api/attempts` and `/api/timed/finish` both dedup by `clientId` then batch
insert. `timed/finish` additionally handles the race between its dedup select
and its insert; `attempts` does not, so a concurrent duplicate there returns a
500 today instead of a 409.

**A hard constraint.** `/api/attempts` validates client-supplied `startedAt`
and each response's `at` against `CLOCK_SKEW_MS`. `timed/finish` must NOT gain
that check. Its timestamps come from a server-set, HMAC-signed run token, and
its bound is total run wall-clock against `claims.startedAt` — a different trust
boundary solving a different problem. Hoisting skew validation into the shared
helper and applying it to both routes would be a defect. Keep skew validation in
the `/api/attempts` handler, above the call.

**Files:**
- Create: `src/lib/server/quiz/record-attempt.ts`
- Create: `src/lib/server/quiz/record-attempt.test.ts`
- Modify: `src/routes/api/attempts/+server.ts`
- Modify: `src/routes/api/timed/finish/+server.ts`
- Read for context: `<SCRATCH>/tranche3/D-server.md` section 2, which has both handlers verbatim and the race described precisely

**Interfaces:**
- Consumes: `requireDb` (Task 4), `isUniqueConstraintError` from `src/lib/server/profile/errors.ts`.
- Produces: `recordAttempt(db, input)` returning `{ duplicate: true; id: string }` or `{ duplicate: false; id: string }`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/quiz/record-attempt.test.ts`. Cover, with a fake `db`
whose `batch` can be made to throw:

1. A fresh `clientId` inserts and reports `duplicate: false`.
2. A `clientId` already present is detected by the pre-check and reports `duplicate: true` without calling `batch`.
3. **The race**: the pre-check finds nothing, `batch` throws a unique-constraint error, the re-query then finds the winner's row, and the call reports `duplicate: true`. This is the branch `/api/attempts` lacks today.
4. `batch` throws a non-unique-constraint error and the re-query finds nothing: the original error propagates, so a genuine D1 failure still surfaces as a 500 rather than a silent 409.

Case 4 is the one most likely to be skipped. Do not skip it — collapsing a real
failure into a 409 would hide outages.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/server/quiz/record-attempt.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/quiz/record-attempt.ts`. The retry mirrors
`timed/finish`'s current behavior exactly — catch any error from `batch`,
re-query by `clientId`, treat a found row as the race winner, and re-throw
otherwise:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { quizAttempts } from '$lib/server/db/schema';

export interface RecordAttemptResult {
	id: string;
	duplicate: boolean;
}

/**
 * Insert an attempt and its responses, tolerating a duplicate submission.
 *
 * `quiz_attempts.client_id` is unique, but the dedup select and the insert are
 * two round-trips, so concurrent submissions of the same run can both pass the
 * pre-check. The insert loser is resolved by re-querying rather than by
 * matching on the error text.
 */
export async function recordAttempt(db: Db, input: RecordAttemptInput): Promise<RecordAttemptResult> {
	const existing = await findByClientId(db, input.clientId);
	if (existing) return { id: existing.id, duplicate: true };

	try {
		await db.batch(buildWrites(db, input));
	} catch (err) {
		const winner = await findByClientId(db, input.clientId);
		if (winner) return { id: winner.id, duplicate: true };
		// Not the race — a real D1 failure must still surface as a 500.
		throw err;
	}
	return { id: input.attemptId, duplicate: false };
}
```

Define `RecordAttemptInput`, `findByClientId`, and `buildWrites` from the two
handlers' current code, which `<SCRATCH>/tranche3/D-server.md` section 2 quotes
in full. Keep the batch's statement order identical to today's.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/server/quiz/record-attempt.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Adopt at both routes**

`/api/attempts` keeps its `CLOCK_SKEW_MS` validation above the call and gains
the race handling for free. `timed/finish` keeps its token verification and
wall-clock bound above the call, and keeps returning 201 with `{ score,
bestStreak }` on success and 409 on duplicate.

- [ ] **Step 6: Verify both routes' status codes are unchanged**

Run: `npm run test`
Expected: green. Then state in your report, for each route, the status code
returned on success, on a pre-check duplicate, and on a race duplicate. The only
intended change is `/api/attempts` on a race duplicate: 500 becomes 409.

- [ ] **Step 7: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "refactor: shared recordAttempt, closing the /api/attempts duplicate race"
```

---

### Task 8: Shared read queries between `/me` and the API routes

Four queries are duplicated between the `/me` page loader and API routes:
response history, timed best, bookmarks, and display-name state. All four pairs
are identical today. `MAX_RESPONSES = 2000` is declared in two files.

Follow the convention `src/lib/server/leaderboard.ts` established in the last
tranche: a plain module of exported functions taking `db` as their first
argument, with no SvelteKit imports, so they are unit-testable without a
request.

**Files:**
- Create: `src/lib/server/quiz/queries.ts`
- Modify: `src/routes/me/+page.server.ts`
- Modify: the API routes duplicating each query, listed in `<SCRATCH>/tranche3/D-server.md` section 6
- Read for context: the same section, plus `src/lib/server/leaderboard.ts` for the convention

**Interfaces:**
- Consumes: `requireDb` (Task 4).
- Produces: one exported function per query, and a single `MAX_RESPONSES` export.

- [ ] **Step 1: Confirm each pair really is identical before merging it**

For all four, diff the two versions on: `limit`, `orderBy`, `where` filters, and
selected columns. `<SCRATCH>/tranche3/D-server.md` reports them identical.
Verify that yourself and report per-query. **If any pair differs, do not merge
that one** — report the difference and leave both in place. A merge that
silently changes one caller's result set is worse than the duplication.

- [ ] **Step 2: Extract the four queries**

Move each into `src/lib/server/quiz/queries.ts`, exporting `MAX_RESPONSES` once
from there and deleting both existing declarations.

- [ ] **Step 3: Adopt at every call site**

- [ ] **Step 4: Confirm the constant is declared once**

Run: `rg -n 'MAX_RESPONSES' src/`
Expected: one declaration, plus imports.

- [ ] **Step 5: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "refactor: share the /me and API read queries"
```

---

### Task 9: `bookmarks/payload.ts` for the one wire shape without one

Quiz, AI, leaderboard, and profile each have a `payload.ts`. Bookmarks does
not: the client and the route declare the shape independently and the client
does not validate at all.

**Files:**
- Create: `src/lib/bookmarks/payload.ts`
- Modify: `src/routes/api/bookmarks/+server.ts` (use the shared schema instead of its inline one)
- Modify: `src/lib/bookmarks.svelte.ts` (validate the GET response)
- Read for context: `<SCRATCH>/tranche3/B-client-fetch.md` Part 3, which has the exact current shapes and the convention

**Interfaces:**
- Consumes: the `z.infer` convention from Task 1. Write this file in that style from the start — schema first, type inferred. Do not use `z.ZodType<T>`.
- Produces: `BookmarkSchema`/`Bookmark`, `BookmarksResponseSchema`/`BookmarksResponse`, `BookmarkTargetSchema`/`BookmarkTarget`.

- [ ] **Step 1: Write the module**

```ts
import { z } from 'zod';

/** Wire shapes shared by the bookmarks store and /api/bookmarks. */

export const BookmarkSchema = z.object({
	rulesetId: z.string().min(1).max(64),
	ruleId: z.string().min(1).max(64),
	createdAt: z.number()
});
export type Bookmark = z.infer<typeof BookmarkSchema>;

export const BookmarksResponseSchema = z.object({
	bookmarks: z.array(BookmarkSchema)
});
export type BookmarksResponse = z.infer<typeof BookmarksResponseSchema>;

/** Request body for both PUT (add) and DELETE (remove). */
export const BookmarkTargetSchema = BookmarkSchema.omit({ createdAt: true });
export type BookmarkTarget = z.infer<typeof BookmarkTargetSchema>;
```

`.omit()` is available here precisely because Task 1 removed the
`z.ZodType<T>` annotations that erase the concrete schema type.

- [ ] **Step 2: Adopt server-side**

Replace the route's inline `BodySchema` with `BookmarkTargetSchema`, keeping its
`parseJsonBody` call from Task 3 and its existing `'invalid bookmark payload'`
message. The `min(1).max(64)` bounds must match what the route enforces today —
verify, do not assume.

- [ ] **Step 3: Adopt client-side**

`bookmarks.svelte.ts`'s `load()` currently casts with `as` and would build
`"undefined::undefined"` keys from a malformed entry. Validate with
`BookmarksResponseSchema` instead.

- [ ] **Step 4: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "feat: shared bookmarks wire schemas, validated on both sides"
```

---

### Task 10: `safeFetch` and `safeFetchJson`

Twelve client fetch sites hand-roll the same degrade sequence. Only two
validate the response. The rest use `as` casts or read no body at all, so this
task closes a validation gap at several sites rather than only shortening them.

Two helpers, not one with an optional schema. Three sites never read a body and
would otherwise pass a throwaway schema to satisfy the signature.

**Do not convert two sites.** `chat-stream.svelte.ts`'s `send()` streams its
body, reads response headers, passes an `AbortSignal`, and branches on five
status codes — it stays hand-rolled. `SearchDialog.svelte` reads `.text()` and
hands the string to `MiniSearch.loadJSON`; leave it.

**Files:**
- Create: `src/lib/fetch.ts`
- Create: `src/lib/fetch.test.ts`
- Modify: `src/lib/quiz/sync.ts` (4 sites)
- Modify: `src/lib/bookmarks.svelte.ts` (2 sites)
- Modify: `src/lib/ask/conversations.svelte.ts` (2 sites)
- Modify: `src/lib/components/DisplayNameClaim.svelte` (1 site)
- Modify: `src/lib/components/chat/ChatMessageRow.svelte` (1 site)
- Read for context: `<SCRATCH>/tranche3/B-client-fetch.md` Part 1, which has all 12 verbatim with their failure-mode analysis

**Interfaces:**
- Produces:

```ts
export type FetchResult<T> =
	| { ok: true; status: number; data: T }
	| { ok: false; status: number | null; body: unknown };

export async function safeFetch(
	url: string,
	init?: RequestInit
): Promise<{ ok: boolean; status: number | null }>;

export async function safeFetchJson<T>(
	url: string,
	init: RequestInit | undefined,
	schema: z.ZodType<T>
): Promise<FetchResult<T>>;
```

`status` is `null` only when no response exists — the network-throw case. It
must survive on the failure arm: `flushOutbox` branches on 401/409/400,
`submitTimedRun` requires exactly 201, and `DisplayNameClaim` treats 409
specially. A helper collapsing to `T | null` would destroy all three.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/fetch.test.ts`, stubbing `globalThis.fetch` the way
`src/lib/quiz/sync.test.ts` does. Cover for `safeFetchJson`:

1. 200 with a valid body → `{ ok: true, status: 200, data }`.
2. 200 with malformed JSON → `{ ok: false, status: 200 }`. A 2xx with a garbage body is a failure.
3. 200 with a schema-invalid body → `{ ok: false, status: 200, body }` carrying the raw value.
4. 409 with a readable body → `{ ok: false, status: 409, body }`, so a caller can still read a conflict suggestion.
5. Network throw → `{ ok: false, status: null }`.

And for `safeFetch`: a non-ok status is reported with its real status, and a
network throw gives `status: null`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/fetch.test.ts`
Expected: FAIL — cannot resolve `./fetch`.

- [ ] **Step 3: Write the implementation**

```ts
import type { z } from 'zod';

export type FetchResult<T> =
	| { ok: true; status: number; data: T }
	| { ok: false; status: number | null; body: unknown };

/** Fetch without reading a body. `status` is null only when no response arrived. */
export async function safeFetch(
	url: string,
	init?: RequestInit
): Promise<{ ok: boolean; status: number | null }> {
	try {
		const res = await fetch(url, init);
		return { ok: res.ok, status: res.status };
	} catch {
		return { ok: false, status: null };
	}
}

/**
 * Fetch and validate a JSON body.
 *
 * A 2xx carrying malformed or schema-invalid JSON is a failure: callers that
 * treated it as success would propagate unvalidated data. The real status
 * survives on the failure arm so callers can still branch on 401/409/201.
 */
export async function safeFetchJson<T>(
	url: string,
	init: RequestInit | undefined,
	schema: z.ZodType<T>
): Promise<FetchResult<T>> {
	let res: Response;
	try {
		res = await fetch(url, init);
	} catch {
		return { ok: false, status: null, body: null };
	}

	const body = await res.json().catch(() => null);
	if (!res.ok) return { ok: false, status: res.status, body };

	const parsed = schema.safeParse(body);
	if (!parsed.success) return { ok: false, status: res.status, body };
	return { ok: true, status: res.status, data: parsed.data };
}
```

Note that `safeFetchJson` does not delegate to `safeFetch` — it needs the
`Response` object to read the body, which `safeFetch` deliberately discards.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/fetch.test.ts`
Expected: PASS.

- [ ] **Step 5: Adopt at the ten convertible sites**

Preserve each site's existing branching exactly. Specifically:

- `flushOutbox` keeps its four-way 401/409/400/other policy.
- `submitTimedRun` keeps requiring exactly 201.
- `DisplayNameClaim.put` keeps its 409-with-suggestion branch, and should now validate the success shape with `DisplayNameStateSchema`, which already exists and is used for this endpoint family elsewhere.
- `beginTimedRun` currently casts `as { token?: string }`; give it a real schema so a non-string token cannot be returned typed as `string`.
- The three body-less sites use `safeFetch`.

- [ ] **Step 6: Confirm the conversions**

Run: `rg -n 'await fetch\(|fetch\(' src/lib --glob '!*.test.ts'`
Expected: matches only in `src/lib/fetch.ts`, `chat-stream.svelte.ts`, and
`SearchDialog.svelte`. Report any other.

- [ ] **Step 7: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "refactor: safeFetch/safeFetchJson, adding response validation at eight sites"
```

---

### Task 11: An optimistic-update helper that does not clobber concurrent mutations

Three sites do snapshot, apply, revert-on-failure. All three can discard a
concurrent mutation, and none has a rollback test.

- `bookmarks.toggle()` rebuilds the revert from live state, so a different key is safe. Toggling the **same** key twice before the first response lands is not: a late failure re-applies the inverse on top of a newer, server-confirmed value.
- `conversations.remove()` is worse. It restores a whole pre-operation array reference, discarding any `prepend`, `touch`, or concurrent `load` that landed while the delete was in flight.
- `ChatMessageRow.setFeedback()` has the same same-key defect as bookmarks.

A helper that centralizes snapshot-and-restore would centralize the bug. The
fix has two parts: the revert must be an **inverse operation applied to current
state**, never a restore of a captured snapshot, and a **per-key generation
counter** must make a stale response's revert a no-op.

**Files:**
- Create: `src/lib/optimistic.svelte.ts`
- Create: `src/lib/optimistic.test.ts`
- Modify: `src/lib/bookmarks.svelte.ts`
- Modify: `src/lib/ask/conversations.svelte.ts`
- Modify: `src/lib/components/chat/ChatMessageRow.svelte`
- Read for context: `<SCRATCH>/tranche3/B-client-fetch.md` Part 2, which analyzes each race concretely

**Interfaces:**
- Consumes: `safeFetch` from Task 10.
- Produces:

```ts
/**
 * Run an optimistic mutation, reverting only if no newer mutation for the same
 * key has started since.
 *
 * `revert` must be an inverse operation over current state, not a restore of a
 * snapshot captured before `request` — a snapshot restore discards unrelated
 * mutations that landed while the request was in flight.
 */
export function createOptimistic(): <T>(
	key: string,
	steps: { apply: () => void; revert: () => void; request: () => Promise<boolean> }
) => Promise<boolean>;
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/optimistic.test.ts`. Cover:

1. Success: `apply` runs, `request` resolves true, `revert` never runs.
2. Failure: `apply` runs, `request` resolves false, `revert` runs.
3. **Stale revert is suppressed.** Start mutation A on key `k`, then start mutation B on the same key before A resolves. A then fails. A's `revert` must NOT run, because B superseded it.
4. **A different key is unaffected.** A on key `k1` fails while B on key `k2` is in flight; B's state is untouched and B's own outcome is unchanged.
5. The newest mutation's own failure still reverts, even when earlier ones were suppressed.

Case 3 is the whole point of the task. Write it first.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/optimistic.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

```ts
export function createOptimistic() {
	const generation = new Map<string, number>();

	return async function optimistic(
		key: string,
		steps: { apply: () => void; revert: () => void; request: () => Promise<boolean> }
	): Promise<boolean> {
		const mine = (generation.get(key) ?? 0) + 1;
		generation.set(key, mine);
		steps.apply();
		const ok = await steps.request();
		// A newer mutation for this key has already replaced our optimistic value
		// and owns the outcome. Reverting now would clobber it.
		if (!ok && generation.get(key) === mine) steps.revert();
		return ok;
	};
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/optimistic.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Adopt in `bookmarks.svelte.ts`**

Key on the bookmark key. `revert` stays an inverse toggle computed from live
state, as today.

- [ ] **Step 6: Adopt in `conversations.svelte.ts`, changing the revert to an inverse operation**

This is the substantive change. `remove()` must stop doing `this.list = prev`.
Capture the removed summary and its index, and on revert re-insert that one
summary into the current list, preserving the list's `updatedAt`-descending
order. Any `prepend` or `touch` that landed meanwhile survives.

Key on the conversation id. Keep the existing `errorMessage` string.

- [ ] **Step 7: Adopt in `ChatMessageRow.svelte`**

Key on the message id. `revert` restores the previous feedback value, now
suppressed when a newer click superseded it.

- [ ] **Step 8: Write the rollback tests these sites never had**

Add tests covering, at minimum:

1. `conversations.remove()` fails and the conversation returns to the list **in its original position**.
2. `conversations.remove(a)` is in flight when `prepend(b)` runs; the removal then fails; **both** `a` and `b` are present afterwards. This is the bug — assert it directly.
3. `bookmarks.toggle()` fails and the key returns to its prior state.
4. The same bookmark toggled twice, the first failing after the second succeeds: the state matches the second, server-confirmed outcome.

- [ ] **Step 9: Full gate and commit**

Run: `npm run check && npm run test && npx prettier --check .`

```bash
git add -A
git commit -m "fix: optimistic reverts no longer discard concurrent mutations"
```

---

## Verification

After Task 11, run the full gate before opening the PR:

```bash
npm run check
npm run test
npx prettier --check .
npm run check:scripts
npm run validate:content
npm run build
npx playwright test
```

`.github/workflows/ci.yml` is the authority on what must pass.

Then measure and report honestly:

- Net LOC across the branch: `git diff --stat 4041862..HEAD`. The spec projected roughly -350 for all of tranche 3, but that number included -120 for UI components that research showed to be LOC-neutral. State the actual figure for this half rather than the projection.
- Test count before and after. The baseline is 251 across 39 files. Task 6 removes some; Tasks 2, 3, 4, 7, 10, and 11 add more.

## Decision log

**Two PRs instead of one.** Tranche 3 came back at roughly 15 tasks across 60+
files. This plan is the logic half. Shared UI components, page orchestration
extraction, and error surfacing follow in a second plan. Rejected: one PR, which
would span type definitions, server routes, and Svelte components in a single
diff.

**`requireDb`/`requireAuth` accessors instead of optional `App.Locals`.** The
spec called for typing `auth` and `db` optional so the compiler catches a route
outside the hooks allowlist. Research found no route currently outside it, and
20 of 22 `locals.db` reads are unguarded, so the change would add roughly 20
guard blocks to a plan whose goal is removing code. The accessors give a named
500 at the same sites for a one-line swap each, and the allowlist test planned
for the next tranche covers the authoring-time case. Rejected: optional typing
(cost), and leaving it alone (no improvement).

**Two fetch helpers rather than one with an optional schema.** Three of the
twelve sites never read a response body. An optional-schema signature would
have them pass a throwaway schema, or make `data` conditionally absent on the
success arm. Rejected: a single helper with an options bag.

**`recordAttempt` does not hoist `CLOCK_SKEW_MS`.** `/api/attempts` polices
client-supplied timestamps; `timed/finish` bounds wall-clock against a signed,
server-set token. Same-looking checks, different trust boundaries. Applying the
skew check to `timed/finish` inputs would be a defect, so it stays in the
`/api/attempts` handler above the shared call.

**The optimistic helper takes an inverse operation, not a snapshot.** Every
current site either restores a stale snapshot or re-applies an inverse without
checking whether a newer mutation superseded it. Centralizing the existing
shape would have preserved the bug at all three sites. Rejected:
`withOptimistic(getState, setState, request)` with an internal snapshot.

**Global AI cap removal lands here rather than in its own change.** It is
confined to the two files `requireAiQuota` already rewrites, plus config, tests,
and the README. Splitting it would mean touching `guardrails.ts` twice.
