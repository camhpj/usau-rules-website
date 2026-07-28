# Correctness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ten correctness bugs found by the codebase review, each with a regression test that fails before the fix.

**Architecture:** Independent, mostly small fixes across the client storage layer, the Gemini client, pagination helpers, one API route, and two Svelte components. Tasks share no state and can be reviewed separately. Tranche 1 of five; see `docs/superpowers/specs/2026-07-27-codebase-improvement-design.md`.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Zod 4, Drizzle ORM, Cloudflare Workers, Vitest, Playwright.

## Global Constraints

- Code under `src/` runs on Cloudflare Workers. No Node built-ins at runtime.
- Every task ends green on `npm run check`, `npm run test`, and `npx prettier --check .`.
- Baseline at plan start: svelte-check clean, 217 unit tests passing across 36 files, Prettier clean.
- Tests are Vitest with `environment: 'node'`. No `.svelte` component can be rendered in a unit test; component behavior is covered by Playwright in `e2e/`.
- Write tests first. Run them and watch them fail before writing the implementation.
- Commit after each task. Do not squash tasks together.
- Follow `CLAUDE.md` writing rules for comments and commit messages: lead with the point, active voice, no filler.

## Not in this plan

The spec lists the CSV export's 10,000-row truncation under correctness, but its
fix is the streaming rewrite, which needs the dataset and index work from tranche
2. It is planned there, not here. Everything else in the spec's correctness
tranche maps to a task below.

---

### Task 1: localStorage quota-exceeded write loses data

`writeRaw` mirrors every write into an in-memory `Map`, then attempts `localStorage.setItem` and swallows failures. `readRaw` falls back to that map only when `getItem` throws or returns `null`. After a quota-exceeded write the key still holds the previous value, so `getItem` succeeds and returns stale data while the newer value sits unread in memory. The user's quiz result silently disappears.

The existing test at `src/lib/quiz/storage.test.ts:80` misses this because it never seeds a successful write first, so its `getItem` returns `null` and takes the memory path.

**Files:**

- Modify: `src/lib/quiz/local.ts:21-28`
- Test: `src/lib/quiz/storage.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: no signature changes. `readRaw(key: string): string | null` and `writeRaw(key: string, value: string): void` keep their current shapes.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/quiz/storage.test.ts`, next to the existing quota test at line 80. The key difference from that test: this one lets the first write succeed, so `localStorage` holds stale data when the second write fails.

```ts
it('does not return stale localStorage data after a quota-exceeded write', () => {
	const backing = fakeLocalStorage();
	let failWrites = false;
	(globalThis as { localStorage?: Storage }).localStorage = {
		...backing,
		getItem: (k: string) => backing.getItem(k),
		setItem: (k: string, v: string) => {
			if (failWrites) throw new DOMException('quota exceeded', 'QuotaExceededError');
			backing.setItem(k, v);
		},
		removeItem: (k: string) => backing.removeItem(k)
	} as Storage;

	// First write succeeds and lands in localStorage.
	recordAnswers('r1', [answer('a', true)], 1);
	expect(loadResponses('r1')).toMatchObject([{ questionId: 'a', correct: true, at: 1 }]);

	// Second write hits quota. The newer answer must still be readable.
	failWrites = true;
	recordAnswers('r1', [answer('b', false)], 2);
	expect(loadResponses('r1')).toMatchObject([
		{ questionId: 'a', correct: true, at: 1 },
		{ questionId: 'b', correct: false, at: 2 }
	]);
});
```

Check that `fakeLocalStorage()` in this file exposes `removeItem`. If it does not, add it, backed by the same `Map` as `getItem`/`setItem`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/quiz/storage.test.ts -t "stale localStorage"`

Expected: FAIL. The second assertion receives only the first answer, because `getItem` returns the stale single-entry payload written before the quota error.

- [ ] **Step 3: Write the implementation**

Track which keys hold an unpersisted newer value, and have `readRaw` prefer memory for exactly those. Do not delete the stored value.

`readRaw`/`writeRaw` back two different things: quiz history under `bp:quiz:v1:*`, which `/api/sync` can rehydrate from D1, and the sync outbox under `bp:sync:v1:outbox`, which holds attempts with no server copy yet. Deleting a failed key would leave the outbox empty on the next reload, losing every queued attempt rather than just the newest one. Keeping the last value that genuinely persisted is strictly safer.

```ts
const memory = new Map<string, string>();
/** Keys whose memory value never reached localStorage, so storage holds something older. */
const unpersisted = new Set<string>();

/** Test-only: clears the in-memory fallback between tests. */
export function __resetLocal(): void {
	memory.clear();
	unpersisted.clear();
}
```

```ts
export function readRaw(key: string): string | null {
	// A failed write leaves an older value in storage; memory is authoritative until
	// a write succeeds again.
	if (unpersisted.has(key)) return memory.get(key) ?? null;
	try {
		const value = localStorage.getItem(key);
		if (value !== null) return value;
	} catch {
		// localStorage unavailable or blocked — fall through to memory
	}
	return memory.get(key) ?? null;
}

