# Ask History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in users see, re-read, re-ask, and (soft-)delete their previous `/ask` questions, rendered as a collapsed "Previous questions" list below the ask form.

**Architecture:** The `ai_asks` table already logs every ask server-side. We add a nullable `hidden_at` column (soft delete), two thin API endpoints (`GET /api/ai/asks` cursor-paginated, `DELETE /api/ai/asks/[id]`), an `x-bp-ask-id` response header on the existing ask endpoint, and a client-fetched history section on `/ask`. The citation-linking answer markup is extracted into a shared `AskAnswer.svelte` used by both the live answer and history entries.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, Tailwind v4, Drizzle ORM on Cloudflare D1, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-16-ask-history-design.md`

## Global Constraints

- Svelte 5 runes only (`$state`, `$derived`, `$props`) — no legacy `export let` / stores in components.
- No new dependencies.
- Only `status = 'answered'` and `status = 'truncated'` rows appear in history; `error` rows are excluded server-side.
- Page size default 10, clamp 1–50, newest first, cursor = `createdAt` of the last entry.
- Delete is soft: set `hidden_at`, never remove the row (it is the owner's Q&A quality log).
- History failures must never block the ask flow — degrade to a muted inline message.
- Run `npm run format` before every commit (CI runs `prettier --check`).
- Verification commands: `npm test` (Vitest), `npm run check` (svelte-check), `npx playwright test e2e/ai.spec.ts` (e2e; builds the app first, slow but required for UI tasks).

---

### Task 1: Schema + migration (`hidden_at` column)

**Files:**
- Modify: `src/lib/server/db/schema.ts` (the `aiAsks` table, around line 196–212)
- Create (generated): `drizzle/0004_ask-history.sql`

**Interfaces:**
- Consumes: existing `aiAsks` table definition.
- Produces: `aiAsks.hiddenAt` column (`integer('hidden_at')`, nullable, ms epoch; `NULL` = visible) — Tasks 3 uses `isNull(aiAsks.hiddenAt)` and `.set({ hiddenAt: Date.now() })`.

- [ ] **Step 1: Add the column to the Drizzle schema**

In `src/lib/server/db/schema.ts`, inside the `aiAsks` table definition, add `hiddenAt` after `createdAt`:

```ts
		// answered = stream completed; truncated = MAX_TOKENS cut it short; error = no stream (502 path)
		status: text('status', { enum: ['answered', 'truncated', 'error'] }).notNull(),
		createdAt: integer('created_at').notNull(),
		hiddenAt: integer('hidden_at') // ms epoch; NULL = visible in the user's ask history (soft delete)
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate --name ask-history`
Expected: creates `drizzle/0004_ask-history.sql` containing `ALTER TABLE \`ai_asks\` ADD \`hidden_at\` integer;` and updates `drizzle/meta/`.

- [ ] **Step 3: Apply locally and verify**

