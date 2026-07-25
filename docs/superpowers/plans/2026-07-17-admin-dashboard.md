# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, read-only `/admin` area for the site owner: usage/health metric tiles, an AI-conversation quality-review surface with 👍/👎 signals, and per-table capped CSV export.

**Architecture:** Server-rendered SvelteKit routes under `/admin`, gated by a new `requireAdmin()` that checks the signed-in email against an `ADMIN_EMAILS` env allowlist and throws **404** (never 403) on failure. All data is fetched in server `load` functions and export endpoints — raw rows reach the client only as rendered HTML or a downloaded file. Aggregate math lives in pure, unit-tested helpers; the Drizzle queries that feed them are covered by seeded-D1 e2e.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes) on Cloudflare Workers, D1 + Drizzle ORM, better-auth, Vitest (unit), Playwright + `wrangler d1 execute` (seeded e2e), Tailwind v4.

## Global Constraints

- No new runtime dependencies. No charting library — metrics visuals are hand-rolled CSS/`<div>` bars.
- Admin access is an **env email allowlist** (`ADMIN_EMAILS`, comma-separated, case-insensitive). No `role` column, no DB migration.
- Failure to authorize is always **HTTP 404** ("Not found"), for signed-out and signed-in-non-admin alike — the admin area never advertises its existence. Fail closed: empty/unset `ADMIN_EMAILS` denies everyone.
- The `users` export exposes only `id, email, name, displayName, createdAt`. Never export `session`, `account`, `verification`, tokens, or password columns.
- Export responses are capped at `EXPORT_MAX_ROWS = 10000`, newest-first; truncation is surfaced in the UI, never by failing the download.
- Reuse existing helpers: `parseHistoryQuery`/`pageRows` (`$lib/server/ai/history`), `timeAgo` (`$lib/time`), `AskAnswer` (`$lib/components/AskAnswer.svelte`), AI cap constants (`$lib/server/ai/config`). Do not duplicate them.
- Pure helpers take injected `now`/`today` — never call `Date.now()` inside logic that a unit test asserts on.
- Conventional-commit messages; end each with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Create**
- `src/lib/server/admin/csv.ts` — CSV serialization + RFC-4180 escaping (pure).
- `src/lib/server/admin/csv.test.ts`
- `src/lib/server/admin/metrics-math.ts` — pure derived-metric helpers (ratios, daily-bucket filling).
- `src/lib/server/admin/metrics-math.test.ts`
- `src/lib/server/admin/metrics.ts` — Drizzle aggregate queries returning a `DashboardMetrics` object.
- `src/lib/server/admin/datasets.ts` — export `DATASETS` registry (slug → query + ordered columns).
- `src/routes/admin/+layout.server.ts` — `requireAdmin` gate for the whole section.
- `src/routes/admin/+layout.svelte` — admin nav shell.
- `src/routes/admin/+page.server.ts` / `+page.svelte` — metrics dashboard.
- `src/routes/admin/ai/+page.server.ts` / `+page.svelte` — conversation list.
- `src/routes/admin/ai/[id]/+page.server.ts` / `+page.svelte` — transcript.
- `src/routes/admin/export/+page.server.ts` / `+page.svelte` — download buttons + counts.
- `src/routes/admin/export/[dataset].csv/+server.ts` — gated capped CSV stream.
- `e2e/admin.spec.ts`

**Modify**
- `src/lib/server/session.ts` — add `parseAdminEmails` + `requireAdmin`.
- `src/lib/server/session.test.ts` — **create** alongside (no test exists today).
- `src/hooks.server.ts` — add `/admin` to the `dynamic` path check so `locals.db`/`locals.auth` are wired.
- `src/app.d.ts` — add `ADMIN_EMAILS?: string` to `Platform.env`.
- `wrangler.jsonc` — add `ADMIN_EMAILS` to `vars`.
- `e2e/helpers.ts` — let `signUpTestUser` accept an explicit email; export `ADMIN_EMAIL`.
- `README.md` — short "Admin" section.

---

## Task 1: Admin access gate + env plumbing

**Files:**
- Modify: `src/lib/server/session.ts`
- Create: `src/lib/server/session.test.ts`
- Modify: `src/hooks.server.ts`, `src/app.d.ts`, `wrangler.jsonc`

**Interfaces:**
- Produces: `parseAdminEmails(raw: string | null | undefined): Set<string>` and `async requireAdmin(event: RequestEvent): Promise<User>` where `User` is better-auth's session user (has `.id`, `.email`). Both exported from `$lib/server/session`. `requireAdmin` returns the user on success and throws `error(404)` otherwise.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { parseAdminEmails, requireAdmin } from './session';

describe('parseAdminEmails', () => {
	it('splits, trims, lowercases, drops empties', () => {
		const set = parseAdminEmails(' A@x.com , b@Y.com ,, ');
		expect([...set].sort()).toEqual(['a@x.com', 'b@y.com']);
	});
	it('empty / null / undefined → empty set (deny all)', () => {
		expect(parseAdminEmails('').size).toBe(0);
		expect(parseAdminEmails(null).size).toBe(0);
		expect(parseAdminEmails(undefined).size).toBe(0);
	});
});

function fakeEvent(opts: {
	auth?: boolean;
	session?: { user: { id: string; email: string } } | null;
	adminEmails?: string;
}): RequestEvent {
	return {
		locals: {
			auth: opts.auth === false ? undefined : { api: { getSession: async () => opts.session ?? null } }
		},
		request: { headers: new Headers() },
		platform: { env: { ADMIN_EMAILS: opts.adminEmails } }
	} as unknown as RequestEvent;
}