export function writeRaw(key: string, value: string): void {
	memory.set(key, value);
	try {
		localStorage.setItem(key, value);
		unpersisted.delete(key);
	} catch {
		// Quota, unavailable, or blocked. Leave whatever is stored alone: for the sync
		// outbox it is the only copy that survives a reload.
		unpersisted.add(key);
	}
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/lib/quiz/storage.test.ts`

Expected: PASS, including the two pre-existing fallback tests at lines 80 and 93.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quiz/local.ts src/lib/quiz/storage.test.ts
git commit -m "fix(quiz): track unpersisted keys instead of deleting on quota failure"
```

---

### Task 2: Gemini calls can hang without a timeout

`createCache` takes no `AbortSignal`, and `generateText` calls `callWithCacheFallback` without one, so the scenario-quiz path has no timeout at all. `streamText` does create its `AbortController` before the cache-fallback call and threads the signal down, but it arms `noAnswerTimer` and `hardTimer` only after that call resolves. Nothing fires the abort during cache creation, so a hang there is unprotected even for chat.

**Files:**

- Modify: `src/lib/server/ai/config.ts` (add one constant)
- Modify: `src/lib/server/ai/gemini.ts` (`createCache`, `ensureGroundingCache`, `callWithCacheFallback`, `generateText`, `streamText`)
- Test: `src/lib/server/ai/gemini.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `AI_REQUEST_MAX_MS: number` exported from `$lib/server/ai/config`.
  - `ensureGroundingCache(req: GeminiRequest, signal?: AbortSignal): Promise<string | null>` — gains an optional second parameter. Existing single-argument callers keep working.
  - `generateText(req: GeminiRequest): Promise<string>` — signature unchanged; now rejects with an abort error rather than hanging.

- [ ] **Step 1: Write the failing tests**

`gemini.test.ts` already uses fake timers and a `fetchImpl` seam. Follow its existing patterns. Add:

```ts
it('aborts generateText when the upstream never responds', async () => {
	vi.useFakeTimers();
	const req = {
		...baseReq(),
		fetchImpl: (_url: string, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
			})
	};
	const promise = generateText(req);
	const assertion = expect(promise).rejects.toThrow();
	await vi.advanceTimersByTimeAsync(AI_REQUEST_MAX_MS + 1_000);
	await assertion;
	vi.useRealTimers();
});

it('aborts streamText when cache creation hangs before the stream opens', async () => {
	vi.useFakeTimers();
	const req = {
		...baseReq(),
		// The cachedContents POST never settles; the watchdog must still fire.
		fetchImpl: (url: string, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
			})
	};
	const promise = streamText(req);
	const assertion = expect(promise).rejects.toThrow();
	await vi.advanceTimersByTimeAsync(AI_STREAM_MAX_MS + 1_000);
	await assertion;
	vi.useRealTimers();
});
```

Reuse whatever request-builder helper the file already defines instead of `baseReq()` if the name differs. Import `AI_REQUEST_MAX_MS` and `AI_STREAM_MAX_MS` from `$lib/server/ai/config`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/lib/server/ai/gemini.test.ts -t "aborts"`

Expected: FAIL. Both time out or hang, because no abort is scheduled on either path.

- [ ] **Step 3: Add the timeout constant**

Append to `src/lib/server/ai/config.ts`:

```ts
/** Watchdog: hard cap on a single non-streaming Gemini call, including cache creation. */
export const AI_REQUEST_MAX_MS = 30_000;
```

- [ ] **Step 4: Thread a signal through the cache path**

In `src/lib/server/ai/gemini.ts`, give `createCache` a signal and pass it to its fetch:

```ts
async function createCache(
	req: GeminiRequest,
	signal?: AbortSignal
): Promise<{ name: string; expiresAt: number } | null> {
	const f = req.fetchImpl ?? fetch;
	const now = req.now?.() ?? Date.now();
	const res = await f(`${GEMINI_BASE}/cachedContents`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
		body: JSON.stringify({
			model: `models/${GEMINI_MODEL}`,
			displayName: cacheKey(req.rulesetId),
			systemInstruction: { parts: [{ text: req.systemPolicy }] },
			contents: [userText(req.grounding)],
			ttl: `${CACHE_TTL_S}s`
		}),
		signal
	}).catch(() => null);
	if (!res?.ok) return null;
	const data = (await res.json()) as { name?: string };
	if (!data.name) return null;
	return { name: data.name, expiresAt: now + CACHE_TTL_S * 1000 };
}
```

Add the same optional `signal?: AbortSignal` parameter to `ensureGroundingCache` and forward it to every `createCache` call inside it.

In `callWithCacheFallback`, forward the signal it already receives to both `ensureGroundingCache` calls:

```ts
const cacheName = await ensureGroundingCache(req, signal);
let res = await callGemini(req, endpoint, cacheName, signal);
if (cacheName && !res.ok && res.status >= 400 && res.status < 500) {
	await req.store.del(cacheKey(req.rulesetId));
	const fresh = await ensureGroundingCache(req, signal);
	res = await callGemini(req, endpoint, fresh, signal);
}
return res;
```

- [ ] **Step 5: Give generateText its own controller and timeout**

Replace the first line of `generateText`'s body:

```ts
export async function generateText(req: GeminiRequest): Promise<string> {
	const abort = new AbortController();
	const timer = setTimeout(
		() => abort.abort(new Error('watchdog: Gemini request exceeded max duration')),
		AI_REQUEST_MAX_MS
	);
	let res: Response;
	try {
		res = await callWithCacheFallback(req, 'generateContent', abort.signal);
	} finally {
		clearTimeout(timer);
	}
	if (!res.ok) throw new Error(`${res.status} from Gemini: ${(await res.text()).slice(0, 300)}`);
	// ...rest of the function is unchanged
```

Import `AI_REQUEST_MAX_MS` at the top of the file alongside the other config imports.