Run: `npm run db:migrate:local`
Expected: "1 migration applied" (or similar success output), no errors.

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
npm run format
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat: add hidden_at soft-delete column to ai_asks"
```

---

### Task 2: Wire shapes + history query helpers (TDD)

**Files:**
- Modify: `src/lib/ai/payload.ts` (append at end)
- Create: `src/lib/server/ai/history.ts`
- Test: `src/lib/server/ai/history.test.ts`

**Interfaces:**
- Produces (from `$lib/ai/payload`):
  ```ts
  export interface AskHistoryEntry {
  	id: string;
  	prompt: string;
  	answer: string | null;
  	status: 'answered' | 'truncated';
  	createdAt: number; // ms epoch
  }
  export interface AskHistoryResponse {
  	asks: AskHistoryEntry[];
  	hasMore: boolean;
  }
  ```
- Produces (from `$lib/server/ai/history`):
  ```ts
  export function parseHistoryQuery(params: URLSearchParams): { before: number | null; limit: number };
  export function pageRows<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean };
  ```
  Semantics: `before`/`limit` must be positive safe integers; anything else (missing, empty, garbage, zero, negative, fractional) falls back to `null` / `10`. `limit` is capped at 50. `pageRows` expects `limit + 1` rows fetched and trims the sentinel.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/ai/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pageRows, parseHistoryQuery } from './history';

describe('parseHistoryQuery', () => {
	it('defaults to no cursor and limit 10', () => {
		expect(parseHistoryQuery(new URLSearchParams())).toEqual({ before: null, limit: 10 });
	});
	it('parses a valid before cursor and limit', () => {
		expect(parseHistoryQuery(new URLSearchParams('before=1752600000000&limit=25'))).toEqual({
			before: 1752600000000,
			limit: 25
		});
	});
	it('ignores garbage, non-positive, and fractional cursors', () => {
		expect(parseHistoryQuery(new URLSearchParams('before=abc')).before).toBeNull();
		expect(parseHistoryQuery(new URLSearchParams('before=-5')).before).toBeNull();
		expect(parseHistoryQuery(new URLSearchParams('before=1.5')).before).toBeNull();
		expect(parseHistoryQuery(new URLSearchParams('before=')).before).toBeNull();
	});
	it('caps limit at 50 and defaults invalid limits to 10', () => {
		expect(parseHistoryQuery(new URLSearchParams('limit=999')).limit).toBe(50);
		expect(parseHistoryQuery(new URLSearchParams('limit=0')).limit).toBe(10);
		expect(parseHistoryQuery(new URLSearchParams('limit=abc')).limit).toBe(10);
		expect(parseHistoryQuery(new URLSearchParams('limit=1')).limit).toBe(1);
	});
});

describe('pageRows', () => {
	it('returns all rows with hasMore=false when at or under the limit', () => {
		expect(pageRows([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
	});
	it('trims the sentinel row and sets hasMore when limit+1 rows come back', () => {
		expect(pageRows([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
	});
	it('handles empty input', () => {
		expect(pageRows([], 10)).toEqual({ items: [], hasMore: false });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/ai/history.test.ts`
Expected: FAIL — cannot resolve `./history`.

- [ ] **Step 3: Implement**

Create `src/lib/server/ai/history.ts`:

```ts
/** Query parsing + pagination helpers for GET /api/ai/asks. */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function toPositiveInt(raw: string | null): number | null {
	if (raw === null || raw === '') return null;
	const n = Number(raw);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function parseHistoryQuery(params: URLSearchParams): {
	before: number | null;
	limit: number;
} {
	const limit = toPositiveInt(params.get('limit'));
	return {
		before: toPositiveInt(params.get('before')),
		limit: limit === null ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT)
	};
}

/** Given `limit + 1` fetched rows, trims the sentinel row and reports whether more pages exist. */
export function pageRows<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
	return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
```

Append to `src/lib/ai/payload.ts`:

```ts
/** One entry in a user's ask history (GET /api/ai/asks). `error` asks are never returned. */
export interface AskHistoryEntry {
	id: string;
	prompt: string;
	answer: string | null;
	status: 'answered' | 'truncated';
	createdAt: number; // ms epoch
}

export interface AskHistoryResponse {
	asks: AskHistoryEntry[];
	hasMore: boolean;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/ai/history.test.ts`