describe('requireAdmin', () => {
	it('returns the user when email is allowlisted (case-insensitive)', async () => {
		const ev = fakeEvent({
			session: { user: { id: 'u1', email: 'Boss@Site.com' } },
			adminEmails: 'boss@site.com'
		});
		const user = await requireAdmin(ev);
		expect(user.id).toBe('u1');
	});
	it('404 when signed in but not allowlisted', async () => {
		const ev = fakeEvent({ session: { user: { id: 'u2', email: 'x@x.com' } }, adminEmails: 'boss@site.com' });
		await expect(requireAdmin(ev)).rejects.toMatchObject({ status: 404 });
	});
	it('404 when signed out', async () => {
		const ev = fakeEvent({ session: null, adminEmails: 'boss@site.com' });
		await expect(requireAdmin(ev)).rejects.toMatchObject({ status: 404 });
	});
	it('404 when ADMIN_EMAILS is unset (fail closed)', async () => {
		const ev = fakeEvent({ session: { user: { id: 'u3', email: 'boss@site.com' } } });
		await expect(requireAdmin(ev)).rejects.toMatchObject({ status: 404 });
	});
	it('404 when auth binding is missing', async () => {
		const ev = fakeEvent({ auth: false, adminEmails: 'boss@site.com' });
		await expect(requireAdmin(ev)).rejects.toMatchObject({ status: 404 });
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/lib/server/session.test.ts`
Expected: FAIL — `parseAdminEmails`/`requireAdmin` are not exported.

- [ ] **Step 3: Implement the gate**

Append to `src/lib/server/session.ts` (keep the existing `requireUser`):

```ts
/** Parse the ADMIN_EMAILS allowlist into a lowercased Set. Empty/unset → deny all. */
export function parseAdminEmails(raw: string | null | undefined): Set<string> {
	if (!raw) return new Set();
	return new Set(
		raw
			.split(',')
			.map((e) => e.trim().toLowerCase())
			.filter((e) => e.length > 0)
	);
}

/**
 * Returns the signed-in user iff their email is in ADMIN_EMAILS, else throws 404.
 * 404 (not 401/403) on every failure path so the admin area never advertises itself.
 */
export async function requireAdmin(event: RequestEvent) {
	if (!event.locals.auth) error(404, 'Not found');
	const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
	if (!session) error(404, 'Not found');
	const admins = parseAdminEmails(event.platform?.env?.ADMIN_EMAILS);
	if (!admins.has(session.user.email.toLowerCase())) error(404, 'Not found');
	return session.user;
}
```

- [ ] **Step 4: Wire env + hooks + config**

In `src/hooks.server.ts`, extend the `dynamic` check so `/admin` routes get `locals.db`/`locals.auth`:

```ts
	const dynamic =
		event.url.pathname.startsWith('/api/') ||
		event.url.pathname === '/me' ||
		event.url.pathname.startsWith('/me/') ||
		event.url.pathname === '/admin' ||
		event.url.pathname.startsWith('/admin/');
```

In `src/app.d.ts`, add to the `Platform['env']` block (after `AI_DISABLED?: string;`):

```ts
				ADMIN_EMAILS?: string;
```

In `wrangler.jsonc`, change the `vars` line to:

```jsonc
	"vars": { "BETTER_AUTH_URL": "https://usaurules.com", "ADMIN_EMAILS": "camhpjohnson@gmail.com" },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- src/lib/server/session.test.ts && npm run check`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/session.ts src/lib/server/session.test.ts src/hooks.server.ts src/app.d.ts wrangler.jsonc
git commit -m "feat(admin): requireAdmin email-allowlist gate + env plumbing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: CSV serialization helper

**Files:**
- Create: `src/lib/server/admin/csv.ts`, `src/lib/server/admin/csv.test.ts`

**Interfaces:**
- Produces: `toCsv(headers: string[], rows: readonly (readonly unknown[])[]): string`. Emits a header row then one line per row, CRLF-joined, RFC-4180-escaped. `null`/`undefined` → empty field; everything else stringified via `String(v)`.

- [ ] **Step 1: Write the failing test**

`src/lib/server/admin/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
	it('writes header + rows', () => {
		expect(toCsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('a,b\r\n1,2\r\n3,4');
	});
	it('escapes quotes, commas, and newlines', () => {
		expect(toCsv(['x'], [['he said "hi"'], ['a,b'], ['line\nbreak']])).toBe(
			'x\r\n"he said ""hi"""\r\n"a,b"\r\n"line\nbreak"'
		);
	});
	it('null/undefined → empty field', () => {
		expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,');
	});
	it('header only when no rows', () => {
		expect(toCsv(['a', 'b'], [])).toBe('a,b');
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/lib/server/admin/csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/server/admin/csv.ts`:

```ts
/** Serialize a header + rows to an RFC-4180 CSV string (CRLF line breaks). */
export function toCsv(headers: string[], rows: readonly (readonly unknown[])[]): string {
	const lines = [headers.map(escapeField).join(',')];
	for (const row of rows) lines.push(row.map(escapeField).join(','));
	return lines.join('\r\n');
}

function escapeField(value: unknown): string {
	if (value === null || value === undefined) return '';
	const s = String(value);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/lib/server/admin/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/admin/csv.ts src/lib/server/admin/csv.test.ts
git commit -m "feat(admin): CSV serialization helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Metric math helpers

**Files:**
- Create: `src/lib/server/admin/metrics-math.ts`, `src/lib/server/admin/metrics-math.test.ts`

**Interfaces:**
- Produces:
  - `ratio(part: number, whole: number): number` — `part/whole`, or `0` when `whole === 0`.
  - `utcDay(ms: number): string` — `YYYY-MM-DD` for an epoch-ms value (UTC).
  - `fillDailyBuckets(counts: Record<string, number>, days: number, todayMs: number): { day: string; count: number }[]` — returns exactly `days` entries ending at `utcDay(todayMs)`, oldest first, filling missing days with `0`.

- [ ] **Step 1: Write the failing test**

`src/lib/server/admin/metrics-math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fillDailyBuckets, ratio, utcDay } from './metrics-math';

const DAY = 86_400_000;
const T = Date.UTC(2026, 6, 17, 12, 0, 0); // 2026-07-17T12:00Z

describe('ratio', () => {
	it('divides', () => expect(ratio(1, 4)).toBe(0.25));
	it('zero denominator → 0', () => expect(ratio(3, 0)).toBe(0));
});

describe('utcDay', () => {
	it('formats epoch ms as UTC YYYY-MM-DD', () => expect(utcDay(T)).toBe('2026-07-17'));
});

describe('fillDailyBuckets', () => {
	it('returns `days` oldest-first buckets ending today, zero-filling gaps', () => {
		const out = fillDailyBuckets({ '2026-07-17': 5, '2026-07-15': 2 }, 3, T);
		expect(out).toEqual([
			{ day: '2026-07-15', count: 2 },
			{ day: '2026-07-16', count: 0 },
			{ day: '2026-07-17', count: 5 }
		]);
	});
	it('ignores counts outside the window', () => {
		const out = fillDailyBuckets({ '2026-07-01': 9, '2026-07-17': 1 }, 2, T);
		expect(out.map((b) => b.count)).toEqual([0, 1]);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/lib/server/admin/metrics-math.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/server/admin/metrics-math.ts`:

```ts
/** part/whole, guarding divide-by-zero. */
export function ratio(part: number, whole: number): number {
	return whole === 0 ? 0 : part / whole;
}

/** UTC YYYY-MM-DD for an epoch-ms timestamp. */
export function utcDay(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** `days` buckets ending at today (UTC), oldest first, missing days zero-filled. */
export function fillDailyBuckets(
	counts: Record<string, number>,
	days: number,
	todayMs: number
): { day: string; count: number }[] {
	const DAY = 86_400_000;
	const out: { day: string; count: number }[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = utcDay(todayMs - i * DAY);
		out.push({ day, count: counts[day] ?? 0 });
	}
	return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/lib/server/admin/metrics-math.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/admin/metrics-math.ts src/lib/server/admin/metrics-math.test.ts
git commit -m "feat(admin): pure metric-math helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Admin layout, gate wiring, and e2e admin helper

This is the first vertical slice: the gate applied in the route tree, a nav shell, and the e2e harness proving admin-only access. The dashboard page body is a stub here and filled in Task 5.

**Files:**
- Create: `src/routes/admin/+layout.server.ts`, `src/routes/admin/+layout.svelte`, `src/routes/admin/+page.server.ts`, `src/routes/admin/+page.svelte`
- Modify: `e2e/helpers.ts`
- Create: `e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `requireAdmin` (Task 1).
- Produces: `ADMIN_EMAIL` constant exported from `e2e/helpers.ts`; `signUpTestUser(page, tag, opts?: { email?: string })`.

- [ ] **Step 1: Layout gate + shell**

`src/routes/admin/+layout.server.ts`:

```ts
import type { LayoutServerLoad } from './$types';
import { requireAdmin } from '$lib/server/session';

export const prerender = false;

export const load: LayoutServerLoad = async (event) => {
	await requireAdmin(event);
	return {};
};
```

`src/routes/admin/+layout.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	let { children } = $props();
	const tabs = [
		{ href: '/admin', label: 'Dashboard' },
		{ href: '/admin/ai', label: 'AI review' },
		{ href: '/admin/export', label: 'Export' }
	];
	const active = (href: string) =>
		href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);
</script>

<div class="mx-auto max-w-5xl px-4 py-6">
	<header class="mb-6">
		<h1 class="text-xl font-semibold text-navy">Admin</h1>
		<nav class="mt-3 flex gap-4 border-b border-navy/10 text-sm">
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					class="cursor-pointer pb-2 {active(tab.href)
						? 'border-b-2 border-cardinal font-semibold text-cardinal'
						: 'text-navy/70 hover:text-navy'}">{tab.label}</a
				>
			{/each}
		</nav>
	</header>
	{@render children()}
</div>
```

- [ ] **Step 2: Stub dashboard page**

`src/routes/admin/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {};
};
```

`src/routes/admin/+page.svelte`:

```svelte
<p class="text-navy/70">Dashboard</p>
```

- [ ] **Step 3: Extend the e2e helper**

Replace the body of `signUpTestUser` in `e2e/helpers.ts` and add the constant:

```ts
/** The email allowlisted as admin in wrangler.jsonc vars (ADMIN_EMAILS). */
export const ADMIN_EMAIL = 'camhpjohnson@gmail.com';

export async function signUpTestUser(
	page: Page,
	tag: string,
	opts: { email?: string } = {}
): Promise<{ email: string }> {
	const email = opts.email ?? uniqueEmail(tag);
	const res = await page.request.post('/api/auth/sign-up/email', {
		data: { email, password: 'test-password-123', name: 'Test User' }
	});
	expect(res.ok(), `test sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return { email };
}
```

- [ ] **Step 4: Write the access e2e**

`e2e/admin.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, signUpTestUser } from './helpers';

test.describe('admin access', () => {
	test('signed out → 404 on admin routes', async ({ page }) => {
		for (const path of ['/admin', '/admin/ai', '/admin/export']) {
			const res = await page.goto(path);
			expect(res?.status(), path).toBe(404);
		}
	});

	test('non-admin signed in → 404', async ({ page }) => {
		await signUpTestUser(page, 'not-admin');
		const res = await page.goto('/admin');
		expect(res?.status()).toBe(404);
	});

	test('admin → dashboard renders', async ({ page }) => {
		await signUpTestUser(page, 'admin', { email: ADMIN_EMAIL });
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'AI review' })).toBeVisible();
	});
});
```

- [ ] **Step 5: Run**

Run: `npm run test:e2e -- admin.spec.ts`
Expected: PASS (webServer boots wrangler dev with `ADMIN_EMAILS` from wrangler.jsonc; local run wipes D1 first so `ADMIN_EMAIL` sign-up is conflict-free).

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin e2e/helpers.ts e2e/admin.spec.ts
git commit -m "feat(admin): gated layout shell + access e2e

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Metrics dashboard

**Files:**
- Create: `src/lib/server/admin/metrics.ts`
- Modify: `src/routes/admin/+page.server.ts`, `src/routes/admin/+page.svelte`
- Modify: `e2e/admin.spec.ts` (append a seeded-metrics test)

**Interfaces:**
- Consumes: `ratio`, `fillDailyBuckets` (Task 3); `ASK_DAILY_PER_USER` (`$lib/server/ai/config`); `Db` (`$lib/server/db`).
- Produces: `async loadDashboardMetrics(db: Db, nowMs: number): Promise<DashboardMetrics>` where

```ts
export type DashboardMetrics = {
	totals: { users: number; conversations: number; messages: number; quizAttempts: number };
	recent: { newUsers7d: number; quizAttempts7d: number; asksToday: number; asks7d: number };
	quizByMode: { mode: string; count: number }[];
	feedback: { up: number; down: number; downRatio: number };
	answerHealth: { truncatedRate: number; errorRate: number; assistantTotal: number };
	questionHealth: { fallbackRate: number; total: number };
	quotaHits7d: number;
	dailyAsks: { day: string; count: number }[];
	dailySignups: { day: string; count: number }[];
};
```

- [ ] **Step 1: Implement the query module**

`src/lib/server/admin/metrics.ts`:

```ts
import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { ASK_DAILY_PER_USER } from '$lib/server/ai/config';
import {
	aiConversations,
	aiMessages,
	aiQuestions,
	aiUsage,
	quizAttempts,
	user
} from '$lib/server/db/schema';
import { fillDailyBuckets, ratio, utcDay } from './metrics-math';

export type DashboardMetrics = {
	totals: { users: number; conversations: number; messages: number; quizAttempts: number };
	recent: { newUsers7d: number; quizAttempts7d: number; asksToday: number; asks7d: number };
	quizByMode: { mode: string; count: number }[];
	feedback: { up: number; down: number; downRatio: number };
	answerHealth: { truncatedRate: number; errorRate: number; assistantTotal: number };
	questionHealth: { fallbackRate: number; total: number };
	quotaHits7d: number;
	dailyAsks: { day: string; count: number }[];
	dailySignups: { day: string; count: number }[];
};

const DAY = 86_400_000;

export async function loadDashboardMetrics(db: Db, nowMs: number): Promise<DashboardMetrics> {
	const since7dMs = nowMs - 7 * DAY;
	const since14dMs = nowMs - 14 * DAY;
	const today = utcDay(nowMs);
	const since7dDay = utcDay(since7dMs);
	const since14dDay = utcDay(since14dMs);

	const one = async (q: Promise<{ c: number }[]>) => (await q)[0]?.c ?? 0;
	const c = (col = sql`*`) => ({ c: count(col) });

	const [
		users,
		conversations,
		messages,
		quizTotal,
		newUsers7d,
		quiz7d,
		quizByMode,
		fb,
		assistant,
		questions,
		usageRows,
		signupRows
	] = await Promise.all([
		one(db.select(c()).from(user)),
		one(db.select(c()).from(aiConversations)),
		one(db.select(c()).from(aiMessages)),
		one(db.select(c()).from(quizAttempts)),
		one(db.select(c()).from(user).where(gte(user.createdAt, new Date(since7dMs)))),
		one(db.select(c()).from(quizAttempts).where(gte(quizAttempts.createdAt, since7dMs))),
		db
			.select({ mode: quizAttempts.mode, count: count() })
			.from(quizAttempts)
			.groupBy(quizAttempts.mode),
		db
			.select({ feedback: aiMessages.feedback, count: count() })
			.from(aiMessages)
			.where(sql`${aiMessages.feedback} is not null`)
			.groupBy(aiMessages.feedback),
		db
			.select({ status: aiMessages.status, count: count() })
			.from(aiMessages)
			.where(eq(aiMessages.role, 'assistant'))
			.groupBy(aiMessages.status),
		db
			.select({ status: aiQuestions.status, count: count() })
			.from(aiQuestions)
			.groupBy(aiQuestions.status),
		db
			.select({ day: aiUsage.day, total: sql<number>`sum(${aiUsage.count})` })
			.from(aiUsage)
			.where(and(eq(aiUsage.kind, 'ask'), gte(aiUsage.day, since14dDay)))
			.groupBy(aiUsage.day),
		db
			.select({
				day: sql<string>`strftime('%Y-%m-%d', ${user.createdAt} / 1000, 'unixepoch')`,
				total: count()
			})
			.from(user)
			.where(gte(user.createdAt, new Date(since14dMs)))
			.groupBy(sql`1`)
	]);

	// asks today / 7d from ai_usage (kind='ask')
	const [asksTodayRows, asks7dRows] = await Promise.all([
		db
			.select({ total: sql<number>`coalesce(sum(${aiUsage.count}), 0)` })
			.from(aiUsage)
			.where(and(eq(aiUsage.kind, 'ask'), eq(aiUsage.day, today))),
		db
			.select({ total: sql<number>`coalesce(sum(${aiUsage.count}), 0)` })
			.from(aiUsage)
			.where(and(eq(aiUsage.kind, 'ask'), gte(aiUsage.day, since7dDay)))
	]);

	// quota hits (7d): per-user-day ask rows at/over the cap
	const quotaHitsRows = await db
		.select({ c: count() })
		.from(aiUsage)
		.where(
			and(
				eq(aiUsage.kind, 'ask'),
				gte(aiUsage.day, since7dDay),
				gte(aiUsage.count, ASK_DAILY_PER_USER)
			)
		);

	const byStatus = (rows: { status: string | null; count: number }[], key: string) =>
		rows.find((r) => r.status === key)?.count ?? 0;
	const up = fb.find((r) => r.feedback === 'up')?.count ?? 0;
	const down = fb.find((r) => r.feedback === 'down')?.count ?? 0;
	const assistantTotal = assistant.reduce((s, r) => s + r.count, 0);
	const truncated = byStatus(assistant, 'truncated');
	const errored = byStatus(assistant, 'error');
	const qTotal = questions.reduce((s, r) => s + r.count, 0);
	const fallback = questions.find((r) => r.status === 'fallback')?.count ?? 0;

	const asksByDay: Record<string, number> = {};
	for (const r of usageRows) asksByDay[r.day] = Number(r.total);
	const signupsByDay: Record<string, number> = {};
	for (const r of signupRows) signupsByDay[r.day] = Number(r.total);

	return {
		totals: { users, conversations, messages, quizAttempts: quizTotal },
		recent: {
			newUsers7d,
			quizAttempts7d: quiz7d,
			asksToday: Number(asksTodayRows[0]?.total ?? 0),
			asks7d: Number(asks7dRows[0]?.total ?? 0)
		},
		quizByMode,
		feedback: { up, down, downRatio: ratio(down, up + down) },
		answerHealth: {
			truncatedRate: ratio(truncated, assistantTotal),
			errorRate: ratio(errored, assistantTotal),
			assistantTotal
		},
		questionHealth: { fallbackRate: ratio(fallback, qTotal), total: qTotal },
		quotaHits7d: quotaHitsRows[0]?.c ?? 0,
		dailyAsks: fillDailyBuckets(asksByDay, 14, nowMs),
		dailySignups: fillDailyBuckets(signupsByDay, 14, nowMs)
	};
}
```

> Note for the implementer: `user.createdAt` is Drizzle `timestamp_ms` mode → compare with `new Date(ms)`. `quizAttempts.createdAt` and `aiMessages`/`aiConversations` times are plain integer ms → compare with the raw number. `aiUsage.day` is a `YYYY-MM-DD` string → compare lexically with the `utcDay(...)` strings. Verify each comparison against `schema.ts` while wiring. If `page.server` type inference complains about `count()` result typing, keep the `c`/`one` helpers as written.

- [ ] **Step 2: Load it in the page**

`src/routes/admin/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { loadDashboardMetrics } from '$lib/server/admin/metrics';

export const load: PageServerLoad = async (event) => {
	const metrics = await loadDashboardMetrics(event.locals.db, Date.now());
	return { metrics };
};
```

- [ ] **Step 3: Render tiles + bars**

`src/routes/admin/+page.svelte`:

```svelte
<script lang="ts">
	let { data } = $props();
	const m = data.metrics;
	const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
	function bars(series: { day: string; count: number }[]) {
		const max = Math.max(1, ...series.map((s) => s.count));
		return series.map((s) => ({ ...s, h: Math.round((s.count / max) * 100) }));
	}
</script>

{#snippet tile(label: string, value: string | number, hint: string = '')}
	<div class="rounded-lg border border-navy/10 bg-white p-4">
		<div class="text-2xl font-semibold text-navy">{value}</div>
		<div class="text-xs text-navy/60">{label}</div>
		{#if hint}<div class="mt-1 text-[11px] text-navy/40">{hint}</div>{/if}
	</div>
{/snippet}

{#snippet barRow(title: string, series: { day: string; count: number }[])}
	<div class="rounded-lg border border-navy/10 bg-white p-4">
		<div class="mb-2 text-xs font-medium text-navy/70">{title}</div>
		<div class="flex h-16 items-end gap-1">
			{#each bars(series) as b (b.day)}
				<div class="flex-1 rounded-t bg-cardinal/70" style="height: {b.h}%" title="{b.day}: {b.count}"></div>
			{/each}
		</div>
	</div>
{/snippet}

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
	{@render tile('Users', m.totals.users, `+${m.recent.newUsers7d} in 7d`)}
	{@render tile('Conversations', m.totals.conversations)}
	{@render tile('Messages', m.totals.messages)}
	{@render tile('Quiz attempts', m.totals.quizAttempts, `+${m.recent.quizAttempts7d} in 7d`)}
	{@render tile('Asks today', m.recent.asksToday, `${m.recent.asks7d} in 7d`)}
	{@render tile('👎 ratio', pct(m.feedback.downRatio), `${m.feedback.up}👍 / ${m.feedback.down}👎`)}
	{@render tile('Truncated', pct(m.answerHealth.truncatedRate), `of ${m.answerHealth.assistantTotal} answers`)}
	{@render tile('Errored', pct(m.answerHealth.errorRate), 'of assistant answers')}
	{@render tile('Q fallback', pct(m.questionHealth.fallbackRate), `of ${m.questionHealth.total} gen`)}
	{@render tile('Quota hits 7d', m.quotaHits7d, 'users at daily cap')}
</div>

<div class="mt-4 grid gap-4 sm:grid-cols-2">
	{@render barRow('Daily asks (14d)', m.dailyAsks)}
	{@render barRow('Daily sign-ups (14d)', m.dailySignups)}
</div>

{#if m.quizByMode.length}
	<div class="mt-4 rounded-lg border border-navy/10 bg-white p-4">
		<div class="mb-2 text-xs font-medium text-navy/70">Quiz attempts by mode</div>
		<table class="w-full text-sm">
			<tbody>
				{#each m.quizByMode as row (row.mode)}
					<tr class="border-t border-navy/5"><td class="py-1 text-navy/70">{row.mode}</td><td class="py-1 text-right font-medium text-navy">{row.count}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
```

- [ ] **Step 4: Idempotent admin sign-in helper**

Every admin test signs in as the single allowlisted `ADMIN_EMAIL`, but they share one e2e D1 within a run and better-auth emails are unique — so a second *sign-up* of that email fails. Add an idempotent helper to `e2e/helpers.ts` (sign up once, otherwise sign in):

```ts
export const ADMIN_PASSWORD = 'test-password-123';

/** Signs in as the single allowlisted admin, creating the account once if absent. */
export async function signInAsAdmin(page: Page): Promise<void> {
	const signUp = await page.request.post('/api/auth/sign-up/email', {
		data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Admin' }
	});
	if (signUp.ok()) return;
	const signIn = await page.request.post('/api/auth/sign-in/email', {
		data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
	});
	expect(signIn.ok(), `admin sign-in failed: ${signIn.status()} ${await signIn.text()}`).toBeTruthy();
}
```

Then retrofit Task 4's existing `admin → dashboard renders` test in `e2e/admin.spec.ts` to call `await signInAsAdmin(page);` instead of `await signUpTestUser(page, 'admin', { email: ADMIN_EMAIL });`, and update that spec's import to pull `signInAsAdmin` from `./helpers`. This removes any cross-test ordering/collision coupling.

- [ ] **Step 5: Append seeded-metrics e2e**

Add to `e2e/admin.spec.ts` (uses the `d1` helper pattern from `ai.spec.ts` — copy the `d1`/`d1Select` helpers to the top of this spec):

```ts
test('dashboard reflects seeded data', async ({ page }) => {
	await signInAsAdmin(page);
	// seed a conversation + a thumbed-down assistant message for this admin user
	const uid = (
		d1Select(`SELECT id FROM user WHERE email = '${ADMIN_EMAIL}'`)[0] as { id: string }
	).id;
	d1(
		`INSERT INTO ai_conversations (id,user_id,ruleset_id,title,created_at,updated_at) VALUES ('c-metrics','${uid}','usau-official-2026-27','seed',1,1)`
	);
	d1(
		`INSERT INTO ai_messages (id,conversation_id,role,content,status,feedback,created_at) VALUES ('m-a','c-metrics','assistant','ans','complete','down',2)`
	);
	await page.goto('/admin');
	await expect(page.getByText('Conversations')).toBeVisible();
	// downRatio tile shows 100.0% when the only feedback row is a down
	await expect(page.getByText('100.0%').first()).toBeVisible();
});
```

Add these helpers to the top of `e2e/admin.spec.ts`:

```ts
import { execSync } from 'node:child_process';
const d1 = (sql: string): unknown =>
	JSON.parse(
		execSync(
			`npx wrangler d1 execute usau-rules-website-db --local --json --command "${sql.replace(/"/g, '\\"')}"`,
			{ cwd: process.cwd(), encoding: 'utf-8' }
		)
	);
const d1Select = (sql: string): Record<string, unknown>[] =>
	(d1(sql) as { results: Record<string, unknown>[] }[])[0].results;
```

- [ ] **Step 6: Run + verify**

Run: `npm test && npm run check && npm run test:e2e -- admin.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/admin/metrics.ts src/routes/admin/+page.server.ts src/routes/admin/+page.svelte e2e/helpers.ts e2e/admin.spec.ts
git commit -m "feat(admin): metrics dashboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: AI quality review (list + transcript)

**Files:**
- Create: `src/routes/admin/ai/+page.server.ts`, `src/routes/admin/ai/+page.svelte`, `src/routes/admin/ai/[id]/+page.server.ts`, `src/routes/admin/ai/[id]/+page.svelte`
- Modify: `e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `parseHistoryQuery`/`pageRows` (`$lib/server/ai/history`), `timeAgo` (`$lib/time`), `AskAnswer` (`$lib/components/AskAnswer.svelte`), schema tables.

- [ ] **Step 1: Conversation-list load**

`src/routes/admin/ai/+page.server.ts`:

```ts
import { desc, eq, lt, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { pageRows, parseHistoryQuery } from '$lib/server/ai/history';
import { aiConversations, aiMessages, user } from '$lib/server/db/schema';

export const load: PageServerLoad = async (event) => {
	const { before, limit } = parseHistoryQuery(event.url.searchParams, 30);
	const downOnly = event.url.searchParams.get('down') === '1';
	const db = event.locals.db;

	const msgCount = db
		.select({ conversationId: aiMessages.conversationId, n: sql<number>`count(*)`.as('n') })
		.from(aiMessages)
		.groupBy(aiMessages.conversationId)
		.as('msg_count');
	const downFlag = db
		.select({ conversationId: aiMessages.conversationId, has: sql<number>`1`.as('has') })
		.from(aiMessages)
		.where(eq(aiMessages.feedback, 'down'))
		.groupBy(aiMessages.conversationId)
		.as('down_flag');

	let q = db
		.select({
			id: aiConversations.id,
			title: aiConversations.title,
			rulesetId: aiConversations.rulesetId,
			updatedAt: aiConversations.updatedAt,
			deletedAt: aiConversations.deletedAt,
			email: user.email,
			messages: sql<number>`coalesce(${msgCount.n}, 0)`,
			hasDown: sql<number>`coalesce(${downFlag.has}, 0)`
		})
		.from(aiConversations)
		.innerJoin(user, eq(user.id, aiConversations.userId))
		.leftJoin(msgCount, eq(msgCount.conversationId, aiConversations.id))
		.leftJoin(downFlag, eq(downFlag.conversationId, aiConversations.id))
		.$dynamic();

	const conds = [];
	if (before !== null) conds.push(lt(aiConversations.updatedAt, before));
	if (downOnly) conds.push(sql`coalesce(${downFlag.has}, 0) = 1`);
	if (conds.length) q = q.where(conds.length === 1 ? conds[0] : sql.join(conds, sql` and `));

	const rows = await q.orderBy(desc(aiConversations.updatedAt)).limit(limit + 1);
	const { items, hasMore } = pageRows(rows, limit);
	const nextBefore = hasMore ? items[items.length - 1].updatedAt : null;
	return { conversations: items, hasMore, nextBefore, downOnly };
};
```

> Implementer note: if the subquery-join typing fights you, an equivalent and simpler shape is one query selecting conversations+user joined, plus a second query `select conversationId, count(*), max(case when feedback='down' then 1 else 0 end)` grouped by conversation for the current page's ids, merged in JS. Prefer whichever type-checks cleanly; behavior (message count + any-down flag per conversation, `down=1` filter, `before` cursor) is what matters.

- [ ] **Step 2: Conversation-list view**

`src/routes/admin/ai/+page.svelte`:

```svelte
<script lang="ts">
	import { timeAgo } from '$lib/time';
	let { data } = $props();
</script>

<div class="mb-3 flex items-center gap-3 text-sm">
	<a href="/admin/ai" class="cursor-pointer {data.downOnly ? 'text-navy/60' : 'font-semibold text-cardinal'}">All</a>
	<a href="/admin/ai?down=1" class="cursor-pointer {data.downOnly ? 'font-semibold text-cardinal' : 'text-navy/60'}">👎 only</a>
</div>

{#if data.conversations.length === 0}
	<p class="text-navy/60">No conversations.</p>
{:else}
	<table class="w-full text-sm">
		<thead class="text-left text-xs text-navy/50">
			<tr><th class="py-1">Title</th><th>User</th><th>Msgs</th><th></th><th class="text-right">Updated</th></tr>
		</thead>
		<tbody>
			{#each data.conversations as c (c.id)}
				<tr class="border-t border-navy/5">
					<td class="py-2"><a class="cursor-pointer text-cardinal hover:underline" href="/admin/ai/{c.id}">{c.title}</a>{#if c.deletedAt}<span class="ml-2 rounded bg-navy/10 px-1 text-[10px] text-navy/50">deleted</span>{/if}</td>
					<td class="text-navy/70">{c.email}</td>
					<td class="text-navy/70">{c.messages}</td>
					<td>{#if c.hasDown}<span title="has a 👎">👎</span>{/if}</td>
					<td class="text-right text-navy/50">{timeAgo(c.updatedAt)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if data.hasMore}
		<a class="mt-3 inline-block cursor-pointer text-sm text-cardinal" href="/admin/ai?{data.downOnly ? 'down=1&' : ''}before={data.nextBefore}">Load more</a>
	{/if}
{/if}
```

- [ ] **Step 3: Transcript load + view**

`src/routes/admin/ai/[id]/+page.server.ts`:

```ts
import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { aiConversations, aiMessages, user } from '$lib/server/db/schema';

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const convo = (
		await db
			.select({
				id: aiConversations.id,
				title: aiConversations.title,
				rulesetId: aiConversations.rulesetId,
				deletedAt: aiConversations.deletedAt,
				email: user.email
			})
			.from(aiConversations)
			.innerJoin(user, eq(user.id, aiConversations.userId))
			.where(eq(aiConversations.id, event.params.id))
			.limit(1)
	)[0];
	if (!convo) error(404, 'Not found');

	const messages = await db
		.select({
			id: aiMessages.id,
			role: aiMessages.role,
			content: aiMessages.content,
			status: aiMessages.status,
			feedback: aiMessages.feedback,
			createdAt: aiMessages.createdAt
		})
		.from(aiMessages)
		.where(eq(aiMessages.conversationId, convo.id))
		.orderBy(asc(aiMessages.createdAt));

	return { convo, messages };
};
```

`src/routes/admin/ai/[id]/+page.svelte`:

```svelte
<script lang="ts">
	import AskAnswer from '$lib/components/AskAnswer.svelte';
	let { data } = $props();
</script>

<a href="/admin/ai" class="text-sm text-cardinal hover:underline">← Conversations</a>
<div class="mt-2 mb-4">
	<h2 class="text-lg font-semibold text-navy">{data.convo.title}</h2>
	<p class="text-xs text-navy/50">{data.convo.email} · {data.convo.rulesetId}{#if data.convo.deletedAt} · deleted{/if}</p>
</div>

<div class="space-y-4">
	{#each data.messages as msg (msg.id)}
		{#if msg.role === 'user'}
			<div class="ml-auto max-w-[80%] rounded-lg bg-navy/5 px-3 py-2 text-sm text-navy">{msg.content}</div>
		{:else}
			<div class="max-w-[90%]">
				{#if msg.status === 'error'}
					<p class="text-sm text-navy/40">No answer — the assistant was unavailable.</p>
				{:else}
					<AskAnswer answer={msg.content} />
					<div class="mt-1 flex gap-2 text-[11px] text-navy/40">
						{#if msg.status === 'truncated'}<span>cut short</span>{/if}
						{#if msg.feedback === 'up'}<span>👍</span>{:else if msg.feedback === 'down'}<span>👎</span>{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/each}
</div>
```

- [ ] **Step 4: e2e — list filter + cross-user transcript**

Append to `e2e/admin.spec.ts`:

```ts
test('AI review: 👎 filter and cross-user transcript', async ({ page }) => {
	await signInAsAdmin(page);
	// a DIFFERENT user's conversation with a 👎 assistant message
	const other = (d1Select(`SELECT id FROM user LIMIT 1`)[0] as { id: string }).id;
	d1(`INSERT INTO ai_conversations (id,user_id,ruleset_id,title,created_at,updated_at) VALUES ('c-ai','${other}','usau-official-2026-27','stall count question',10,10)`);
	d1(`INSERT INTO ai_messages (id,conversation_id,role,content,created_at) VALUES ('m-u','c-ai','user','what is a stall?',10)`);
	d1(`INSERT INTO ai_messages (id,conversation_id,role,content,status,feedback,created_at) VALUES ('m-r','c-ai','assistant','A stall per 15.D.','complete','down',11)`);

	await page.goto('/admin/ai?down=1');
	await expect(page.getByRole('link', { name: 'stall count question' })).toBeVisible();

	await page.getByRole('link', { name: 'stall count question' }).click();
	await expect(page.getByText('what is a stall?')).toBeVisible();
	await expect(page.getByText('👎')).toBeVisible();
});
```

- [ ] **Step 5: Run + verify**

Run: `npm run check && npm run test:e2e -- admin.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin/ai e2e/admin.spec.ts
git commit -m "feat(admin): AI conversation review + transcript

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: CSV export (registry, page, endpoint)

**Files:**
- Create: `src/lib/server/admin/datasets.ts`, `src/routes/admin/export/+page.server.ts`, `src/routes/admin/export/+page.svelte`, `src/routes/admin/export/[dataset].csv/+server.ts`
- Modify: `e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `toCsv` (Task 2), `requireAdmin` (Task 1), schema tables, `Db`.
- Produces: `EXPORT_MAX_ROWS` and `DATASETS: Record<string, DatasetDef>` from `datasets.ts`, where

```ts
export type DatasetDef = {
	label: string;
	columns: string[];
	rows: (db: Db, limit: number) => Promise<unknown[][]>;
	count: (db: Db) => Promise<number>;
};
```

- [ ] **Step 1: Dataset registry**

`src/lib/server/admin/datasets.ts`:

```ts
import { count, desc } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import {
	aiConversations,
	aiMessages,
	aiUsage,
	questionResponses,
	quizAttempts,
	user
} from '$lib/server/db/schema';

export const EXPORT_MAX_ROWS = 10_000;

export type DatasetDef = {
	label: string;
	columns: string[];
	rows: (db: Db, limit: number) => Promise<unknown[][]>;
	count: (db: Db) => Promise<number>;
};

const total = async (db: Db, table: Parameters<Db['select']>[0] extends never ? never : any) =>
	((await db.select({ c: count() }).from(table))[0]?.c ?? 0) as number;

export const DATASETS: Record<string, DatasetDef> = {
	conversations: {
		label: 'Conversations',
		columns: ['id', 'userId', 'rulesetId', 'title', 'createdAt', 'updatedAt', 'deletedAt'],
		rows: (db, limit) =>
			db
				.select()
				.from(aiConversations)
				.orderBy(desc(aiConversations.createdAt))
				.limit(limit)
				.then((rs) =>
					rs.map((r) => [r.id, r.userId, r.rulesetId, r.title, r.createdAt, r.updatedAt, r.deletedAt])
				),
		count: (db) => total(db, aiConversations)
	},
	messages: {
		label: 'Messages (with feedback)',
		columns: ['id', 'conversationId', 'role', 'content', 'status', 'model', 'feedback', 'createdAt'],
		rows: (db, limit) =>
			db
				.select()
				.from(aiMessages)
				.orderBy(desc(aiMessages.createdAt))
				.limit(limit)
				.then((rs) =>
					rs.map((r) => [r.id, r.conversationId, r.role, r.content, r.status, r.model, r.feedback, r.createdAt])
				),
		count: (db) => total(db, aiMessages)
	},
	'quiz-attempts': {
		label: 'Quiz attempts',
		columns: ['id', 'userId', 'rulesetId', 'mode', 'sectionSlug', 'score', 'total', 'bestStreak', 'startedAt', 'durationS', 'createdAt'],
		rows: (db, limit) =>
			db
				.select()
				.from(quizAttempts)
				.orderBy(desc(quizAttempts.createdAt))
				.limit(limit)
				.then((rs) =>
					rs.map((r) => [r.id, r.userId, r.rulesetId, r.mode, r.sectionSlug, r.score, r.total, r.bestStreak, r.startedAt, r.durationS, r.createdAt])
				),
		count: (db) => total(db, quizAttempts)
	},
	'question-responses': {
		label: 'Question responses',
		columns: ['id', 'attemptId', 'userId', 'rulesetId', 'questionId', 'sectionSlug', 'choiceIndex', 'correct', 'at'],
		rows: (db, limit) =>
			db
				.select()
				.from(questionResponses)
				.orderBy(desc(questionResponses.at))
				.limit(limit)
				.then((rs) =>
					rs.map((r) => [r.id, r.attemptId, r.userId, r.rulesetId, r.questionId, r.sectionSlug, r.choiceIndex, r.correct, r.at])
				),
		count: (db) => total(db, questionResponses)
	},
	users: {
		label: 'Users',
		columns: ['id', 'email', 'name', 'displayName', 'createdAt'],
		rows: (db, limit) =>
			db
				.select({
					id: user.id,
					email: user.email,
					name: user.name,
					displayName: user.displayName,
					createdAt: user.createdAt
				})
				.from(user)
				.orderBy(desc(user.createdAt))
				.limit(limit)
				.then((rs) => rs.map((r) => [r.id, r.email, r.name, r.displayName, r.createdAt?.getTime()])),
		count: (db) => total(db, user)
	},
	'ai-usage': {
		label: 'AI usage (daily counters)',
		columns: ['day', 'userId', 'kind', 'count'],
		rows: (db, limit) =>
			db
				.select()
				.from(aiUsage)
				.orderBy(desc(aiUsage.day))
				.limit(limit)
				.then((rs) => rs.map((r) => [r.day, r.userId, r.kind, r.count])),
		count: (db) => total(db, aiUsage)
	}
};
```

> Implementer note: if the `total` helper's generic typing is awkward, inline `db.select({ c: count() }).from(<table>)` per dataset instead — correctness over cleverness. `user.createdAt` is a `Date` (timestamp_ms mode); export it as epoch ms via `.getTime()` so CSV values are stable integers.

- [ ] **Step 2: Export page**

`src/routes/admin/export/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { DATASETS, EXPORT_MAX_ROWS } from '$lib/server/admin/datasets';

export const load: PageServerLoad = async (event) => {
	const db = event.locals.db;
	const datasets = await Promise.all(
		Object.entries(DATASETS).map(async ([slug, def]) => ({
			slug,
			label: def.label,
			count: await def.count(db)
		}))
	);
	return { datasets, max: EXPORT_MAX_ROWS };
};
```

`src/routes/admin/export/+page.svelte`:

```svelte
<script lang="ts">
	let { data } = $props();
</script>

<p class="mb-4 text-sm text-navy/60">Newest-first CSV, capped at {data.max.toLocaleString()} rows per file.</p>
<ul class="space-y-2">
	{#each data.datasets as d (d.slug)}
		<li class="flex items-center justify-between rounded-lg border border-navy/10 bg-white p-3">
			<div>
				<div class="text-sm font-medium text-navy">{d.label}</div>
				<div class="text-xs text-navy/50">
					{d.count.toLocaleString()} rows{#if d.count > data.max} · showing latest {data.max.toLocaleString()}{/if}
				</div>
			</div>
			<a class="cursor-pointer rounded bg-cardinal px-3 py-1.5 text-sm font-medium text-white" href="/admin/export/{d.slug}.csv">Download CSV</a>
		</li>
	{/each}
</ul>
```

- [ ] **Step 3: CSV endpoint**

`src/routes/admin/export/[dataset].csv/+server.ts`:

```ts
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/session';
import { toCsv } from '$lib/server/admin/csv';
import { DATASETS, EXPORT_MAX_ROWS } from '$lib/server/admin/datasets';

export const GET: RequestHandler = async (event) => {
	await requireAdmin(event); // defense in depth: not under the page layout
	const def = DATASETS[event.params.dataset];
	if (!def) error(404, 'Not found');

	const rows = await def.rows(event.locals.db, EXPORT_MAX_ROWS);
	const body = toCsv(def.columns, rows);
	return new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${event.params.dataset}-${rows.length}.csv"`
		}
	});
};
```

- [ ] **Step 4: e2e — download, escaping, secrets omitted, 404 for non-admin**

Append to `e2e/admin.spec.ts`:

```ts
test('export: users CSV omits secrets; endpoint 404s for non-admin', async ({ page }) => {
	// non-admin gets 404 on the csv endpoint
	await signUpTestUser(page, 'export-nonadmin');
	const denied = await page.request.get('/admin/export/users.csv');
	expect(denied.status()).toBe(404);

	// admin download
	await page.context().clearCookies();
	await signInAsAdmin(page);
	const res = await page.request.get('/admin/export/users.csv');
	expect(res.ok()).toBeTruthy();
	expect(res.headers()['content-type']).toContain('text/csv');
	const csv = await res.text();
	const header = csv.split('\r\n')[0];
	expect(header).toBe('id,email,name,displayName,createdAt');
	expect(header).not.toContain('password');
	expect(csv).toContain(ADMIN_EMAIL);

	// unknown dataset → 404
	const unknown = await page.request.get('/admin/export/nope.csv');
	expect(unknown.status()).toBe(404);
});
```

- [ ] **Step 5: Run + verify**

Run: `npm test && npm run check && npm run test:e2e -- admin.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/admin/datasets.ts src/routes/admin/export e2e/admin.spec.ts
git commit -m "feat(admin): capped per-table CSV export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Docs + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README admin section**

Add a short "Admin" section to `README.md` near the AI-features docs:

```markdown
## Admin

A private, read-only admin area lives at `/admin` (dashboard, AI conversation
review, CSV export). Access is an email allowlist: set `ADMIN_EMAILS`
(comma-separated, case-insensitive) in `wrangler.jsonc` `vars` — anyone else,
signed in or not, gets a 404. Exports are newest-first CSV capped at 10,000 rows
per file; the `users` export includes only id, email, name, display name, and
created-at (never sessions, tokens, or passwords).
```

- [ ] **Step 2: Full suite**

Run: `npm test && npm run check && npm run lint && npm run test:e2e -- admin.spec.ts`
Expected: all PASS. If `npm run lint` (prettier `--check`) flags formatting, run `npm run format` and re-check.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(admin): document admin area + export scope

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes (author)

- **Spec coverage:** gating→T1; 404-not-403→T1; env plumbing/hooks→T1; CSV escaping→T2; metric rates (👎 ratio, truncated/error, fallback, quota hits)→T3+T5; dashboard tiles+bars→T5; AI list+👎 filter+cross-user transcript→T6; capped per-table export + secret-omission→T7; README→T8. All spec sections map to a task.
- **Deviation from spec testing:** the spec implies unit tests for the metric *queries*; the repo has no DB-backed unit harness (DB logic is covered by seeded-D1 e2e). Plan keeps the derived math pure/unit-tested (T3) and covers the queries via e2e (T5/T6/T7). Intentional, matches existing convention.
- **Type consistency:** `DashboardMetrics` (T5) is the sole producer/consumer of the metrics shape; `DatasetDef`/`DATASETS`/`EXPORT_MAX_ROWS` (T7) are consumed by the page + endpoint only; `requireAdmin`/`parseAdminEmails` (T1) signatures reused verbatim in T4/T7.
- **Known typing risk flagged inline:** the T6 subquery-join and T7 `total` generic each carry an implementer note offering a simpler equivalent if inference fights.
```