- [ ] **Step 6: Arm streamText's watchdogs before the cache-fallback call**

In `streamText`, move the two timer declarations and `clearTimers` above the `callWithCacheFallback` await, and clear them if that call throws. The `AbortController` stays where it is.

```ts
export async function streamText(
	req: GeminiRequest,
	observer?: StreamObserver
): Promise<ReadableStream<Uint8Array>> {
	const abort = new AbortController();
	let outcome: StreamOutcome = 'complete';
	let consumerCancelled = false;
	// Armed before the upstream call so a hang in cache creation is covered too.
	let noAnswerTimer: ReturnType<typeof setTimeout> | null = setTimeout(
		() => abort.abort(new Error('watchdog: no answer text within budget')),
		AI_STREAM_NO_ANSWER_MAX_MS
	);
	const hardTimer = setTimeout(
		() => abort.abort(new Error('watchdog: stream exceeded max duration')),
		AI_STREAM_MAX_MS
	);
	const clearTimers = () => {
		if (noAnswerTimer) clearTimeout(noAnswerTimer);
		noAnswerTimer = null;
		clearTimeout(hardTimer);
	};

	let res: Response;
	try {
		res = await callWithCacheFallback(req, 'streamGenerateContent?alt=sse', abort.signal);
		if (!res.ok || !res.body) {
			throw new Error(`${res.status} from Gemini: ${(await res.text()).slice(0, 300)}`);
		}
	} catch (err) {
		clearTimers();
		throw err;
	}
	// ...rest of the function is unchanged, minus the timer declarations you moved
```

Delete the original timer declarations further down. Leave every other use of `clearTimers` alone.

- [ ] **Step 7: Run the full Gemini suite**

Run: `npx vitest run src/lib/server/ai/gemini.test.ts`

Expected: PASS, all 380 lines' worth of existing cases plus the two new ones. The existing cancellation and watchdog tests must still pass, which is what proves the timer move did not break stream teardown.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/ai/config.ts src/lib/server/ai/gemini.ts src/lib/server/ai/gemini.test.ts
git commit -m "fix(ai): time out Gemini cache creation and non-streaming calls"
```

---

### Task 3: Keyset pagination silently skips rows on a tie

`parseHistoryQuery` and `pageRows` page on `updatedAt` alone, and the caller filters with `lt(aiConversations.updatedAt, before)`. `updatedAt` is a plain ms-epoch integer with no uniqueness constraint. When two conversations share a millisecond across a page boundary, the one on the far side matches no page and is never returned.

This helper backs both `/admin/ai` and the user-facing sidebar at `GET /api/ai/conversations`, where a user silently losing their own conversation is the more visible failure.

**Files:**

- Modify: `src/lib/server/ai/history.ts`
- Modify: `src/routes/api/ai/conversations/+server.ts:10-24`
- Modify: `src/routes/admin/ai/+page.server.ts:8,42,48`
- Modify: `src/routes/admin/ai/+page.svelte:41-46` (cursor now has two parts)
- Modify: `src/lib/ask/conversations.svelte.ts` (sidebar client — sends the `beforeId` cursor; without this change the server fix is unreachable from the sidebar)
- Test: `src/lib/server/ai/history.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `parseHistoryQuery(params: URLSearchParams, defaultLimit?: number): { before: number | null; beforeId: string | null; limit: number }` — the return type gains `beforeId`, read from the `beforeId` query parameter.
  - `pageRows` is unchanged: `pageRows<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean }`.
  - Task 4 and later tasks do not depend on either.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/server/ai/history.test.ts`:

```ts
it('parses a compound cursor', () => {
	const params = new URLSearchParams('before=1700000000000&beforeId=abc');
	expect(parseHistoryQuery(params)).toEqual({
		before: 1700000000000,
		beforeId: 'abc',
		limit: 10
	});
});