Expected: PASS (7 tests).

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/lib/server/ai/history.ts src/lib/server/ai/history.test.ts src/lib/ai/payload.ts
git commit -m "feat: ask-history wire shapes and query helpers"
```

---

### Task 3: GET and DELETE endpoints

**Files:**
- Create: `src/routes/api/ai/asks/+server.ts`
- Create: `src/routes/api/ai/asks/[id]/+server.ts`

**Interfaces:**
- Consumes: `parseHistoryQuery`, `pageRows` from `$lib/server/ai/history` (Task 2); `aiAsks` (with `hiddenAt`, Task 1) from `$lib/server/db/schema`; `requireUser` from `$lib/server/session`.
- Produces:
  - `GET /api/ai/asks?before=<ms>&limit=<n>` → `AskHistoryResponse` JSON (`{ asks, hasMore }`), newest first, scoped to the session user, excluding hidden and `error` rows. 401 when signed out.
  - `DELETE /api/ai/asks/<id>` → `{ ok: true }` always (idempotent; no existence oracle). Sets `hiddenAt` only on the caller's own row.

These follow the `src/routes/api/bookmarks/+server.ts` pattern: `requireUser(event)`, Drizzle via `event.locals.db`, `json(...)` responses.

- [ ] **Step 1: Implement the GET endpoint**

Create `src/routes/api/ai/asks/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { and, desc, eq, isNull, lt, ne } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { pageRows, parseHistoryQuery } from '$lib/server/ai/history';
import { aiAsks } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { before, limit } = parseHistoryQuery(event.url.searchParams);
	const conditions = [
		eq(aiAsks.userId, user.id),
		isNull(aiAsks.hiddenAt),
		ne(aiAsks.status, 'error') // error rows have no answer to show
	];
	if (before !== null) conditions.push(lt(aiAsks.createdAt, before));
	const rows = await event.locals.db
		.select({
			id: aiAsks.id,
			prompt: aiAsks.prompt,
			answer: aiAsks.answer,
			status: aiAsks.status,
			createdAt: aiAsks.createdAt
		})
		.from(aiAsks)
		.where(and(...conditions))
		.orderBy(desc(aiAsks.createdAt))
		.limit(limit + 1); // sentinel row for hasMore
	const { items, hasMore } = pageRows(rows, limit);
	return json({ asks: items, hasMore });
};
```

- [ ] **Step 2: Implement the DELETE endpoint**

Create `src/routes/api/ai/asks/[id]/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { aiAsks } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

// Soft delete: the ai_asks row doubles as the Q&A quality log, so we hide, never remove.
export const DELETE: RequestHandler = async (event) => {
	const user = await requireUser(event);
	await event.locals.db
		.update(aiAsks)
		.set({ hiddenAt: Date.now() })
		.where(
			and(
				eq(aiAsks.id, event.params.id),
				eq(aiAsks.userId, user.id),
				isNull(aiAsks.hiddenAt)
			)
		);
	return json({ ok: true }); // idempotent; no existence oracle for other users' ask ids
};
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: 0 errors (this also regenerates `./$types` for the new routes via `svelte-kit sync`).

Run: `npm test`
Expected: all existing tests still PASS.

(End-to-end behavior of these endpoints is covered by the e2e test in Task 8, which exercises the real endpoints against local D1.)

- [ ] **Step 4: Commit**

```bash
npm run format
git add src/routes/api/ai/asks/
git commit -m "feat: ask-history GET and soft-delete endpoints"
```

---

### Task 4: Return `x-bp-ask-id` from POST /api/ai/ask

**Files:**
- Modify: `src/routes/api/ai/ask/+server.ts:95-101` (the final `new Response(...)`)

**Interfaces:**
- Consumes: the existing `askId` constant (`crypto.randomUUID()`, already defined at line 55).
- Produces: `x-bp-ask-id: <uuid>` response header on successful ask responses. Task 7's page code reads it to prepend the just-asked Q&A to the history list.

- [ ] **Step 1: Add the header**

In `src/routes/api/ai/ask/+server.ts`, change the returned `Response` headers:

```ts
	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store',
			'x-bp-ai-remaining': String(decision.remaining),
			'x-bp-ask-id': askId // lets the client add this ask to its history list without a refetch
		}
	});
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: 0 errors.

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
npm run format
git add src/routes/api/ai/ask/+server.ts
git commit -m "feat: expose ask id via x-bp-ask-id response header"
```

---

### Task 5: `timeAgo` helper (TDD)

**Files:**
- Create: `src/lib/time.ts`
- Test: `src/lib/time.test.ts`