it('reports a null beforeId when the parameter is absent', () => {
	const params = new URLSearchParams('before=1700000000000');
	expect(parseHistoryQuery(params).beforeId).toBeNull();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/server/ai/history.test.ts -t "cursor"`

Expected: FAIL with a mismatch on the returned object, since `beforeId` is not part of the current shape.

- [ ] **Step 3: Implement the compound cursor in the helper**

In `src/lib/server/ai/history.ts`, update the doc comment and `parseHistoryQuery`:

```ts
/** Query parsing + pagination helpers for conversation lists (user sidebar and admin). */

export function parseHistoryQuery(
	params: URLSearchParams,
	defaultLimit: number = DEFAULT_LIMIT
): { before: number | null; beforeId: string | null; limit: number } {
	const limit = toPositiveInt(params.get('limit'));
	const beforeId = params.get('beforeId');
	return {
		before: toPositiveInt(params.get('before')),
		beforeId: beforeId === null || beforeId === '' ? null : beforeId,
		limit: limit === null ? defaultLimit : Math.min(limit, MAX_LIMIT)
	};
}
```

- [ ] **Step 4: Apply the compound cursor in the user-facing route**

In `src/routes/api/ai/conversations/+server.ts`, select `id` alongside the existing columns is already the case, so only the cursor changes. Replace the `before` condition:

```ts
const { before, beforeId, limit } = parseHistoryQuery(event.url.searchParams, 20);
const conditions = [eq(aiConversations.userId, user.id), isNull(aiConversations.deletedAt)];
if (before !== null) {
	// Compound cursor: updated_at is not unique, so ties are broken by id. Without
	// this, a row sharing a millisecond across a page boundary appears on no page.
	conditions.push(
		beforeId === null
			? lt(aiConversations.updatedAt, before)
			: or(
					lt(aiConversations.updatedAt, before),
					and(eq(aiConversations.updatedAt, before), lt(aiConversations.id, beforeId))
				)!
	);
}
const rows = await event.locals.db
	.select({
		id: aiConversations.id,
		title: aiConversations.title,
		updatedAt: aiConversations.updatedAt
	})
	.from(aiConversations)
	.where(and(...conditions))
	.orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
	.limit(limit + 1); // sentinel row for hasMore
const { items, hasMore } = pageRows(rows, limit);
return json({ conversations: items, hasMore });
```

Add `or` to the `drizzle-orm` import on line 2.

- [ ] **Step 5: Apply the same cursor in the admin route**

In `src/routes/admin/ai/+page.server.ts`, destructure `beforeId`, replace the `conds.push(lt(...))` at line 42 with the same compound condition, add `desc(aiConversations.id)` as a secondary sort on line 46, and return the id cursor:

```ts
const { before, beforeId, limit } = parseHistoryQuery(event.url.searchParams, 30);
```

```ts
if (before !== null) {
	conds.push(
		beforeId === null
			? lt(aiConversations.updatedAt, before)
			: or(
					lt(aiConversations.updatedAt, before),
					and(eq(aiConversations.updatedAt, before), lt(aiConversations.id, beforeId))
				)!
	);
}
```

```ts
const rows = await q
	.orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
	.limit(limit + 1);
const { items, hasMore } = pageRows(rows, limit);
const last = hasMore ? items[items.length - 1] : null;
return {
	conversations: items,
	hasMore,
	nextBefore: last?.updatedAt ?? null,
	nextBeforeId: last?.id ?? null,
	downOnly
};
```

Add `and` and `or` to the `drizzle-orm` import on line 1.

- [ ] **Step 6: Pass the id cursor in the admin link**

In `src/routes/admin/ai/+page.svelte:41-46`, add the second cursor parameter:

```svelte
{#if data.hasMore}
	<a
		class="mt-3 inline-block cursor-pointer text-sm text-cardinal"
		href="/admin/ai?{data.downOnly ? 'down=1&' : ''}before={data.nextBefore}&beforeId={data.nextBeforeId}"
		>Load more</a
	>
{/if}
```

Task 4 of the payload-and-query plan replaces this control entirely; this step only keeps it correct in the meantime.

- [ ] **Step 7: Run the tests and the type check**

Run: `npx vitest run src/lib/server/ai/history.test.ts && npm run check`

Expected: PASS and a clean type check. The `!` after `or(...)` is required because Drizzle types `or` as possibly undefined.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/ai/history.ts src/lib/server/ai/history.test.ts src/routes/api/ai/conversations/+server.ts src/routes/admin/ai/+page.server.ts src/routes/admin/ai/+page.svelte
git commit -m "fix(ai): break pagination ties on id so no conversation is skipped"
```

---

### Task 4: Display-name writes report every failure as a name conflict

`PUT /api/profile/display-name` wraps its update in `try/catch` and treats any thrown error as the unique-index race, so a transient D1 error tells the user their chosen name is taken. The retry path's own update at line 78 is not guarded at all.

**Files:**

- Modify: `src/routes/api/profile/display-name/+server.ts:65-79`
- Create: `src/lib/server/profile/errors.ts`
- Test: `src/lib/server/profile/errors.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `isUniqueConstraintError(err: unknown): boolean` exported from `$lib/server/profile/errors`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/profile/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isUniqueConstraintError } from './errors';

describe('isUniqueConstraintError', () => {
	it('recognizes a SQLite unique-constraint violation', () => {
		const err = new Error('D1_ERROR: UNIQUE constraint failed: user.display_name');
		expect(isUniqueConstraintError(err)).toBe(true);
	});

	it('matches regardless of case', () => {
		expect(isUniqueConstraintError(new Error('unique constraint failed'))).toBe(true);
	});

	it('rejects unrelated database errors', () => {
		expect(isUniqueConstraintError(new Error('D1_ERROR: network timeout'))).toBe(false);
	});

	it('rejects non-errors', () => {
		expect(isUniqueConstraintError(null)).toBe(false);
		expect(isUniqueConstraintError('UNIQUE constraint failed')).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/server/profile/errors.test.ts`

Expected: FAIL to resolve the import, because `errors.ts` does not exist.

- [ ] **Step 3: Write the helper**

Create `src/lib/server/profile/errors.ts`:

```ts
/**
 * True when a rejected write was the unique index refusing a duplicate, as opposed
 * to a transient failure. D1 surfaces SQLite's message verbatim, so matching the
 * text is the only signal available.
 */
export function isUniqueConstraintError(err: unknown): boolean {
	return err instanceof Error && /unique constraint failed/i.test(err.message);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/lib/server/profile/errors.test.ts`

Expected: PASS, four assertions.

- [ ] **Step 5: Use it in the route**

In `src/routes/api/profile/display-name/+server.ts`, replace lines 65-79:

```ts
// The unique index is the backstop for set-set races: retry once with a re-resolve.
try {
	await db.update(user).set({ displayName: finalName }).where(eq(user.id, me.id));
} catch (err) {
	if (!isUniqueConstraintError(err)) throw err;
	const retry = await resolveUniqueName(validated.name, taken);
	if (!parsed.data.resolveConflict) {
		return json({ suggestion: retry ?? undefined, message: 'that name is taken' }, { status: 409 });
	}
	if (!retry) error(409, 'that name is taken');
	finalName = retry;
	try {
		await db.update(user).set({ displayName: finalName }).where(eq(user.id, me.id));
	} catch (retryErr) {
		if (isUniqueConstraintError(retryErr)) error(409, 'that name is taken');
		throw retryErr;
	}
}
return json({ displayName: finalName });
```

Add the import at the top:

```ts
import { isUniqueConstraintError } from '$lib/server/profile/errors';
```

Rethrowing a non-constraint error lets SvelteKit turn it into a 500, which is the honest status for a transient database failure.

- [ ] **Step 6: Verify the type check and the e2e display-name coverage still pass**

Run: `npm run check && npx vitest run`

Expected: clean check, all unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/profile/errors.ts src/lib/server/profile/errors.test.ts src/routes/api/profile/display-name/+server.ts
git commit -m "fix(profile): only report a name conflict when the unique index rejects"
```

---

### Task 5: Generated rule-ids.json is trusted without validation

Every other ingest-generated artifact is Zod-validated on load. `rule-ids.json` is cast straight to `string[]`. It gates which AI citations render as rule links, so an ingest regression could corrupt the trust boundary silently.

**Files:**

- Modify: `src/lib/content/rule-id-sets.ts`
- Test: `src/lib/content/rule-id-sets.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `ruleIdSet(rulesetId: string): ReadonlySet<string>` — signature unchanged.

- [ ] **Step 1: Write the failing test**

The existing `rule-id-sets.test.ts` asserts against real content. Add a test for the validation itself. Because the glob runs at module scope, test the schema rather than the module load:

```ts
it('rejects a rule-ids payload that is not an array of non-empty strings', () => {
	expect(RuleIdsSchema.safeParse(['1', '1.A']).success).toBe(true);
	expect(RuleIdsSchema.safeParse([]).success).toBe(true);
	expect(RuleIdsSchema.safeParse(['1', 42]).success).toBe(false);
	expect(RuleIdsSchema.safeParse(['1', '']).success).toBe(false);
	expect(RuleIdsSchema.safeParse({ ids: ['1'] }).success).toBe(false);
});
```

Import `RuleIdsSchema` from `./rule-id-sets`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/content/rule-id-sets.test.ts -t "rejects a rule-ids payload"`

Expected: FAIL, `RuleIdsSchema` is not exported.

- [ ] **Step 3: Write the implementation**

Replace `src/lib/content/rule-id-sets.ts`:

```ts
import { z } from 'zod';

/** Shape of the ingest-emitted rule-ids.json, validated like every other generated artifact. */
export const RuleIdsSchema = z.array(z.string().min(1));

const files = import.meta.glob('$content/rulesets/*/rule-ids.json', { eager: true }) as Record<
	string,
	{ default: unknown }
>;

const sets = new Map<string, ReadonlySet<string>>();
for (const [path, mod] of Object.entries(files)) {
	const match = path.match(/\/rulesets\/([^/]+)\//);
	if (match) sets.set(match[1], new Set(RuleIdsSchema.parse(mod.default)));
}

const EMPTY: ReadonlySet<string> = new Set();

/** Every rule id + section anchor of a ruleset (ingest-emitted rule-ids.json). */
export function ruleIdSet(rulesetId: string): ReadonlySet<string> {
	return sets.get(rulesetId) ?? EMPTY;
}
```

`parse` rather than `safeParse` is deliberate: a malformed generated artifact should fail the build loudly, matching how the other content loaders behave.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/lib/content/ && npm run check`

Expected: PASS. The existing assertions against real content confirm the committed `rule-ids.json` satisfies the schema.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/rule-id-sets.ts src/lib/content/rule-id-sets.test.ts
git commit -m "fix(content): validate generated rule-ids.json on load"
```

---

### Task 6: Conversation list responses are cast without validation

`#fetchPage` casts the fetched body with `as ConversationListResponse` and never parses it. Every other wire shape in the app validates at the boundary and degrades gracefully; this one flows straight into rendered state.

**Files:**

- Modify: `src/lib/ai/payload.ts` (add schemas near the existing conversation interfaces at lines 67-94)
- Modify: `src/lib/ask/conversations.svelte.ts:11-21`
- Test: `src/lib/ask/conversations.svelte.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `ConversationSummarySchema` and `ConversationListResponseSchema` exported from `$lib/ai/payload`.
  - `ConversationsState` behavior is unchanged except that a malformed body is treated like a failed response.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/ask/conversations.svelte.test.ts`:

```ts
it('treats a malformed conversation list like a failed request', async () => {
	vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ nope: true }), { status: 200 }));
	const state = new ConversationsState();
	await state.load();
	expect(state.list).toEqual([]);
	expect(state.errorMessage).toBe("Couldn't load your conversations.");
	vi.unstubAllGlobals();
});
```

If `ConversationsState` is not currently exported from `conversations.svelte.ts`, export the class alongside the existing singleton so the test can build an isolated instance.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/ask/conversations.svelte.test.ts -t "malformed"`

Expected: FAIL. The cast accepts the object, `page.conversations` is `undefined`, and the spread throws or leaves `errorMessage` null.

- [ ] **Step 3: Add the schemas**

In `src/lib/ai/payload.ts`, beside the existing `ConversationSummary` and `ConversationListResponse` interfaces:

```ts
export const ConversationSummarySchema = z.object({
	id: z.string(),
	title: z.string(),
	updatedAt: z.number()
});

export const ConversationListResponseSchema = z.object({
	conversations: z.array(ConversationSummarySchema),
	hasMore: z.boolean()
});
```

Match the field lists to the existing interfaces exactly. If they differ from the three fields above, follow the interfaces, not this snippet. The full `z.infer` conversion of this file happens in the centralization plan; here the schemas sit next to the interfaces without replacing them.

- [ ] **Step 4: Validate in the fetch path**

Replace `#fetchPage` in `src/lib/ask/conversations.svelte.ts:11-21`. Task 3 already changed this method's signature to take both cursor parts and build the query with `URLSearchParams` — add the response validation on top of that shape rather than the single-argument, template-string version this task started from:

```ts
async #fetchPage(
	before: number | null,
	beforeId: string | null
): Promise<ConversationListResponse | null> {
	try {
		const params = new URLSearchParams();
		if (before !== null) {
			params.set('before', String(before));
			if (beforeId !== null) params.set('beforeId', beforeId);
		}
		const query = params.toString();
		const res = await fetch(`/api/ai/conversations${query ? `?${query}` : ''}`);
		if (!res.ok) return null;
		const parsed = ConversationListResponseSchema.safeParse(await res.json());
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
```

Add `ConversationListResponseSchema` to the import on line 1.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/lib/ask/ && npm run check`

Expected: PASS, including the pre-existing `resolve` test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/payload.ts src/lib/ask/conversations.svelte.ts src/lib/ask/conversations.svelte.test.ts
git commit -m "fix(ask): validate conversation list responses before rendering them"
```

---

### Task 7: Timed-run leaderboard nudge fails silently

After a scored timed run, a failed rank lookup shows the user nothing at all. The comment at `src/routes/quiz/timed/+page.svelte:76-79` states that network problems never touch the results screen, which is the wrong call for a scored feature.

**Files:**

- Modify: `src/routes/quiz/timed/+page.svelte:57-79`
- Test: `e2e/timed-sync.spec.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Read the current code**

Read `src/routes/quiz/timed/+page.svelte:36-144` in full before editing. `resolveBoardStatus` and `finish` share a hand-rolled `runGeneration` counter that guards against a stale async result overwriting a newer run. Preserve that guard exactly; only the failure branch changes.

- [ ] **Step 2: Write the failing e2e test**

Add to `e2e/timed-sync.spec.ts`. The run flow is inlined below because this file has no shared run helper; it mirrors the first test in the same file.

```ts
test('shows a notice when the leaderboard check fails after a run', async ({ page }) => {
	await signUpTestUser(page, 'timedboard');
	await page.route('**/api/leaderboard*', (route) => route.abort('failed'));
	await page.goto('/quiz/timed');
	await page.waitForLoadState('networkidle'); // hydration race — see quiz.spec.ts
	await page.getByRole('button', { name: /^start$/i }).click();
	for (let i = 0; i < 3; i++) {
		await page.getByTestId('choice').first().click();
		await page.waitForTimeout(750); // rapid mode auto-advances (~600ms)
	}
	await page.getByRole('button', { name: /end run/i }).click();
	await expect(page.getByText(/time!/i)).toBeVisible();
	await expect(page.getByText(/couldn't check the leaderboard/i)).toBeVisible();
});
```

`signUpTestUser(page, tag)` from `./helpers` is the only sign-in helper this suite has; there is no `signIn`.

- [ ] **Step 3: Run the test and verify it fails**

Run: `npm run build && npx playwright test e2e/timed-sync.spec.ts -g "leaderboard check fails"`

Expected: FAIL, the notice never appears because the failure is swallowed.

- [ ] **Step 4: Surface the failure**

Add a state field beside the existing board state:

```ts
let boardError = $state<string | null>(null);
```

In `resolveBoardStatus`, set it on the failure path instead of returning silently, and clear it on success. Keep the `runGeneration` staleness guard around both writes so a late failure from an abandoned run cannot post a notice over a newer one.

Render it in the results section, near the existing leaderboard nudge:

```svelte
{#if boardError}
	<p class="mt-2 text-sm text-navy/60">{boardError}</p>
{/if}
```

Set the message to `"Couldn't check the leaderboard — your score is saved."` The second clause matters: the run itself is already persisted by `POST /api/timed/finish`, and the user should not think their score was lost.

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx playwright test e2e/timed-sync.spec.ts`

Expected: PASS, including the pre-existing replay and tamper cases.

- [ ] **Step 6: Commit**

```bash
git add src/routes/quiz/timed/+page.svelte e2e/timed-sync.spec.ts
git commit -m "fix(quiz): tell the user when the post-run leaderboard check fails"
```

---

### Task 8: Screen readers miss the quiz reveal and the streaming answer

Two dynamic surfaces update without announcing themselves. In `QuestionPlayer.svelte` the reveal panel does carry the text "Correct" or "Not quite" already, so the gap is the missing live region plus the bare `✓`/`✗` glyphs in the choice buttons, which convey correctness with no text alternative. In the ask transcript the streaming answer region has no `aria-live` at all, so a response arriving is never announced.

**Files:**

- Modify: `src/lib/components/quiz/QuestionPlayer.svelte:124-128,133-135`
- Modify: `src/routes/ask/[[id]]/+page.svelte:224-256`
- Modify: `src/lib/components/DisplayNameClaim.svelte:57-63`
- Test: `e2e/quiz.spec.ts`, `e2e/ai.spec.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing e2e assertions**

In `e2e/quiz.spec.ts`, extend the existing answer-a-question test rather than adding a new one:

```ts
await expect(page.getByRole('status')).toContainText(/correct|not quite/i);
```

In `e2e/ai.spec.ts`, extend an existing streaming test:

```ts
await expect(page.locator('[aria-live="polite"]').first()).toBeVisible();
```

- [ ] **Step 2: Run them and verify they fail**

Run: `npm run build && npx playwright test e2e/quiz.spec.ts e2e/ai.spec.ts -g "correct|stream"`

Expected: FAIL, no element carries `role="status"` or `aria-live`.

- [ ] **Step 3: Give the glyphs text alternatives**

In `QuestionPlayer.svelte:124-128`, mark the decorative glyphs hidden and add visually-hidden text:

```svelte
{#if revealed && isCorrect}
	<span class="ml-auto shrink-0 font-bold text-turf" aria-hidden="true">✓</span>
	<span class="sr-only">Correct answer</span>
{:else if revealed && isChosen}
	<span class="ml-auto shrink-0 font-bold text-cardinal" aria-hidden="true">✗</span>
	<span class="sr-only">Your answer, incorrect</span>
{/if}
```

Confirm `sr-only` exists in `src/app.css`. Tailwind v4 provides it by default; if the project's theme block overrides the utility set, add it.

- [ ] **Step 4: Make the reveal panel a live region**

In `QuestionPlayer.svelte:133-135`:

```svelte
{#if revealed && mode === 'standard'}
	<div class="mt-5 rounded-lg bg-mist p-4" role="status" aria-live="polite">
```

`role="status"` carries an implicit `aria-live="polite"`; both are stated so the e2e selector and the behavior are explicit.

- [ ] **Step 5: Announce the streaming answer**

Putting `aria-live` on the messages `<section>` itself is the wrong approach: loading a saved conversation clears `messages` and repopulates it in one render, so a section-wide live region announces the entire transcript on every conversation open, not just the new answer. Scope the live region to the in-flight answer instead.

In `src/routes/ask/[[id]]/+page.svelte`, after the `{#each messages as message}` block and before the closing `</section>`, wrap the existing `{#if activeJob}` block (the thinking indicator, the streaming answer, and the stall notice) in a `<div>` that carries the live-region attributes:

```svelte
<div aria-live="polite" aria-busy={!!activeJob} class="space-y-5 {activeJob ? '' : '-mt-5'}">
	{#if activeJob}
		{#if !activeJob.streamingText}
			<p class="flex items-center gap-2 text-sm text-navy/60 italic">
				<!-- thinking indicator -->
			</p>
		{:else}
			<AskAnswer answer={activeJob.streamingText} streaming={true} />
		{/if}
		{#if activeJob.stalled}
			<p class="text-xs text-navy/50 italic">
				Taking longer than usual — you can stop and ask again.
			</p>
		{/if}
	{/if}
</div>
```

Render the wrapper `<div>` itself unconditionally, with `{#if activeJob}` inside it rather than around it. Assistive tech needs the live region to already be in the DOM before its content changes; a region that appears at the same moment as its content is not reliably announced. History rows stay outside the wrapper, so they are never part of what gets announced.

The wrapper is the section's last child, and the section uses Tailwind's `space-y-5`, which adds top margin to every child but the first. An idle wrapper has no visible content but still counts as a sibling, so it still picks up that margin and leaves a trailing gap under the last message row that isn't there today. The `-mt-5` on the idle wrapper cancels that margin through collapsing, and becomes a no-op once `activeJob` is truthy and the class switches away from it.

- [ ] **Step 6: Label the display-name input**

In `DisplayNameClaim.svelte:57-63`, add an accessible name to the input, which currently relies only on its placeholder:

```svelte
aria-label="Display name"
```

- [ ] **Step 7: Run the suites and verify they pass**

Run: `npx playwright test e2e/quiz.spec.ts e2e/ai.spec.ts e2e/leaderboard.spec.ts`

Expected: PASS. `leaderboard.spec.ts` is included because it exercises `DisplayNameClaim`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/quiz/QuestionPlayer.svelte "src/routes/ask/[[id]]/+page.svelte" src/lib/components/DisplayNameClaim.svelte e2e/quiz.spec.ts e2e/ai.spec.ts
git commit -m "fix(a11y): announce quiz results and streaming answers to screen readers"
```

---

### Task 9: Attempt timestamps are unbounded

`POST /api/attempts` accepts any `startedAt`, any `durationS` up to 24 hours, and any per-response `at`. A client can submit timestamps far in the past or future. This affects only the submitting user's own dashboard, never the leaderboard, which the signed run token protects, so it is a data-integrity fix rather than an anti-cheat one.

**Files:**

- Modify: `src/routes/api/attempts/+server.ts:9-25`
- Test: `e2e/quiz-sync.spec.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Read the current handler**

Read `src/routes/api/attempts/+server.ts` in full, plus `src/lib/quiz/payload.ts:17-24` for `AttemptPayloadSchema`. Note the existing section-mismatch check at lines 20-25; the new bound goes beside it, not inside the schema, because the schema is shared with the client where `Date.now()` differs.

- [ ] **Step 2: Write the failing test**

Add to `e2e/quiz-sync.spec.ts`. The payload is written out in full because this file has no builder helper; every field satisfies `AttemptPayloadSchema` in `src/lib/quiz/payload.ts:29-41`.

```ts
test('rejects an attempt whose startedAt is in the future', async ({ page }) => {
	await signUpTestUser(page, 'futurets');
	const validAttempt = () => ({
		clientId: crypto.randomUUID(), // schema requires a uuid
		rulesetId: 'usau-official-2026-27',
		mode: 'quick' as const,
		sectionSlug: null,
		startedAt: Date.now(),
		durationS: 30,
		responses: [{ questionId: '1-01', choiceIndex: 0, at: Date.now() }]
	});

	const ok = await page.request.post('/api/attempts', { data: validAttempt() });
	expect(ok.status()).toBe(201);

	const future = await page.request.post('/api/attempts', {
		data: { ...validAttempt(), startedAt: Date.now() + 60 * 60 * 1000 }
	});
	expect(future.status()).toBe(400);
});
```

The first POST is a control: it proves the payload is otherwise valid, so a 400 on the second can only come from the timestamp bound. If `201` is not the success status the handler returns, read `src/routes/api/attempts/+server.ts` and use its actual status rather than changing the handler.

- [ ] **Step 3: Run it and verify it fails**

Run: `npm run build && npx playwright test e2e/quiz-sync.spec.ts -g "future"`

Expected: FAIL with a 201, because nothing bounds the timestamp.

- [ ] **Step 4: Bound the timestamps**

In `src/routes/api/attempts/+server.ts`, after the payload parses and before the insert:

```ts
// Clock skew allowance for a client whose time runs ahead of the server's.
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const now = Date.now();
if (parsed.data.startedAt > now + CLOCK_SKEW_MS) error(400, 'startedAt is in the future');
if (parsed.data.responses.some((r) => r.at > now + CLOCK_SKEW_MS)) {
	error(400, 'response timestamp is in the future');
}
```

Declare `CLOCK_SKEW_MS` at module scope beside the existing constants rather than inside the handler.

Bounding the future is the fix worth making. A past `startedAt` is legitimate: the outbox in `src/lib/quiz/sync.ts` queues attempts offline and flushes them later, so a genuine attempt can arrive hours after it happened.

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx playwright test e2e/quiz-sync.spec.ts`

Expected: PASS, including the existing offline-flush cases, which is what proves the past-timestamp path still works.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/attempts/+server.ts e2e/quiz-sync.spec.ts
git commit -m "fix(quiz): reject attempt timestamps from the future"
```

---

### Task 10: Stream reader is never cancelled on the error path

`chat-stream.svelte.ts` reads `res.body.getReader()` in a `for(;;)` loop. On abort or network failure the exception is caught further down, but `reader.cancel()` is never called. Browsers generally tear the stream down via the abort controller, so this is defensive rather than a live leak.

**Files:**

- Modify: `src/lib/ask/chat-stream.svelte.ts:194-223`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Read the surrounding block**

Read `src/lib/ask/chat-stream.svelte.ts:180-270` in full. The reader loop sits inside a larger `try` whose `catch` at roughly line 245 classifies abort against network failure. The new `finally` must not swallow or reorder that classification.

- [ ] **Step 2: Wrap the loop**

Wrap only the `for(;;)` read loop and the trailing flush, leaving `handleLine` and the decoder declarations where they are:

```ts
try {
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		this.#armStall(job);
		lineBuffer += decoder.decode(value, { stream: true });
		let newline: number;
		while ((newline = lineBuffer.indexOf('\n')) !== -1) {
			handleLine(lineBuffer.slice(0, newline));
			lineBuffer = lineBuffer.slice(newline + 1);
		}
	}
	lineBuffer += decoder.decode();
	handleLine(lineBuffer);
} finally {
	// The abort controller normally tears this down; cancel explicitly so a
	// non-abort throw cannot leave the reader holding its lock.
	reader.cancel().catch(() => {});
}
```

- [ ] **Step 3: Verify the existing coverage still passes**

Run: `npm run check && npm run build && npx playwright test e2e/ai.spec.ts`

Expected: clean check and a passing suite. `e2e/ai.spec.ts` covers a Stop-button abort and a server-signalled mid-stream error, both of which exercise this `finally`. It has no case for a raw network drop — nothing in that file calls `route.abort()` — so the mid-stream network-drop branches stay untested end to end. That gap is intentional here: tranche 4 (Tests) adds a `chat-stream.svelte.ts` unit test with a stubbed `fetch`, which can simulate a dropped connection more reliably than Playwright can.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ask/chat-stream.svelte.ts
git commit -m "fix(ask): cancel the stream reader when the read loop exits"
```

---

### Task 11: Full verification

- [ ] **Step 1: Run the complete gate**

```bash
npm run check
npm run check:scripts
npm run test
npm run validate:content
npx prettier --check .
npm run build
npm run test:e2e
```

Expected: every command exits zero. Unit tests should now number more than the 217 baseline. If any e2e test fails, fix it before proceeding; do not mark the plan complete with a red suite.

- [ ] **Step 2: Confirm each fix has a test that would have caught it**

Walk tasks 1 through 10 and confirm each has an accompanying test that fails without the fix. Task 10 relies on existing e2e coverage for the abort and server-error paths rather than a new test; the mid-stream network-drop path is not covered here and is picked up by tranche 4 (Tests), as noted in that task.

- [ ] **Step 3: Report**

Summarize which bugs were fixed, the final test count against the 217 baseline, and anything deferred to a later tranche.