**Interfaces:**
- Produces (from `$lib/time`):
  ```ts
  export function timeAgo(then: number, now?: number): string;
  ```
  `now` defaults to `Date.now()`. Output: `'just now'` (< 60s), `'Xm ago'`, `'Xh ago'`, `'Xd ago'`, `'Xw ago'` (< 5 weeks), then a short date like `'Jun 1, 2026'`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { timeAgo } from './time';

const NOW = Date.UTC(2026, 6, 16, 12, 0, 0); // 2026-07-16T12:00:00Z

describe('timeAgo', () => {
	it('says "just now" under a minute (and for clock skew into the future)', () => {
		expect(timeAgo(NOW - 30_000, NOW)).toBe('just now');
		expect(timeAgo(NOW + 5_000, NOW)).toBe('just now');
	});
	it('formats minutes, hours, days, and weeks', () => {
		expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe('5m ago');
		expect(timeAgo(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
		expect(timeAgo(NOW - 2 * 86_400_000, NOW)).toBe('2d ago');
		expect(timeAgo(NOW - 10 * 86_400_000, NOW)).toBe('1w ago');
	});
	it('falls back to a short date at 5+ weeks', () => {
		expect(timeAgo(Date.UTC(2026, 5, 1), NOW)).toBe('Jun 1, 2026');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/time.test.ts`
Expected: FAIL — cannot resolve `./time`.

- [ ] **Step 3: Implement**

Create `src/lib/time.ts`:

```ts
/** Compact relative timestamp: "just now", "5m ago", "3h ago", "2d ago", "1w ago", then "Jun 1, 2026". */
export function timeAgo(then: number, now: number = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - then) / 1000));
	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks}w ago`;
	return new Date(then).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/time.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/lib/time.ts src/lib/time.test.ts
git commit -m "feat: add timeAgo relative-timestamp helper"
```

---

### Task 6: Extract `AskAnswer.svelte`

**Files:**
- Create: `src/lib/components/AskAnswer.svelte`
- Modify: `src/routes/ask/+page.svelte` (remove the inlined citation markup and now-unused imports/derivations)

**Interfaces:**
- Consumes: `segmentCitations` from `$lib/content/citations`, `ruleIdSet` from `$lib/content/rule-id-sets`, `sectionSlugForRuleId` from `$lib/content/rule-ids`, `DEFAULT_RULESET_ID` from `$lib/content/config` — all existing.
- Produces: `AskAnswer.svelte` with props `{ answer: string; streaming?: boolean }`. Renders the answer with rule-citation links exactly as the ask page does today, plus the pulsing cursor when `streaming` is true. Task 7's history entries reuse it.

**Behavior must not change** — the existing e2e ask tests (citation links, streaming) are the regression gate.

- [ ] **Step 1: Create the component**

Create `src/lib/components/AskAnswer.svelte` (markup moved verbatim from the ask page):

```svelte
<script lang="ts">
	import { segmentCitations } from '$lib/content/citations';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { ruleIdSet } from '$lib/content/rule-id-sets';
	import { sectionSlugForRuleId } from '$lib/content/rule-ids';

	let { answer, streaming = false }: { answer: string; streaming?: boolean } = $props();

	const ruleIds = ruleIdSet(DEFAULT_RULESET_ID);
	const segments = $derived(segmentCitations(answer, ruleIds));

	function refHref(id: string): string | null {
		const slug = sectionSlugForRuleId(id);
		return slug ? `/rules/${DEFAULT_RULESET_ID}/${slug}#${encodeURIComponent(id)}` : null;
	}
</script>

<p class="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap">
	{#each segments as segment, i (i)}
		{#if segment.type === 'text'}{segment.text}{:else}
			{@const link = refHref(segment.anchorId)}
			{#if link}
				<a
					href={link}
					target="_blank"
					rel="noopener"
					title="Open rule {segment.anchorId} in the explorer"
					class="font-mono text-[13px] font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
					>{segment.id}</a
				>
			{:else}<span class="font-mono text-[13px] font-semibold">{segment.id}</span>{/if}
		{/if}
	{/each}{#if streaming}<span
			class="ml-0.5 inline-block h-4 w-2 animate-pulse bg-cardinal/60"
			aria-hidden="true"
		></span>{/if}
</p>
```

- [ ] **Step 2: Use it from the ask page**

In `src/routes/ask/+page.svelte`:

1. Remove these imports (now only used by the component): `segmentCitations`, `ruleIdSet`, `sectionSlugForRuleId`, `DEFAULT_RULESET_ID`. Add:
   ```ts
   import AskAnswer from '$lib/components/AskAnswer.svelte';
   ```
2. Remove the module-level `const ruleIds = ...`, the `const segments = $derived(...)`, and the `refHref` function.
3. Replace the answer `<p>…</p>` block (the `{:else}` branch of the answer card, currently lines 194–213) with:
   ```svelte
   <AskAnswer {answer} streaming={phase === 'streaming'} />
   ```
   The surrounding card `<div>`, the "Answer" heading, and the `{#if phase === 'streaming' && !answer}` thinking branch stay exactly as they are.

- [ ] **Step 3: Verify no behavior change**

Run: `npm run check`
Expected: 0 errors, no unused-import warnings for the ask page.

Run: `npx playwright test e2e/ai.spec.ts`
Expected: all existing ask tests PASS (citation links still resolve, streaming still renders).

- [ ] **Step 4: Commit**

```bash
npm run format
git add src/lib/components/AskAnswer.svelte src/routes/ask/+page.svelte
git commit -m "refactor: extract AskAnswer citation-rendering component"
```

---

### Task 7: `AskHistory.svelte` + `/ask` page integration

**Files:**
- Create: `src/lib/components/AskHistory.svelte`
- Modify: `src/routes/ask/+page.svelte`

**Interfaces:**
- Consumes: `AskHistoryEntry`, `AskHistoryResponse` from `$lib/ai/payload` (Task 2); `timeAgo` from `$lib/time` (Task 5); `AskAnswer.svelte` (Task 6); `GET /api/ai/asks` + `DELETE /api/ai/asks/<id>` (Task 3); `x-bp-ask-id` header (Task 4).
- Produces: `AskHistory.svelte` with prop `{ onAskAgain: (prompt: string) => void }` and an exported instance method `prepend(entry: AskHistoryEntry): void` (call via `bind:this`).

Behavior (from spec): fetch page 1 on mount; pulse skeleton while loading; render nothing when history is empty; muted inline error on fetch/delete failure ("Couldn't load your previous questions." / "Couldn't delete that question — try again."); rows expand in place (one at a time); optimistic delete with rollback; Load more while `hasMore`; never blocks the ask flow.

- [ ] **Step 1: Create the history component**

Create `src/lib/components/AskHistory.svelte`:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import type { AskHistoryEntry, AskHistoryResponse } from '$lib/ai/payload';
	import AskAnswer from '$lib/components/AskAnswer.svelte';
	import { timeAgo } from '$lib/time';

	let { onAskAgain }: { onAskAgain: (prompt: string) => void } = $props();

	let entries = $state<AskHistoryEntry[]>([]);
	let hasMore = $state(false);
	let loading = $state(true);
	let loadingMore = $state(false);
	let errorMessage = $state<string | null>(null);
	let expandedId = $state<string | null>(null);

	/** Called by the ask page (via bind:this) when a live ask completes. */
	export function prepend(entry: AskHistoryEntry) {
		entries = [entry, ...entries];
	}

	async function fetchPage(before: number | null): Promise<AskHistoryResponse | null> {
		try {
			const res = await fetch(before === null ? '/api/ai/asks' : `/api/ai/asks?before=${before}`);
			if (!res.ok) return null;
			return (await res.json()) as AskHistoryResponse;
		} catch {
			return null;
		}
	}

	onMount(async () => {
		const page = await fetchPage(null);
		loading = false;
		if (!page) {
			errorMessage = "Couldn't load your previous questions.";
			return;
		}
		entries = page.asks;
		hasMore = page.hasMore;
	});

	async function loadMore() {
		if (loadingMore || entries.length === 0) return;
		loadingMore = true;
		const page = await fetchPage(entries[entries.length - 1].createdAt);
		loadingMore = false;
		if (!page) {
			errorMessage = "Couldn't load your previous questions.";
			return;
		}
		errorMessage = null;
		entries = [...entries, ...page.asks];
		hasMore = page.hasMore;
	}

	async function remove(entry: AskHistoryEntry) {
		const index = entries.indexOf(entry);
		entries = entries.filter((e) => e !== entry); // optimistic
		if (expandedId === entry.id) expandedId = null;
		try {
			const res = await fetch(`/api/ai/asks/${encodeURIComponent(entry.id)}`, {
				method: 'DELETE'
			});
			if (!res.ok) throw new Error(String(res.status));
			errorMessage = null;
		} catch {
			entries = [...entries.slice(0, index), entry, ...entries.slice(index)]; // rollback
			errorMessage = "Couldn't delete that question — try again.";
		}
	}

	function toggle(id: string) {
		expandedId = expandedId === id ? null : id;
	}
</script>

{#if loading}
	<div class="mt-6 h-24 animate-pulse rounded-xl bg-white/10" aria-hidden="true"></div>
{:else if entries.length > 0 || errorMessage}
	<section class="card mt-6 p-6 sm:p-8" aria-label="Previous questions">
		<h2 class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">
			Previous questions
		</h2>
		{#if errorMessage}
			<p class="mt-3 text-sm text-navy/50" role="alert">{errorMessage}</p>
		{/if}
		<ul class="mt-2 divide-y divide-mist">
			{#each entries as entry (entry.id)}
				<li class="py-3">
					<button
						type="button"
						class="flex w-full items-baseline gap-3 text-left"
						aria-expanded={expandedId === entry.id}
						onclick={() => toggle(entry.id)}
					>
						<span class="min-w-0 flex-1 text-sm {expandedId === entry.id ? '' : 'truncate'}">
							{entry.prompt}
						</span>
						<span class="shrink-0 text-xs text-navy/40">{timeAgo(entry.createdAt)}</span>
					</button>
					{#if expandedId === entry.id}
						{#if entry.answer}
							<AskAnswer answer={entry.answer} />
						{/if}
						{#if entry.status === 'truncated'}
							<p class="mt-2 text-xs text-navy/50 italic">This answer was cut short.</p>
						{/if}
						<div class="mt-3 flex gap-5">
							<button
								type="button"
								class="text-xs font-semibold tracking-wider text-cardinal uppercase hover:underline"
								onclick={() => onAskAgain(entry.prompt)}
							>
								Ask again
							</button>
							<button
								type="button"
								class="text-xs font-semibold tracking-wider text-navy/50 uppercase hover:underline"
								onclick={() => remove(entry)}
							>
								Delete
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		{#if hasMore}
			<button
				type="button"
				disabled={loadingMore}
				onclick={loadMore}
				class="mt-4 text-xs font-semibold tracking-wider text-navy/50 uppercase hover:text-navy disabled:opacity-40"
			>
				{loadingMore ? 'Loading…' : 'Load more'}
			</button>
		{/if}
	</section>
{/if}
```

Notes for the implementer:
- The component is only rendered inside the signed-in branch (Step 2), so `onMount` never fires signed-out and the fetch can't 401 in normal use.
- `entries.length > 0 || errorMessage` means an empty history renders nothing (spec: no empty-state card).
- `aria-label` on `<section>` gives it the `region` role the e2e test targets.

- [ ] **Step 2: Wire it into the ask page**

In `src/routes/ask/+page.svelte`:

1. Add imports:
   ```ts
   import type { AskHistoryEntry } from '$lib/ai/payload';
   import AskHistory from '$lib/components/AskHistory.svelte';
   ```
2. Add state next to the other `$state` declarations:
   ```ts
   let historyList = $state<{ prepend: (entry: AskHistoryEntry) => void } | null>(null);
   let textareaEl = $state<HTMLTextAreaElement | null>(null);
   ```
3. Bind the textarea: add `bind:this={textareaEl}` to the existing `<textarea id="ask-input" …>`.
4. Add the ask-again handler (near `signIn`):
   ```ts
   function askAgain(prompt: string) {
   	question = prompt;
   	textareaEl?.focus();
   	textareaEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
   }
   ```
5. In `submit()`, track truncation and the ask id, and prepend on clean completion. Three edits:

   a. In the `handleLine` helper, add a local flag. Before `const handleLine = …` add:
   ```ts
   let wasTruncated = false;
   ```
   and change the truncated branch to set it:
   ```ts
   else if (msg.t === 'truncated') {
   	wasTruncated = true;
   	errorMessage = 'The answer was cut short — try asking again.';
   }
   ```

   b. Where the `x-bp-ai-remaining` header is read, also read the ask id:
   ```ts
   const askId = res.headers.get('x-bp-ask-id');
   ```

   c. Replace the final `phase = 'done';` (the clean-completion line at the end of the `try` block, NOT the one in the `catch`) with:
   ```ts
   phase = 'done';
   if (askId) {
   	historyList?.prepend({
   		id: askId,
   		prompt,
   		answer,
   		status: wasTruncated ? 'truncated' : 'answered',
   		createdAt: Date.now()
   	});
   }
   ```
   (`prompt` is the trimmed question captured at the top of `submit()` — use it, not `question`, since the user may edit the textarea while the answer streams. Do NOT prepend in the `catch` path: on a dropped connection the server's logged row is the source of truth and appears on next load.)
6. Render the history section after the answer card, still inside the signed-in `{:else}` branch (i.e. after the `{#if answer || phase === 'streaming'}…{/if}` block):
   ```svelte
   <AskHistory bind:this={historyList} onAskAgain={askAgain} />
   ```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: 0 errors.

Run: `npx playwright test e2e/ai.spec.ts`
Expected: existing ask tests still PASS. (History renders nothing for these tests' fresh users — the real `GET /api/ai/asks` returns an empty page. New e2e coverage lands in Task 8.)

- [ ] **Step 4: Commit**

```bash
npm run format
git add src/lib/components/AskHistory.svelte src/routes/ask/+page.svelte
git commit -m "feat: previous-questions history on the ask page"
```

---

### Task 8: E2E coverage + README

**Files:**
- Modify: `e2e/ai.spec.ts` (append a new `test.describe` block)
- Modify: `README.md` (the "AI features" `- **Ask**` bullet)

**Interfaces:**
- Consumes: the full feature (Tasks 1–7); `signUpTestUser` from `e2e/helpers.ts`; existing mocked-ndjson ask pattern in `e2e/ai.spec.ts`.

Test strategy: the ask POST must be mocked (no Gemini in e2e), but `GET /api/ai/asks` and `DELETE /api/ai/asks/<id>` run for real against local D1 in the first test — a fresh user's history is genuinely empty, the prepended entry comes from `x-bp-ask-id`, and delete hits the real idempotent endpoint. The second test mocks GET to exercise pagination, the truncated note, and Ask again deterministically.

- [ ] **Step 1: Append the history tests**

Append to `e2e/ai.spec.ts`:

```ts
test.describe('ask history', () => {
	test('a completed ask appears in history, expands, and deletes (real GET/DELETE)', async ({
		page
	}) => {
		await signUpTestUser(page, 'ask-history');
		await page.route('**/api/ai/ask', (route) =>
			route.fulfill({
				status: 200,
				headers: {
					'content-type': 'application/x-ndjson; charset=utf-8',
					'x-bp-ai-remaining': '9',
					'x-bp-ask-id': '11111111-1111-1111-1111-111111111111'
				},
				body: '{"t":"text","text":"Yes — per [15.D] that is a turnover."}\n'
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox').fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^ask$/i }).click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();

		const history = page.getByRole('region', { name: 'Previous questions' });
		const row = history.getByRole('button', { name: /is it a stall at ten\?/i });
		await expect(row).toBeVisible();
		await row.click();
		await expect(history.getByText(/that is a turnover/)).toBeVisible();
		await history.getByRole('button', { name: 'Delete' }).click();
		await expect(row).toHaveCount(0);
	});

	test('history list: truncated note, ask again, and load more', async ({ page }) => {
		await signUpTestUser(page, 'ask-history-list');
		const PAGE1 = {
			asks: [
				{
					id: 'h1',
					prompt: 'What is a callahan goal?',
					answer: 'Per [12.C] an interception in the attacking end zone is a goal.',
					status: 'answered',
					createdAt: 1752600000000
				},
				{
					id: 'h2',
					prompt: 'Can the marker straddle the pivot?',
					answer: 'Partially answered before the limit',
					status: 'truncated',
					createdAt: 1752500000000
				}
			],
			hasMore: true
		};
		const PAGE2 = {
			asks: [
				{
					id: 'h3',
					prompt: 'What is best perspective?',
					answer: 'The player with the best view of the play [1.H].',
					status: 'answered',
					createdAt: 1752400000000
				}
			],
			hasMore: false
		};
		await page.route('**/api/ai/asks*', (route) => {
			const before = new URL(route.request().url()).searchParams.get('before');
			return route.fulfill({ json: before ? PAGE2 : PAGE1 });
		});
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');

		const history = page.getByRole('region', { name: 'Previous questions' });
		await history.getByRole('button', { name: /can the marker straddle/i }).click();
		await expect(history.getByText(/cut short/i)).toBeVisible();

		await history.getByRole('button', { name: /what is a callahan goal\?/i }).click();
		await history.getByRole('button', { name: 'Ask again' }).click();
		await expect(page.getByRole('textbox')).toHaveValue('What is a callahan goal?');

		await history.getByRole('button', { name: 'Load more' }).click();
		await expect(history.getByRole('button', { name: /what is best perspective\?/i })).toBeVisible();
		await expect(history.getByRole('button', { name: 'Load more' })).toHaveCount(0);
	});
});
```

Route-pattern caveat: the mock uses `**/api/ai/asks*` (matches `/api/ai/asks` and `/api/ai/asks?before=…` but not the DELETE path `/api/ai/asks/h1` — Playwright globs don't match `/` with a single `*`). In the second test DELETE is never called; in the first test GET/DELETE are deliberately unmocked.

Second test expand caveat: two disclosure rows are open at once is impossible (one-at-a-time `expandedId`) — the test expands h2, checks the note, then expands h1 (which collapses h2) before clicking Ask again. The `Ask again` locator is unambiguous because only one row is expanded.

- [ ] **Step 2: Run the e2e suite**

Run: `npx playwright test e2e/ai.spec.ts`
Expected: all tests PASS, including the two new ones.

- [ ] **Step 3: Update the README**

In `README.md`, replace the Ask bullet under "AI features":

```markdown
- **Ask** (`/ask`, `POST /api/ai/ask`) — streamed Q&A over the rulebook; answers cite back to specific rules. Previously asked questions are listed on the page — re-read the answer, re-ask, or delete them (`GET/DELETE /api/ai/asks`, soft delete).
```

- [ ] **Step 4: Full verification + commit**

Run: `npm test && npm run check && npm run lint`
Expected: all PASS.

```bash
npm run format
git add e2e/ai.spec.ts README.md
git commit -m "test: e2e coverage for ask history; document in README"
```
