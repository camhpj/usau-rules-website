# Best Perspective — Phase 3: Accounts, Persistence & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship accounts (better-auth + Google OAuth on the existing Cloudflare Worker), D1 persistence via Drizzle (quiz attempts, per-question responses, bookmarks), server-validated timed-challenge results, and the `/me` dashboard — while the signed-out experience stays exactly as shipped.

**Architecture:** Persistence is **local-first**: `src/lib/quiz/storage.ts` keeps its synchronous public API and `localStorage` stays the cache quiz play reads from; a new outbox module (`src/lib/quiz/sync.ts`) pushes completed attempts to D1 in the background and pulls server history on sign-in. Auth is better-auth (drizzle adapter over D1), mounted via `hooks.server.ts`; Google is the sole provider in production, with an env-gated email test-login used only by local dev/CI e2e. Timed-challenge results are server-authoritative: the server mints an HMAC run token at start, then recomputes score and streak from the submitted answers inside a time window at finish. All existing pages stay prerendered; only `/me` and `/api/*` are dynamic.

**Tech Stack:** Existing stack (SvelteKit/Svelte 5, TS, Tailwind v4, Bits UI, Zod, Vitest, Playwright, adapter-cloudflare) + `better-auth`, `drizzle-orm`, `drizzle-kit`, `@cloudflare/workers-types`. D1 migrations applied with `wrangler d1 migrations apply` (local and remote).

**Spec:** `docs/superpowers/specs/2026-07-09-best-perspective-design.md` (Dynamic data model, Explorer bookmarking, Dashboard). Conventions: `docs/superpowers/plans/2026-07-09-phase2-quiz.md`. Phase 2 ledger constraints: `.superpowers/sdd/progress.md`.

## Global Constraints

- Node 22, npm. TypeScript everywhere. Latest stable deps; current package docs win over plan snippets (note deviations in the task report).
- Palette tokens (exact): navy `#1C3557`, deep navy `#12233C`, cardinal `#B41F3A`, mist gray `#F0F1F3`, turf green `#2f7d52` (correct/mastered ONLY). Cardinal ONLY for CTAs/active/accent. Display type = `.display` utility; body Inter. White cards on navy shell, `rounded-xl`, chip labels.
- **HARD (Phase 2 final review):** `src/lib/quiz/storage.ts` keeps its SYNCHRONOUS public API. New functions may be added but must be sync. Quiz play must NEVER block on persistence: every network call is fire-and-forget from the page's perspective; failures degrade to local-only silently.
- **HARD:** timed-challenge results are validated server-side when persisted. The server never trusts client-computed `correct`, `score`, or `bestStreak` for ANY persisted attempt — it recomputes from `choiceIndex` vs the bank's `answerIndex`.
- **HARD:** all currently-prerendered routes stay prerendered (`+layout.ts` `prerender = true` untouched). Only `/me` (`export const prerender = false` in its `+page.server.ts`) and `/api/*` `+server.ts` routes are dynamic. `+server.ts` files are NOT affected by layout prerender options (verified against current SvelteKit docs), so they need no prerender export.
- Ruleset id `usau-official-2026-27` never hardcoded outside `src/lib/content/config.ts` (import `DEFAULT_RULESET_ID`); test files excepted.
- Auth: Google OAuth is the **sole** production provider. `emailAndPassword` sign-in exists ONLY behind `ALLOW_TEST_SIGNIN === '1'` (set in `.dev.vars` for dev/CI; never set in production).
- Secrets live in `.dev.vars` (gitignored) locally and `wrangler secret` in prod. NEVER commit secrets, never print them, never ask the user to paste them into chat.
- Subagents run ONLY local commands (`--local` D1, `wrangler dev`, curl against 127.0.0.1). NEVER `wrangler login`, `wrangler deploy`, `wrangler secret`, `wrangler d1 create`, or any `--remote` flag — those are user-run at checkpoints.
- All `/api/*` endpoints: JSON in/out, Zod-validated bodies, `401` when signed out, `400` on invalid payloads.
- localStorage keys stay under the `bp:` prefix (existing: `bp:quiz:v1:<rulesetId>`; new: `bp:sync:v1:outbox`).
- Commit after every task (conventional commits). End every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Work happens on branch `feature/phase3-accounts` (created before Task 1); squash-merge to `main` at the end.

---

### Task 1: Cloudflare/D1 foundation — deps, wrangler binding, Drizzle schema + migrations

**Files:**
- Modify: `package.json` (deps + `db:*` scripts)
- Modify: `wrangler.jsonc` (D1 binding)
- Modify: `.gitignore` (`.dev.vars`)
- Create: `drizzle.config.ts`
- Create: `src/lib/server/db/schema.ts`
- Create: `src/lib/server/db/index.ts`
- Create: `drizzle/` (generated migration, committed)
- Modify: `src/app.d.ts` (Platform env types)

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks depend on these exact names):

```ts
// src/lib/server/db/schema.ts
export const user, session, account, verification; // better-auth tables (singular names)
export const quizAttempts, questionResponses, bookmarks; // app tables (spec names)

// src/lib/server/db/index.ts
export function createDb(d1: D1Database): DrizzleD1Database<typeof schema> & { $client: D1Database };
export type Db = ReturnType<typeof createDb>;
```

- `App.Platform['env']` typed with `DB`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL?`, `GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`, `ALLOW_TEST_SIGNIN?`.
- npm scripts: `db:generate`, `db:migrate:local`, `db:migrate:remote`.

- [ ] **Step 1: Install dependencies**

```bash
npm install better-auth drizzle-orm
npm install -D drizzle-kit @cloudflare/workers-types
```

- [ ] **Step 2: Wrangler D1 binding.** In `wrangler.jsonc` add after `"observability"`:

```jsonc
"d1_databases": [
	{
		"binding": "DB",
		"database_name": "best-perspective-db",
		"database_id": "00000000-0000-0000-0000-000000000000",
		"migrations_dir": "drizzle"
	}
]
```

The placeholder `database_id` is fine for everything local (`wrangler dev` and `--local` migrations never contact Cloudflare); the real id is filled in at the Task 12 deployment checkpoint.

- [ ] **Step 3: Add `.dev.vars` to `.gitignore`** — in the `# Env` block add a line `.dev.vars`.

- [ ] **Step 4: Drizzle config** — create `drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite'
});
```

(No `dbCredentials`: we only use drizzle-kit to *generate* SQL; wrangler applies it.)

- [ ] **Step 5: Schema** — create `src/lib/server/db/schema.ts`. The four auth tables match better-auth's own CLI output for drizzle/sqlite (field names matter — the adapter maps camelCase fields to these tables); the three app tables are the spec's `quiz_attempts` / `question_responses` / `bookmarks`:

```ts
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ---- better-auth core tables (shape per better-auth CLI drizzle/sqlite output) ----

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date())
		.notNull()
});

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(table) => [index('session_userId_idx').on(table.userId)]
);

export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
		scope: text('scope'),
		password: text('password'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('account_userId_idx').on(table.userId)]
);

export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
);

// ---- app tables (spec: quiz_attempts, question_responses, bookmarks) ----
// Epoch-ms integers (plain, not timestamp mode) to match the client's ResponseRecord.at.

export const quizAttempts = sqliteTable(
	'quiz_attempts',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		clientId: text('client_id').notNull().unique(), // idempotency key (uuid or "timed:<runId>")
		rulesetId: text('ruleset_id').notNull(),
		mode: text('mode', { enum: ['quick', 'mastery', 'timed'] }).notNull(),
		sectionSlug: text('section_slug'),
		score: integer('score').notNull(), // server-recomputed, never client-supplied
		total: integer('total').notNull(),
		bestStreak: integer('best_streak'), // timed mode only, server-recomputed
		startedAt: integer('started_at').notNull(),
		durationS: integer('duration_s').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(table) => [index('quiz_attempts_user_created_idx').on(table.userId, table.createdAt)]
);

export const questionResponses = sqliteTable(
	'question_responses',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		attemptId: text('attempt_id')
			.notNull()
			.references(() => quizAttempts.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rulesetId: text('ruleset_id').notNull(),
		questionId: text('question_id').notNull(),
		sectionSlug: text('section_slug').notNull(), // from the bank, never client-supplied
		choiceIndex: integer('choice_index').notNull(), // index into question.choices (original order)
		correct: integer('correct', { mode: 'boolean' }).notNull(), // server-recomputed
		at: integer('at').notNull()
	},
	(table) => [
		index('question_responses_user_ruleset_at_idx').on(table.userId, table.rulesetId, table.at)
	]
);

export const bookmarks = sqliteTable(
	'bookmarks',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rulesetId: text('ruleset_id').notNull(),
		ruleId: text('rule_id').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(table) => [primaryKey({ columns: [table.userId, table.rulesetId, table.ruleId] })]
);
```

- [ ] **Step 6: DB factory** — create `src/lib/server/db/index.ts`:

```ts
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import * as schema from './schema';

export function createDb(d1: D1Database) {
	return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
```

- [ ] **Step 7: Platform types** — in `src/app.d.ts`, fill in the `Platform` interface (leave `Locals` for Task 2):

```ts
declare global {
	namespace App {
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				DB: import('@cloudflare/workers-types').D1Database;
				BETTER_AUTH_SECRET: string;
				BETTER_AUTH_URL?: string;
				GOOGLE_CLIENT_ID?: string;
				GOOGLE_CLIENT_SECRET?: string;
				ALLOW_TEST_SIGNIN?: string;
			};
		}
	}
}

export {};
```

- [ ] **Step 8: npm scripts** — add to `package.json` scripts:

```json
"db:generate": "drizzle-kit generate",
"db:migrate:local": "wrangler d1 migrations apply best-perspective-db --local",
"db:migrate:remote": "wrangler d1 migrations apply best-perspective-db --remote"
```

- [ ] **Step 9: Generate + apply the migration**

```bash
npm run db:generate
npm run db:migrate:local
npx wrangler d1 execute best-perspective-db --local --command "select name from sqlite_master where type='table' order by name"
```

Expected: `drizzle/0000_*.sql` + `drizzle/meta/` created (COMMIT these — migrations are source), apply reports the migration as applied, and the table list contains `account, bookmarks, d1_migrations, question_responses, quiz_attempts, session, user, verification` (plus sqlite internals).

- [ ] **Step 10: Verify** — `npm run check && npm run check:scripts && npm run test && npx prettier --check .` all pass (run `npm run format` first if prettier objects to generated JSON in `drizzle/meta/`; if formatting churns generated files, add `/drizzle/meta/` to `.prettierignore` instead and note it).

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: D1 binding, drizzle schema + migrations for auth and quiz persistence"
```

---

### Task 2: better-auth server — auth instance, hooks, session helper, dev vars

**Files:**
- Create: `src/lib/server/auth.ts`
- Create: `src/lib/server/session.ts`
- Create: `src/hooks.server.ts`
- Create: `.dev.vars.example` (committed) and `.dev.vars` (gitignored copy)
- Modify: `src/app.d.ts` (Locals)

**Interfaces:**
- Consumes: `createDb`/`Db` and schema from Task 1; `App.Platform['env']`.
- Produces (exact):

```ts
// src/lib/server/auth.ts
export function createAuth(env: App.Platform['env']): Auth; // memoized per env object
export type Auth; // ReturnType of the internal betterAuth() call

// src/lib/server/session.ts
export async function requireUser(event: RequestEvent): Promise<{ id: string; name: string; email: string; image?: string | null }>; // throws 401 error() when signed out

// App.Locals
interface Locals { auth: Auth; db: Db; }
```

- Auth endpoints live under `/api/auth/*` (better-auth default `basePath`).

- [ ] **Step 1: Auth factory** — create `src/lib/server/auth.ts`:

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb } from './db';
import * as schema from './db/schema';

type AuthEnv = App.Platform['env'];

function buildAuth(env: AuthEnv) {
	return betterAuth({
		database: drizzleAdapter(createDb(env.DB), { provider: 'sqlite', schema }),
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL || undefined, // undefined → inferred from the request
		session: { cookieCache: { enabled: true, maxAge: 300 } },
		// Test-only credential sign-in for local dev + CI e2e. ALLOW_TEST_SIGNIN is never
		// set in production, where Google remains the sole provider (spec requirement).
		emailAndPassword: { enabled: env.ALLOW_TEST_SIGNIN === '1' },
		socialProviders:
			env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
				? {
						google: {
							clientId: env.GOOGLE_CLIENT_ID,
							clientSecret: env.GOOGLE_CLIENT_SECRET,
							prompt: 'select_account'
						}
					}
				: {}
	});
}

export type Auth = ReturnType<typeof buildAuth>;

const cache = new WeakMap<AuthEnv, Auth>();

export function createAuth(env: AuthEnv): Auth {
	let auth = cache.get(env);
	if (!auth) {
		auth = buildAuth(env);
		cache.set(env, auth);
	}
	return auth;
}
```

If the installed better-auth's option names differ (e.g. `cookieCache` moved), check its current docs and adapt — requirements: drizzle adapter over the Task 1 schema, Google provider only when creds present, email/password only when `ALLOW_TEST_SIGNIN === '1'`.

- [ ] **Step 2: Hooks** — create `src/hooks.server.ts`:

```ts
import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { createAuth } from '$lib/server/auth';
import { createDb } from '$lib/server/db';

export const handle: Handle = async ({ event, resolve }) => {
	// During prerender (and any context without bindings) auth is inert.
	if (building || !event.platform?.env) return resolve(event);
	event.locals.db = createDb(event.platform.env.DB);
	event.locals.auth = createAuth(event.platform.env);
	return svelteKitHandler({ event, resolve, auth: event.locals.auth, building });
};
```

- [ ] **Step 3: Session helper** — create `src/lib/server/session.ts`:

```ts
import { error, type RequestEvent } from '@sveltejs/kit';

/** Returns the signed-in user or throws a 401. For use in /api/* handlers. */
export async function requireUser(event: RequestEvent) {
	const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
	if (!session) error(401, 'sign in required');
	return session.user;
}
```

- [ ] **Step 4: Locals types** — in `src/app.d.ts` add inside `namespace App`:

```ts
interface Locals {
	auth: import('$lib/server/auth').Auth;
	db: import('$lib/server/db').Db;
}
```

(Locals are only populated at runtime; prerendered pages never read them.)

- [ ] **Step 5: Dev vars** — create `.dev.vars.example` (committed):

```
# Copy to .dev.vars (gitignored). wrangler dev and vite dev both read .dev.vars.
BETTER_AUTH_SECRET=dev-only-secret-not-for-production
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Enables the email/password test sign-in used by e2e. NEVER set in production.
ALLOW_TEST_SIGNIN=1
```

Then `cp .dev.vars.example .dev.vars` (real Google values arrive at the Task 4 checkpoint).

- [ ] **Step 6: Verify against a running worker**

```bash
npm run check
npm run build
npx wrangler dev --port 8787 &   # then wait for ready
curl -s http://127.0.0.1:8787/api/auth/ok
curl -s http://127.0.0.1:8787/api/auth/get-session
curl -s -X POST http://127.0.0.1:8787/api/auth/sign-up/email \
  -H 'content-type: application/json' \
  -d '{"email":"hooktest@example.com","password":"test-password-123","name":"Hook Test"}'
npx wrangler d1 execute best-perspective-db --local --command "select email from user"
```

Expected: `{"ok":true}`, `null` session, a JSON user object from sign-up, and `hooktest@example.com` in the table. Also confirm a prerendered page still serves (`curl -s http://127.0.0.1:8787/ | head -5` returns HTML). Kill the dev server after.

- [ ] **Step 7: Full local suite** — `npm run check && npm run check:scripts && npm run test && npx prettier --check .` → pass.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: better-auth server on D1 (Google-only prod, env-gated test sign-in)"
```

---

### Task 3: Auth client + session-aware Nav + auth e2e infrastructure

**Files:**
- Create: `src/lib/auth-client.ts`
- Modify: `src/lib/components/Nav.svelte`
- Create: `e2e/helpers.ts`
- Create: `e2e/auth.spec.ts`
- Modify: `playwright.config.ts` (apply local migrations before the web server)

**Interfaces:**
- Consumes: `/api/auth/*` endpoints from Task 2 (incl. test sign-up when `ALLOW_TEST_SIGNIN=1`).
- Produces (exact — later tasks import these):

```ts
// src/lib/auth-client.ts
export const authClient: ReturnType<typeof createAuthClient>; // .useSession(), .signIn.social(), .signOut()

// e2e/helpers.ts
export function uniqueEmail(tag: string): string; // "bp-<tag>-<ts>-<rand>@example.com"
export async function signUpTestUser(page: Page, tag: string): Promise<{ email: string }>;
// POSTs /api/auth/sign-up/email via page.request (cookies land in the page's context)
```

- [ ] **Step 1: Playwright config** — local D1 must have tables before `wrangler dev` serves e2e. In `playwright.config.ts` change the webServer command:

```ts
command: process.env.CI
	? 'npm run db:migrate:local && npx wrangler dev --port 8787'
	: 'npm run build && npm run db:migrate:local && npx wrangler dev --port 8787',
```

(`wrangler d1 migrations apply` is idempotent and skips already-applied migrations; it does not prompt when stdout is not a TTY.)

- [ ] **Step 2: e2e helpers** — create `e2e/helpers.ts`:

```ts
import { expect, type Page } from '@playwright/test';

export function uniqueEmail(tag: string): string {
	return `bp-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Signs up (and thereby signs in) a throwaway user via the env-gated test
 * credential endpoint. page.request shares the browser context's cookie jar,
 * so the session cookie is live for subsequent page.goto calls.
 */
export async function signUpTestUser(page: Page, tag: string): Promise<{ email: string }> {
	const email = uniqueEmail(tag);
	const res = await page.request.post('/api/auth/sign-up/email', {
		data: { email, password: 'test-password-123', name: 'Test User' }
	});
	expect(res.ok(), `test sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return { email };
}
```

- [ ] **Step 3: Failing e2e** — create `e2e/auth.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('signed out: nav shows a Sign in button', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('test sign-in: account menu appears and sign out restores signed-out nav', async ({
	page
}) => {
	await signUpTestUser(page, 'auth');
	await page.goto('/');
	const trigger = page.getByRole('button', { name: /account menu/i });
	await expect(trigger).toBeVisible();
	await expect(page.getByRole('button', { name: /^sign in$/i })).not.toBeVisible();
	await trigger.click();
	await expect(page.getByRole('menuitem', { name: /dashboard/i })).toBeVisible();
	await page.getByRole('menuitem', { name: /sign out/i }).click();
	await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
});
```

Run `npm run test:e2e -- auth` → first test PASSES (button exists today), second FAILS (no account menu yet).

- [ ] **Step 4: Auth client** — create `src/lib/auth-client.ts`:

```ts
import { createAuthClient } from 'better-auth/svelte';

/** Base URL defaults to the current origin — works on :5173 (vite) and :8787 (wrangler). */
export const authClient = createAuthClient();
```

- [ ] **Step 5: Session-aware Nav.** In `Nav.svelte`, subscribe to the session store **inside `onMount` only** — Nav renders during prerender at build time, and subscribing at init could trigger a session fetch in Node. Replace the placeholder sign-in button block (the last `<button>` in the nav) and add to the script:

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import { DropdownMenu } from 'bits-ui';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';

	let { onSearch }: { onSearch?: () => void } = $props();
	const links = [
		{ href: '/rules', label: 'Rules' },
		{ href: '/quiz', label: 'Quiz' },
		{ href: '/ask', label: 'Ask' }
	];

	type SessionUser = { name: string; email: string; image?: string | null };
	let user = $state<SessionUser | null>(null);

	onMount(() => {
		const store = authClient.useSession();
		return store.subscribe((s) => {
			user = s.data?.user ?? null;
		});
	});

	function signIn() {
		void authClient.signIn.social({ provider: 'google', callbackURL: location.pathname });
	}

	function signOut() {
		void authClient.signOut();
	}
</script>
```

Markup replacing the placeholder button:

```svelte
{#if user}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			aria-label="Account menu"
			class="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/25 text-xs font-bold text-white uppercase hover:border-white/60"
		>
			{#if user.image}
				<img src={user.image} alt="" referrerpolicy="no-referrer" class="h-full w-full object-cover" />
			{:else}
				{user.name?.[0] ?? '?'}
			{/if}
		</DropdownMenu.Trigger>
		<DropdownMenu.Portal>
			<DropdownMenu.Content
				sideOffset={8}
				align="end"
				class="z-50 min-w-44 rounded-xl border border-mist bg-white p-1.5 text-sm text-navy shadow-xl"
			>
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a
							{...props}
							href="/me"
							class="block w-full rounded-lg px-3 py-2 text-left font-semibold hover:bg-mist"
						>
							Dashboard
						</a>
					{/snippet}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					onSelect={signOut}
					class="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-navy/70 hover:bg-mist"
				>
					Sign out
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	</DropdownMenu.Root>
{:else}
	<button
		type="button"
		onclick={signIn}
		class="rounded-full border border-white/25 px-2 py-1.5 text-[11px] font-semibold tracking-wider whitespace-nowrap text-white/80 uppercase hover:border-white/60 hover:text-white sm:px-4 sm:text-xs"
	>
		Sign in
	</button>
{/if}
```

If the installed bits-ui DropdownMenu API differs (v2 `child` snippet, `onSelect`), check its current docs — requirements: trigger has accessible name "Account menu", items expose `menuitem` roles, Dashboard is a real `/me` link, Sign out calls `authClient.signOut()`.

- [ ] **Step 6: Verify** — `npm run check` passes. `npm run test:e2e -- auth` → both tests PASS. `npm run test:e2e` → full suite still green (existing specs unaffected; signed-out flows unchanged).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: session-aware nav with Google sign-in + test-login e2e infrastructure"
```

---

### Task 4: CHECKPOINT — Google OAuth credentials + manual sign-in verification

**This task is NOT for a subagent.** The controller (Fable) runs it with the user. **Deferrable:** Tasks 5–11 use the test sign-in flow for all automated verification — if the user is unavailable, continue and return here BEFORE Task 12 (deployment).

- [ ] **Step 1:** Ask the user to create a Google OAuth client (Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application) with:
  - Authorized JavaScript origins: `http://localhost:5173`, `http://localhost:8787`, `http://127.0.0.1:8787`
  - Authorized redirect URIs: `http://localhost:5173/api/auth/callback/google`, `http://localhost:8787/api/auth/callback/google`, `http://127.0.0.1:8787/api/auth/callback/google`
  **Two-client split (user decision 2026-07-10):** this localhost-only client is the DEV client; its secret lives in `.dev.vars`. A SEPARATE production client carries only origin `https://usaurules.com` and redirect URI `https://usaurules.com/api/auth/callback/google`; its secret is never written to disk — it is entered only via `wrangler secret put` at Task 12.
- [ ] **Step 2:** Have the user paste the client id + secret **directly into `.dev.vars`** (never into chat), keeping `ALLOW_TEST_SIGNIN=1` for e2e.
- [ ] **Step 3:** User runs `npm run dev`, clicks **Sign in**, completes the Google flow, and confirms: avatar appears in the nav, `select email from user` (via `npx wrangler d1 execute best-perspective-db --local --command "select email, name from user"`) shows their Google account, sign out works.
- [ ] **Step 4:** Record the result in the progress ledger. No commit (no repo files change).

---

### Task 5: Client persistence plumbing — local.ts split, payload schemas, storage merge, sync outbox

**Files:**
- Create: `src/lib/quiz/local.ts`
- Modify: `src/lib/quiz/storage.ts` (extract raw access; add `mergeServerState`; API stays sync)
- Create: `src/lib/quiz/payload.ts`
- Create: `src/lib/quiz/sync.ts`
- Test: `src/lib/quiz/sync.test.ts`, additions to `src/lib/quiz/storage.test.ts`

**Interfaces:**
- Consumes: `AnswerRecord`/`QuizItem` from `engine.ts` (`item.order[displayPos] → original choice index`), `ResponseRecord`/`TimedBest` from `storage.ts`.
- Produces (exact — Tasks 6–10 depend on these):

```ts
// src/lib/quiz/local.ts — raw localStorage-with-memory-fallback (moved from storage.ts)
export function readRaw(key: string): string | null;
export function writeRaw(key: string, value: string): void;
export function __resetLocal(): void; // test-only

// src/lib/quiz/payload.ts — shared client/server wire shapes (Zod 4)
export const ResponsePayloadSchema: z.ZodType<ResponsePayload>;
export interface ResponsePayload { questionId: string; choiceIndex: number; at: number; }
export const ATTEMPT_MAX_RESPONSES = 100;
export const AttemptPayloadSchema: z.ZodType<AttemptPayload>;
export interface AttemptPayload {
	clientId: string; // uuid
	rulesetId: string;
	mode: 'quick' | 'mastery';
	sectionSlug: string | null;
	startedAt: number;
	durationS: number;
	responses: ResponsePayload[]; // 1..ATTEMPT_MAX_RESPONSES
}
export const TIMED_DURATION_S = 60;
export const TIMED_GRACE_S = 20;
export const TIMED_MAX_RESPONSES = 60;
export const TimedFinishPayloadSchema: z.ZodType<TimedFinishPayload>;
export interface TimedFinishPayload {
	token: string;
	rulesetId: string;
	responses: { questionId: string; choiceIndex: number }[]; // ordered; 1..TIMED_MAX_RESPONSES
}
export const SyncStateSchema: z.ZodType<SyncState>;
export interface SyncState {
	responses: { questionId: string; sectionSlug: string; correct: boolean; at: number }[]; // chronological
	timedBest: { score: number; bestStreak: number; at: number } | null;
}

// src/lib/quiz/storage.ts — ADDITION (sync, like everything else in the file)
export function mergeServerState(rulesetId: string, responses: ResponseRecord[], timedBest: TimedBest | null): void;
// seeds local responses ONLY when local history is empty; adopts server timedBest when better

// src/lib/quiz/sync.ts
export function buildAttemptPayload(opts: {
	rulesetId: string; mode: 'quick' | 'mastery'; sectionSlug?: string;
	startedAt: number; durationS: number;
	items: QuizItem[]; records: AnswerRecord[]; completedAt?: number;
}): AttemptPayload | null; // null when no records map to items
export function enqueueAttempt(payload: AttemptPayload): void; // sync; kicks off background flush
export async function flushOutbox(): Promise<void>;   // fire-and-forget safe; never throws
export async function hydrateFromServer(rulesetId: string): Promise<void>; // never throws
export function __resetSync(): void; // test-only (clears in-flight latch)
```

- [ ] **Step 1: Extract `local.ts`.** Create `src/lib/quiz/local.ts` by MOVING `memory`, `readRaw`, `writeRaw` (and the explanatory comment about referencing localStorage) verbatim from `storage.ts`, exporting all three plus:

```ts
/** Test-only: clears the in-memory fallback between tests. */
export function __resetLocal(): void {
	memory.clear();
}
```

In `storage.ts`: delete the moved code, add `import { readRaw, writeRaw } from './local';` and keep the existing test hook working via a re-export:

```ts
export { __resetLocal as __resetMemory } from './local';
```

Run `npm run test` → the existing `storage.test.ts` still PASSES unchanged.

- [ ] **Step 2: Failing test for `mergeServerState`** — append to `src/lib/quiz/storage.test.ts` (match its existing imports/reset pattern):

```ts
describe('mergeServerState', () => {
	it('seeds responses only when local history is empty', () => {
		const server = [
			{ questionId: '9-01', sectionSlug: '9', correct: true, at: 200 },
			{ questionId: '2-01', sectionSlug: '2', correct: false, at: 100 }
		];
		mergeServerState('r', server, null);
		expect(loadResponses('r').map((r) => r.questionId)).toEqual(['2-01', '9-01']); // sorted by at
		mergeServerState('r', [{ questionId: '15-01', sectionSlug: '15', correct: true, at: 300 }], null);
		expect(loadResponses('r')).toHaveLength(2); // non-empty local wins — no reseed
	});
	it('adopts a better server timed best and keeps a better local one', () => {
		recordTimedResult('r', { score: 5, bestStreak: 3 }, 1000);
		mergeServerState('r', [], { score: 4, bestStreak: 4, at: 2000 });
		expect(getTimedBest('r')).toMatchObject({ score: 5 }); // local wins
		mergeServerState('r', [], { score: 7, bestStreak: 2, at: 3000 });
		expect(getTimedBest('r')).toMatchObject({ score: 7, at: 3000 }); // server wins
	});
});
```

Run `npx vitest run src/lib/quiz/storage` → FAIL (function missing).

- [ ] **Step 3: Implement in `storage.ts`.** Extract the best-comparison from `recordTimedResult` into a private helper and reuse it:

```ts
function isBetter(result: TimedResult, prev: TimedBest | null): boolean {
	return (
		!prev ||
		result.score > prev.score ||
		(result.score === prev.score && result.bestStreak > prev.bestStreak)
	);
}

/**
 * Background-sync entry point: folds server history into the local cache.
 * Local-first — an existing local history is never overwritten; the server
 * timed best is adopted only when it beats the local one.
 */
export function mergeServerState(
	rulesetId: string,
	responses: ResponseRecord[],
	timedBest: TimedBest | null
): void {
	const state = load(rulesetId);
	let changed = false;
	if (state.responses.length === 0 && responses.length > 0) {
		state.responses = [...responses].sort((a, b) => a.at - b.at).slice(-MAX_RESPONSES);
		changed = true;
	}
	if (timedBest && isBetter(timedBest, state.timedBest)) {
		state.timedBest = timedBest;
		changed = true;
	}
	if (changed) save(rulesetId, state);
}
```

Rewrite `recordTimedResult`'s condition to `const isNewBest = isBetter(result, prev);`. Run the storage tests → PASS.

- [ ] **Step 4: Payload schemas** — create `src/lib/quiz/payload.ts`:

```ts
import { z } from 'zod';

/** Wire shapes shared by the quiz pages, the sync outbox, and the /api handlers. */

export interface ResponsePayload {
	questionId: string;
	choiceIndex: number; // index into question.choices (original order, NOT display order)
	at: number; // epoch ms
}

export const ResponsePayloadSchema: z.ZodType<ResponsePayload> = z.object({
	questionId: z.string().min(1).max(64),
	choiceIndex: z.number().int().min(0).max(3),
	at: z.number().int().positive()
});

export const ATTEMPT_MAX_RESPONSES = 100;

export interface AttemptPayload {
	clientId: string;
	rulesetId: string;
	mode: 'quick' | 'mastery';
	sectionSlug: string | null;
	startedAt: number;
	durationS: number;
	responses: ResponsePayload[];
}

export const AttemptPayloadSchema: z.ZodType<AttemptPayload> = z.object({
	clientId: z.uuid(),
	rulesetId: z.string().min(1).max(64),
	mode: z.enum(['quick', 'mastery']),
	sectionSlug: z.string().min(1).max(64).nullable(),
	startedAt: z.number().int().positive(),
	durationS: z.number().int().min(0).max(24 * 3600),
	responses: z.array(ResponsePayloadSchema).min(1).max(ATTEMPT_MAX_RESPONSES)
});

export const TIMED_DURATION_S = 60;
export const TIMED_GRACE_S = 20; // server-side slack for network + clock skew
export const TIMED_MAX_RESPONSES = 60;

export interface TimedFinishPayload {
	token: string;
	rulesetId: string;
	responses: { questionId: string; choiceIndex: number }[]; // answer order matters (streak)
}

export const TimedFinishPayloadSchema: z.ZodType<TimedFinishPayload> = z.object({
	token: z.string().min(1).max(2048),
	rulesetId: z.string().min(1).max(64),
	responses: z
		.array(
			z.object({
				questionId: z.string().min(1).max(64),
				choiceIndex: z.number().int().min(0).max(3)
			})
		)
		.min(1)
		.max(TIMED_MAX_RESPONSES)
});

export interface SyncState {
	responses: { questionId: string; sectionSlug: string; correct: boolean; at: number }[];
	timedBest: { score: number; bestStreak: number; at: number } | null;
}

export const SyncStateSchema: z.ZodType<SyncState> = z.object({
	responses: z.array(
		z.object({
			questionId: z.string(),
			sectionSlug: z.string(),
			correct: z.boolean(),
			at: z.number()
		})
	),
	timedBest: z
		.object({ score: z.number().int(), bestStreak: z.number().int(), at: z.number() })
		.nullable()
});
```

(Zod 4 top-level `z.uuid()`, matching the `z.url()` precedent from Phase 2 Task 2. If the installed zod predates it, use `z.string().uuid()`.)

- [ ] **Step 5: Failing sync tests** — create `src/lib/quiz/sync.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerRecord, QuizItem } from './engine';
import type { Question } from './types';
import { __resetLocal, readRaw } from './local';
import { loadResponses } from './storage';
import { buildAttemptPayload, enqueueAttempt, flushOutbox, hydrateFromServer, __resetSync } from './sync';

const q = (id: string): Question => ({
	id,
	rulesetId: 'r',
	type: 'multiple-choice',
	prompt: `Prompt for ${id}?`,
	choices: ['a', 'b', 'c', 'd'],
	answerIndex: 2,
	explanation: 'Because the rules say so.',
	ruleRefs: ['15.D'],
	sectionSlug: '15',
	difficulty: 1
});

// Display order [2,0,3,1]: display position 0 shows original choice 2 (the correct one).
const item = (id: string): QuizItem => ({ question: q(id), order: [2, 0, 3, 1], correctChoice: 0 });
const record = (id: string, chosenChoice: number): AnswerRecord => ({
	questionId: id,
	sectionSlug: '15',
	chosenChoice,
	correct: chosenChoice === 0
});

const okJson = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	__resetLocal();
	__resetSync();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('buildAttemptPayload', () => {
	it('maps display positions back to original choice indices', () => {
		const payload = buildAttemptPayload({
			rulesetId: 'r',
			mode: 'quick',
			startedAt: 1000,
			durationS: 30,
			items: [item('15-01'), item('15-02')],
			records: [record('15-01', 0), record('15-02', 1)],
			completedAt: 5000
		});
		expect(payload).not.toBeNull();
		expect(payload!.responses).toEqual([
			{ questionId: '15-01', choiceIndex: 2, at: 5000 }, // display 0 → original 2
			{ questionId: '15-02', choiceIndex: 0, at: 5000 } // display 1 → original 0
		]);
		expect(payload!.sectionSlug).toBeNull();
		expect(payload!.clientId).toMatch(/^[0-9a-f-]{36}$/);
	});
	it('returns null when no records match items', () => {
		expect(
			buildAttemptPayload({
				rulesetId: 'r',
				mode: 'mastery',
				sectionSlug: '15',
				startedAt: 1,
				durationS: 1,
				items: [item('15-01')],
				records: []
			})
		).toBeNull();
	});
});

describe('outbox flush', () => {
	const payload = () =>
		buildAttemptPayload({
			rulesetId: 'r',
			mode: 'quick',
			startedAt: 1000,
			durationS: 30,
			items: [item('15-01')],
			records: [record('15-01', 0)],
			completedAt: 5000
		})!;

	it('enqueue + successful flush empties the outbox', async () => {
		fetchMock.mockResolvedValue(okJson({ id: 'a1' }, 201));
		enqueueAttempt(payload());
		await flushOutbox();
		expect(fetchMock).toHaveBeenCalledWith('/api/attempts', expect.objectContaining({ method: 'POST' }));
		expect(JSON.parse(readRaw('bp:sync:v1:outbox') ?? '[]')).toHaveLength(0);
	});
	it('401 keeps the attempt queued for after sign-in', async () => {
		fetchMock.mockResolvedValue(okJson({ message: 'sign in required' }, 401));
		enqueueAttempt(payload());
		await flushOutbox();
		expect(JSON.parse(readRaw('bp:sync:v1:outbox') ?? '[]')).toHaveLength(1);
	});
	it('400 and 409 drop the poison/duplicate entry; network errors keep it', async () => {
		enqueueAttempt(payload());
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		await flushOutbox();
		expect(JSON.parse(readRaw('bp:sync:v1:outbox') ?? '[]')).toHaveLength(1);
		fetchMock.mockResolvedValueOnce(okJson({ message: 'bad' }, 400));
		await flushOutbox();
		expect(JSON.parse(readRaw('bp:sync:v1:outbox') ?? '[]')).toHaveLength(0);
	});
});

describe('hydrateFromServer', () => {
	it('seeds local storage from /api/sync', async () => {
		fetchMock.mockResolvedValue(
			okJson({
				responses: [{ questionId: '9-01', sectionSlug: '9', correct: true, at: 100 }],
				timedBest: null
			})
		);
		await hydrateFromServer('r');
		expect(loadResponses('r')).toHaveLength(1);
	});
	it('ignores errors and malformed payloads', async () => {
		fetchMock.mockResolvedValueOnce(okJson({ nope: true }));
		await hydrateFromServer('r');
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		await hydrateFromServer('r');
		expect(loadResponses('r')).toHaveLength(0);
	});
});
```

Run `npx vitest run src/lib/quiz/sync` → FAIL (module missing).

- [ ] **Step 6: Implement `src/lib/quiz/sync.ts`:**

```ts
import { z } from 'zod';
import type { AnswerRecord, QuizItem } from './engine';
import { readRaw, writeRaw } from './local';
import { mergeServerState } from './storage';
import { AttemptPayloadSchema, SyncStateSchema, type AttemptPayload } from './payload';

/**
 * Local-first background sync. Quiz pages call the SYNC functions here
 * (enqueueAttempt/buildAttemptPayload); network work happens later in the
 * background and silently degrades to local-only on any failure.
 */

const OUTBOX_KEY = 'bp:sync:v1:outbox';
const OUTBOX_MAX = 50;

function readOutbox(): AttemptPayload[] {
	const raw = readRaw(OUTBOX_KEY);
	if (!raw) return [];
	try {
		return z.array(AttemptPayloadSchema).parse(JSON.parse(raw));
	} catch {
		return []; // corrupted — start fresh
	}
}

function writeOutbox(outbox: AttemptPayload[]): void {
	writeRaw(OUTBOX_KEY, JSON.stringify(outbox.slice(-OUTBOX_MAX)));
}

export function buildAttemptPayload(opts: {
	rulesetId: string;
	mode: 'quick' | 'mastery';
	sectionSlug?: string;
	startedAt: number;
	durationS: number;
	items: QuizItem[];
	records: AnswerRecord[];
	completedAt?: number;
}): AttemptPayload | null {
	const at = opts.completedAt ?? Date.now();
	const byId = new Map(opts.items.map((item) => [item.question.id, item]));
	const responses = [];
	for (const record of opts.records) {
		const item = byId.get(record.questionId);
		if (!item) continue;
		responses.push({
			questionId: record.questionId,
			choiceIndex: item.order[record.chosenChoice],
			at
		});
	}
	if (responses.length === 0) return null;
	return {
		clientId: crypto.randomUUID(),
		rulesetId: opts.rulesetId,
		mode: opts.mode,
		sectionSlug: opts.sectionSlug ?? null,
		startedAt: opts.startedAt,
		durationS: opts.durationS,
		responses
	};
}

export function enqueueAttempt(payload: AttemptPayload): void {
	writeOutbox([...readOutbox(), payload]);
	void flushOutbox();
}

let flushing = false;

/** Test-only: clears the in-flight latch. */
export function __resetSync(): void {
	flushing = false;
}

export async function flushOutbox(): Promise<void> {
	if (flushing) return;
	flushing = true;
	try {
		for (;;) {
			const outbox = readOutbox();
			const payload = outbox[0];
			if (!payload) return;
			let res: Response;
			try {
				res = await fetch('/api/attempts', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload)
				});
			} catch {
				return; // offline — retry on the next trigger
			}
			if (res.status === 401) return; // signed out — keep queued for after sign-in
			const stored = res.ok || res.status === 409; // 409 = duplicate (already stored)
			const poison = res.status === 400; // permanently invalid — drop so it can't wedge the queue
			if (!stored && !poison) return; // 5xx etc — retry later
			writeOutbox(readOutbox().filter((p) => p.clientId !== payload.clientId));
		}
	} finally {
		flushing = false;
	}
}

export async function hydrateFromServer(rulesetId: string): Promise<void> {
	let res: Response;
	try {
		res = await fetch(`/api/sync?ruleset=${encodeURIComponent(rulesetId)}`);
	} catch {
		return;
	}
	if (!res.ok) return;
	const parsed = SyncStateSchema.safeParse(await res.json().catch(() => null));
	if (!parsed.success) return;
	mergeServerState(rulesetId, parsed.data.responses, parsed.data.timedBest);
}
```

- [ ] **Step 7: Verify** — `npx vitest run src/lib/quiz` → ALL quiz tests PASS (including untouched storage/engine/mastery suites). `npm run check && npx prettier --check .` → pass.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: local-first sync plumbing — payload schemas, outbox, server-state merge"
```

---

### Task 6: Server persistence — verification module, POST /api/attempts, GET /api/sync

**Files:**
- Create: `src/lib/server/quiz/verify.ts`
- Test: `src/lib/server/quiz/verify.test.ts`
- Create: `src/routes/api/attempts/+server.ts`
- Create: `src/routes/api/sync/+server.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 2), `quizAttempts`/`questionResponses` schema (Task 1), `AttemptPayloadSchema`/`SyncState` (Task 5), `listQuestions` from `$lib/quiz/bank` (bank JSON bundles into the worker — fine, ~200KB), `DEFAULT_RULESET_ID`.
- Produces (exact — Task 8 reuses these):

```ts
// src/lib/server/quiz/verify.ts
export function bankById(rulesetId: string): Map<string, Question>; // memoized per ruleset
export interface VerifiedResponse {
	questionId: string; sectionSlug: string; choiceIndex: number; correct: boolean; at: number;
}
export interface ResponseInput { questionId: string; choiceIndex: number; at?: number; }
export function verifyResponses(
	inputs: ResponseInput[],
	bank: Map<string, Question>,
	now?: number
): { ok: true; verified: VerifiedResponse[] } | { ok: false; reason: string };
// rejects unknown question ids and duplicate ids; correct/sectionSlug come from the BANK
export function recomputeTimed(verified: VerifiedResponse[]): { score: number; bestStreak: number };
```

- Endpoints: `POST /api/attempts` → `201 {id}` | `409 {id, duplicate}` | `400` | `401`; `GET /api/sync?ruleset=<id>` → `200 SyncState` | `401`.

- [ ] **Step 1: Failing verify tests** — create `src/lib/server/quiz/verify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Question } from '$lib/quiz/types';
import { recomputeTimed, verifyResponses } from './verify';

const q = (id: string, answerIndex: number): Question => ({
	id,
	rulesetId: 'r',
	type: 'multiple-choice',
	prompt: `Prompt for ${id}?`,
	choices: ['a', 'b', 'c', 'd'],
	answerIndex,
	explanation: 'Because the rules say so.',
	ruleRefs: ['15.D'],
	sectionSlug: id.split('-')[0],
	difficulty: 1
});
const bank = new Map([
	['15-01', q('15-01', 2)],
	['15-02', q('15-02', 0)],
	['9-01', q('9-01', 1)]
]);

describe('verifyResponses', () => {
	it('recomputes correctness and section from the bank, never the client', () => {
		const result = verifyResponses(
			[
				{ questionId: '15-01', choiceIndex: 2, at: 100 },
				{ questionId: '9-01', choiceIndex: 3, at: 200 }
			],
			bank
		);
		expect(result).toMatchObject({
			ok: true,
			verified: [
				{ questionId: '15-01', sectionSlug: '15', choiceIndex: 2, correct: true, at: 100 },
				{ questionId: '9-01', sectionSlug: '9', choiceIndex: 3, correct: false, at: 200 }
			]
		});
	});
	it('defaults missing timestamps to now', () => {
		const result = verifyResponses([{ questionId: '15-01', choiceIndex: 0 }], bank, 12345);
		expect(result.ok && result.verified[0].at).toBe(12345);
	});
	it('rejects unknown and duplicate question ids', () => {
		expect(verifyResponses([{ questionId: 'nope', choiceIndex: 0 }], bank)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('unknown question')
		});
		expect(
			verifyResponses(
				[
					{ questionId: '15-01', choiceIndex: 0 },
					{ questionId: '15-01', choiceIndex: 1 }
				],
				bank
			)
		).toMatchObject({ ok: false, reason: expect.stringContaining('duplicate') });
	});
});

describe('recomputeTimed', () => {
	it('scores and finds the best streak from ordered responses', () => {
		const v = (correct: boolean) => ({
			questionId: 'x',
			sectionSlug: '15',
			choiceIndex: 0,
			correct,
			at: 0
		});
		const { score, bestStreak } = recomputeTimed(
			[true, true, false, true, true, true, false].map(v)
		);
		expect(score).toBe(5);
		expect(bestStreak).toBe(3);
	});
	it('handles an all-wrong run', () => {
		expect(
			recomputeTimed([{ questionId: 'x', sectionSlug: '15', choiceIndex: 0, correct: false, at: 0 }])
		).toEqual({ score: 0, bestStreak: 0 });
	});
});
```

Run `npx vitest run src/lib/server` → FAIL (module missing).

- [ ] **Step 2: Implement `src/lib/server/quiz/verify.ts`:**

```ts
import { listQuestions } from '$lib/quiz/bank';
import type { Question } from '$lib/quiz/types';

/** Server-authoritative scoring: the client's idea of "correct" is never persisted. */

const bankCache = new Map<string, Map<string, Question>>();

export function bankById(rulesetId: string): Map<string, Question> {
	let byId = bankCache.get(rulesetId);
	if (!byId) {
		byId = new Map(listQuestions(rulesetId).map((q) => [q.id, q]));
		bankCache.set(rulesetId, byId);
	}
	return byId;
}

export interface VerifiedResponse {
	questionId: string;
	sectionSlug: string;
	choiceIndex: number;
	correct: boolean;
	at: number;
}

export interface ResponseInput {
	questionId: string;
	choiceIndex: number;
	at?: number;
}

export function verifyResponses(
	inputs: ResponseInput[],
	bank: Map<string, Question>,
	now = Date.now()
): { ok: true; verified: VerifiedResponse[] } | { ok: false; reason: string } {
	const seen = new Set<string>();
	const verified: VerifiedResponse[] = [];
	for (const input of inputs) {
		const question = bank.get(input.questionId);
		if (!question) return { ok: false, reason: `unknown question ${input.questionId}` };
		if (seen.has(input.questionId)) {
			return { ok: false, reason: `duplicate question ${input.questionId}` };
		}
		seen.add(input.questionId);
		verified.push({
			questionId: question.id,
			sectionSlug: question.sectionSlug,
			choiceIndex: input.choiceIndex,
			correct: input.choiceIndex === question.answerIndex,
			at: input.at ?? now
		});
	}
	return { ok: true, verified };
}

export function recomputeTimed(verified: VerifiedResponse[]): {
	score: number;
	bestStreak: number;
} {
	let score = 0;
	let streak = 0;
	let bestStreak = 0;
	for (const response of verified) {
		if (response.correct) {
			score++;
			streak++;
			bestStreak = Math.max(bestStreak, streak);
		} else {
			streak = 0;
		}
	}
	return { score, bestStreak };
}
```

Run `npx vitest run src/lib/server` → PASS.

- [ ] **Step 3: Attempts endpoint** — create `src/routes/api/attempts/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { AttemptPayloadSchema } from '$lib/quiz/payload';
import { questionResponses, quizAttempts } from '$lib/server/db/schema';
import { bankById, verifyResponses } from '$lib/server/quiz/verify';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const parsed = AttemptPayloadSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid attempt payload');
	const payload = parsed.data;

	const bank = bankById(payload.rulesetId);
	if (bank.size === 0) error(400, 'unknown ruleset');
	const result = verifyResponses(payload.responses, bank);
	if (!result.ok) error(400, result.reason);

	const db = event.locals.db;
	const dup = await db
		.select({ id: quizAttempts.id })
		.from(quizAttempts)
		.where(eq(quizAttempts.clientId, payload.clientId))
		.limit(1);
	if (dup.length > 0) return json({ id: dup[0].id, duplicate: true }, { status: 409 });

	const id = crypto.randomUUID();
	const score = result.verified.filter((r) => r.correct).length;
	await db.batch([
		db.insert(quizAttempts).values({
			id,
			userId: user.id,
			clientId: payload.clientId,
			rulesetId: payload.rulesetId,
			mode: payload.mode,
			sectionSlug: payload.sectionSlug,
			score,
			total: result.verified.length,
			bestStreak: null,
			startedAt: payload.startedAt,
			durationS: payload.durationS,
			createdAt: Date.now()
		}),
		db.insert(questionResponses).values(
			result.verified.map((r) => ({
				attemptId: id,
				userId: user.id,
				rulesetId: payload.rulesetId,
				questionId: r.questionId,
				sectionSlug: r.sectionSlug,
				choiceIndex: r.choiceIndex,
				correct: r.correct,
				at: r.at
			}))
		)
	]);
	return json({ id }, { status: 201 });
};
```

(A racing duplicate insert trips the unique `client_id` index → 500 → the client outbox retries → hits the dup check → 409 → dropped. Self-healing.)

- [ ] **Step 4: Sync endpoint** — create `src/routes/api/sync/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import type { SyncState } from '$lib/quiz/payload';
import { questionResponses, quizAttempts } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

const MAX_RESPONSES = 2000; // mirrors the localStorage cap in $lib/quiz/storage

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const rulesetId = event.url.searchParams.get('ruleset') ?? DEFAULT_RULESET_ID;
	const db = event.locals.db;

	const rows = await db
		.select({
			questionId: questionResponses.questionId,
			sectionSlug: questionResponses.sectionSlug,
			correct: questionResponses.correct,
			at: questionResponses.at
		})
		.from(questionResponses)
		.where(and(eq(questionResponses.userId, user.id), eq(questionResponses.rulesetId, rulesetId)))
		.orderBy(desc(questionResponses.at), desc(questionResponses.id))
		.limit(MAX_RESPONSES);
	rows.reverse(); // chronological, as the local cache expects

	const bestRows = await db
		.select({
			score: quizAttempts.score,
			bestStreak: quizAttempts.bestStreak,
			createdAt: quizAttempts.createdAt
		})
		.from(quizAttempts)
		.where(
			and(
				eq(quizAttempts.userId, user.id),
				eq(quizAttempts.rulesetId, rulesetId),
				eq(quizAttempts.mode, 'timed')
			)
		)
		.orderBy(desc(quizAttempts.score), desc(quizAttempts.bestStreak))
		.limit(1);
	const best = bestRows[0];

	const state: SyncState = {
		responses: rows,
		timedBest: best
			? { score: best.score, bestStreak: best.bestStreak ?? 0, at: best.createdAt }
			: null
	};
	return json(state);
};
```

- [ ] **Step 5: Verify against the running worker.** Signed-out first:

```bash
npm run build && npm run db:migrate:local
npx wrangler dev --port 8787 &   # wait for ready
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8787/api/attempts -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/sync
```

Expected: `401` twice. Then the signed-in round trip — read the FIRST question of `content/questions/usau-official-2026-27/15.json` and note its `id` and `answerIndex` (call them `QID` and `AIDX`):

```bash
JAR=$(mktemp)
curl -s -c "$JAR" -X POST http://127.0.0.1:8787/api/auth/sign-up/email \
  -H 'content-type: application/json' \
  -d '{"email":"apitest-'$RANDOM'@example.com","password":"test-password-123","name":"API Test"}'
curl -s -b "$JAR" -X POST http://127.0.0.1:8787/api/attempts \
  -H 'content-type: application/json' \
  -d '{"clientId":"11111111-1111-4111-8111-111111111111","rulesetId":"usau-official-2026-27","mode":"quick","sectionSlug":null,"startedAt":1752100000000,"durationS":30,"responses":[{"questionId":"QID","choiceIndex":AIDX,"at":1752100030000}]}'
# → 201 {"id":"…"}; repeat the same command → 409 {"id":"…","duplicate":true}
curl -s -b "$JAR" http://127.0.0.1:8787/api/sync
# → {"responses":[{"questionId":"QID","sectionSlug":"15","correct":true,"at":1752100030000}],"timedBest":null}
```

Also send a bad payload (`"questionId":"nope"`) → `400`. Kill the dev server.

- [ ] **Step 6: Full local suite** — `npm run check && npm run test && npx prettier --check .` → pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: server-verified attempt persistence + sync pull endpoint"
```

---

### Task 7: Wire quick + mastery quizzes into the outbox; sign-in triggers flush/hydrate

**Files:**
- Modify: `src/routes/quiz/quick/+page.svelte`
- Modify: `src/routes/quiz/mastery/+page.svelte`
- Modify: `src/routes/+layout.svelte`
- Create: `e2e/quiz-sync.spec.ts`

**Interfaces:**
- Consumes: `buildAttemptPayload`/`enqueueAttempt`/`flushOutbox`/`hydrateFromServer` (Task 5), `authClient` (Task 3), `POST /api/attempts` + `GET /api/sync` (Task 6).
- Produces: no new APIs — behavior only. Signed-out behavior is byte-identical (enqueue still happens; flush 401s and keeps the outbox, which uploads after a later sign-in).

- [ ] **Step 1: Failing e2e** — create `e2e/quiz-sync.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('a signed-in quick quiz lands in D1 and comes back from /api/sync', async ({ page }) => {
	await signUpTestUser(page, 'sync');
	await page.goto('/quiz/quick');
	await page.getByRole('button', { name: /start quiz/i }).click();
	for (let i = 0; i < 10; i++) {
		await page.getByTestId('choice').first().click();
		await page.getByRole('button', { name: /next question|see results/i }).click();
	}
	await expect(page.getByText(/% correct/)).toBeVisible();
	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/sync');
				if (!res.ok()) return -1;
				const state = (await res.json()) as { responses: unknown[] };
				return state.responses.length;
			},
			{ timeout: 10_000 }
		)
		.toBe(10);
});
```

Run `npm run test:e2e -- quiz-sync` → FAIL (nothing enqueues yet).

- [ ] **Step 2: Quick page.** In `src/routes/quiz/quick/+page.svelte`:

Add imports and a start timestamp:

```ts
import { buildAttemptPayload, enqueueAttempt } from '$lib/quiz/sync';
// …
let startedAt = 0;
```

In `start()`, after `records = [];` add `startedAt = Date.now();`. Replace `complete`:

```ts
function complete(finished: AnswerRecord[]) {
	records = finished;
	recordAnswers(DEFAULT_RULESET_ID, finished);
	const payload = buildAttemptPayload({
		rulesetId: DEFAULT_RULESET_ID,
		mode: 'quick',
		startedAt,
		durationS: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
		items,
		records: finished
	});
	if (payload) enqueueAttempt(payload);
	phase = 'done';
}
```

Deferred-Minor fold-in (Phase 2 Task 10): the pool-count line gets a live region — change `<p class="text-sm text-navy/60">` (the `{pool.length} question… match` one) to `<p class="text-sm text-navy/60" aria-live="polite">`.

- [ ] **Step 3: Mastery page.** Same pattern in `src/routes/quiz/mastery/+page.svelte`: import `buildAttemptPayload`/`enqueueAttempt`, add `let startedAt = 0;`, set `startedAt = Date.now();` inside `startSection()` (next to `records = [];`), and in `complete()` after `recordAnswers(…)`:

```ts
const payload = buildAttemptPayload({
	rulesetId: DEFAULT_RULESET_ID,
	mode: 'mastery',
	sectionSlug: active!.slug,
	startedAt,
	durationS: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
	items,
	records: finished
});
if (payload) enqueueAttempt(payload);
```

- [ ] **Step 4: Layout sign-in trigger.** In `src/routes/+layout.svelte` add to the script:

```ts
import { onMount } from 'svelte';
import { authClient } from '$lib/auth-client';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { flushOutbox, hydrateFromServer } from '$lib/quiz/sync';

onMount(() => {
	let wasSignedIn = false;
	const store = authClient.useSession();
	return store.subscribe(({ data }) => {
		const signedIn = Boolean(data);
		if (signedIn && !wasSignedIn) {
			void flushOutbox(); // upload anything played before/while signed out
			void hydrateFromServer(DEFAULT_RULESET_ID); // seed a fresh device from the account
		}
		wasSignedIn = signedIn;
	});
});
```

- [ ] **Step 5: Verify** — `npm run check` passes; `npm run test` passes; `npm run test:e2e -- quiz-sync` → PASS; `npm run test:e2e` → whole suite green (signed-out quiz specs unchanged — they enqueue, get 401, and stay local, invisible to the UI).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: quick + mastery attempts sync to D1 in the background"
```

---

### Task 8: Timed challenge — HMAC run tokens, validated finish endpoint, page wiring

**Files:**
- Create: `src/lib/server/quiz/run-token.ts`
- Test: `src/lib/server/quiz/run-token.test.ts`
- Create: `src/routes/api/timed/start/+server.ts`
- Create: `src/routes/api/timed/finish/+server.ts`
- Modify: `src/lib/quiz/sync.ts` (+ `src/lib/quiz/sync.test.ts` additions)
- Modify: `src/routes/quiz/timed/+page.svelte`
- Create: `e2e/timed-sync.spec.ts`

**Interfaces:**
- Consumes: `requireUser`, `bankById`/`verifyResponses`/`recomputeTimed` (Task 6), `TimedFinishPayloadSchema`/`TIMED_DURATION_S`/`TIMED_GRACE_S` (Task 5), schema tables (Task 1).
- Produces (exact):

```ts
// src/lib/server/quiz/run-token.ts (WebCrypto HMAC-SHA256; works in Workers and Node 22)
export interface RunClaims { userId: string; runId: string; startedAt: number; }
export async function mintRunToken(claims: RunClaims, secret: string): Promise<string>; // "<b64 payload>.<hex sig>"
export async function verifyRunToken(token: string, secret: string): Promise<RunClaims | null>;

// src/lib/quiz/sync.ts additions (network failures → null / silent return; never throw)
export async function beginTimedRun(): Promise<string | null>; // POST /api/timed/start → token
export async function submitTimedRun(opts: {
	token: string; rulesetId: string; items: QuizItem[]; records: AnswerRecord[];
}): Promise<void>; // POST /api/timed/finish
```

- Endpoints: `POST /api/timed/start` → `200 {token}` | `401`; `POST /api/timed/finish` → `201 {score, bestStreak}` | `400` | `401` | `409` (replayed run).

- [ ] **Step 1: Failing token tests** — create `src/lib/server/quiz/run-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mintRunToken, verifyRunToken } from './run-token';

const claims = { userId: 'u1', runId: 'r1', startedAt: 1752100000000 };

describe('run tokens', () => {
	it('round-trips valid claims', async () => {
		const token = await mintRunToken(claims, 'secret-a');
		expect(await verifyRunToken(token, 'secret-a')).toEqual(claims);
	});
	it('rejects a tampered payload', async () => {
		const token = await mintRunToken(claims, 'secret-a');
		const [payload, sig] = token.split('.');
		const forged = btoa(JSON.stringify({ ...claims, startedAt: 9999999999999 }));
		expect(await verifyRunToken(`${forged}.${sig}`, 'secret-a')).toBeNull();
		expect(await verifyRunToken(`${payload}.${'0'.repeat(sig.length)}`, 'secret-a')).toBeNull();
	});
	it('rejects the wrong secret and malformed tokens', async () => {
		const token = await mintRunToken(claims, 'secret-a');
		expect(await verifyRunToken(token, 'secret-b')).toBeNull();
		expect(await verifyRunToken('garbage', 'secret-a')).toBeNull();
		expect(await verifyRunToken('not-base64!.deadbeef', 'secret-a')).toBeNull();
	});
});
```

Run `npx vitest run src/lib/server/quiz/run-token` → FAIL.

- [ ] **Step 2: Implement `src/lib/server/quiz/run-token.ts`:**

```ts
import { z } from 'zod';

/**
 * Stateless anti-cheat handshake for timed runs: the server signs
 * {userId, runId, startedAt} at run start and only accepts results whose
 * token verifies AND whose elapsed time fits the run window. Replay is
 * blocked by quiz_attempts.client_id = "timed:<runId>" (unique).
 */

export interface RunClaims {
	userId: string;
	runId: string;
	startedAt: number;
}

const ClaimsSchema: z.ZodType<RunClaims> = z.object({
	userId: z.string().min(1),
	runId: z.string().min(1),
	startedAt: z.number().int().positive()
});

const encoder = new TextEncoder();

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function toHex(buf: ArrayBuffer): string {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array | null {
	if (hex.length % 2 !== 0 || /[^0-9a-f]/.test(hex)) return null;
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return bytes;
}

export async function mintRunToken(claims: RunClaims, secret: string): Promise<string> {
	const payload = btoa(JSON.stringify(claims));
	const key = await hmacKey(secret, 'sign');
	const sig = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
	return `${payload}.${sig}`;
}

export async function verifyRunToken(token: string, secret: string): Promise<RunClaims | null> {
	const dot = token.indexOf('.');
	if (dot === -1) return null;
	const payload = token.slice(0, dot);
	const sigBytes = fromHex(token.slice(dot + 1));
	if (!sigBytes) return null;
	const key = await hmacKey(secret, 'verify');
	let valid = false;
	try {
		valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));
	} catch {
		return null;
	}
	if (!valid) return null;
	try {
		return ClaimsSchema.parse(JSON.parse(atob(payload)));
	} catch {
		return null;
	}
}
```

Run → PASS.

- [ ] **Step 3: Start endpoint** — create `src/routes/api/timed/start/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mintRunToken } from '$lib/server/quiz/run-token';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const token = await mintRunToken(
		{ userId: user.id, runId: crypto.randomUUID(), startedAt: Date.now() },
		event.platform!.env.BETTER_AUTH_SECRET
	);
	return json({ token });
};
```

- [ ] **Step 4: Finish endpoint** — create `src/routes/api/timed/finish/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { TIMED_DURATION_S, TIMED_GRACE_S, TimedFinishPayloadSchema } from '$lib/quiz/payload';
import { questionResponses, quizAttempts } from '$lib/server/db/schema';
import { verifyRunToken } from '$lib/server/quiz/run-token';
import { bankById, recomputeTimed, verifyResponses } from '$lib/server/quiz/verify';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const parsed = TimedFinishPayloadSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid timed payload');
	const payload = parsed.data;

	const claims = await verifyRunToken(payload.token, event.platform!.env.BETTER_AUTH_SECRET);
	if (!claims || claims.userId !== user.id) error(400, 'invalid run token');
	const now = Date.now();
	const elapsedMs = now - claims.startedAt;
	if (elapsedMs < 1000 || elapsedMs > (TIMED_DURATION_S + TIMED_GRACE_S) * 1000) {
		error(400, 'run outside the time window');
	}

	const bank = bankById(payload.rulesetId);
	if (bank.size === 0) error(400, 'unknown ruleset');
	const result = verifyResponses(payload.responses, bank, now);
	if (!result.ok) error(400, result.reason);
	const { score, bestStreak } = recomputeTimed(result.verified);

	const db = event.locals.db;
	const clientId = `timed:${claims.runId}`;
	const dup = await db
		.select({ id: quizAttempts.id })
		.from(quizAttempts)
		.where(eq(quizAttempts.clientId, clientId))
		.limit(1);
	if (dup.length > 0) return json({ id: dup[0].id, duplicate: true }, { status: 409 });

	const id = crypto.randomUUID();
	await db.batch([
		db.insert(quizAttempts).values({
			id,
			userId: user.id,
			clientId,
			rulesetId: payload.rulesetId,
			mode: 'timed',
			sectionSlug: null,
			score,
			total: result.verified.length,
			bestStreak,
			startedAt: claims.startedAt,
			durationS: Math.min(TIMED_DURATION_S, Math.round(elapsedMs / 1000)),
			createdAt: now
		}),
		db.insert(questionResponses).values(
			result.verified.map((r) => ({
				attemptId: id,
				userId: user.id,
				rulesetId: payload.rulesetId,
				questionId: r.questionId,
				sectionSlug: r.sectionSlug,
				choiceIndex: r.choiceIndex,
				correct: r.correct,
				at: r.at
			}))
		)
	]);
	return json({ score, bestStreak }, { status: 201 });
};
```

- [ ] **Step 5: Client helpers.** Append to `src/lib/quiz/sync.ts`:

```ts
/** Requests a signed run token; null when signed out/offline (run stays local-only). */
export async function beginTimedRun(): Promise<string | null> {
	try {
		const res = await fetch('/api/timed/start', { method: 'POST' });
		if (!res.ok) return null;
		const data = (await res.json().catch(() => null)) as { token?: string } | null;
		return data?.token ?? null;
	} catch {
		return null;
	}
}

/** Submits a finished timed run for server-side validation. Fire-and-forget. */
export async function submitTimedRun(opts: {
	token: string;
	rulesetId: string;
	items: QuizItem[];
	records: AnswerRecord[];
}): Promise<void> {
	const byId = new Map(opts.items.map((item) => [item.question.id, item]));
	const responses = [];
	for (const record of opts.records) {
		const item = byId.get(record.questionId);
		if (!item) continue;
		responses.push({ questionId: record.questionId, choiceIndex: item.order[record.chosenChoice] });
	}
	if (responses.length === 0) return;
	try {
		await fetch('/api/timed/finish', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token: opts.token, rulesetId: opts.rulesetId, responses })
		});
	} catch {
		// offline — the run stays local-only by design
	}
}
```

Add tests to `src/lib/quiz/sync.test.ts` (same mocked-fetch setup):

```ts
describe('timed run sync', () => {
	it('beginTimedRun returns the token, null on 401/network error', async () => {
		const { beginTimedRun } = await import('./sync');
		fetchMock.mockResolvedValueOnce(okJson({ token: 't0k' }));
		expect(await beginTimedRun()).toBe('t0k');
		fetchMock.mockResolvedValueOnce(okJson({ message: 'no' }, 401));
		expect(await beginTimedRun()).toBeNull();
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		expect(await beginTimedRun()).toBeNull();
	});
	it('submitTimedRun posts original choice indices in answer order', async () => {
		const { submitTimedRun } = await import('./sync');
		fetchMock.mockResolvedValue(okJson({ score: 1, bestStreak: 1 }, 201));
		await submitTimedRun({
			token: 't0k',
			rulesetId: 'r',
			items: [item('15-01'), item('15-02')],
			records: [record('15-02', 1), record('15-01', 0)]
		});
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.responses).toEqual([
			{ questionId: '15-02', choiceIndex: 0 },
			{ questionId: '15-01', choiceIndex: 2 }
		]);
	});
});
```

- [ ] **Step 6: Timed page wiring** — in `src/routes/quiz/timed/+page.svelte`:

Imports: replace the local `const DURATION_S = 60;` with `import { TIMED_DURATION_S as DURATION_S } from '$lib/quiz/payload';` and add `import { beginTimedRun, submitTimedRun } from '$lib/quiz/sync';`. Add state `let runToken: Promise<string | null> = Promise.resolve(null);`.

In `start()`, request the token (non-blocking) and apply the deferred-Minor timer fix (run currently ends ~0.5 s early via `Math.round`):

```ts
function start() {
	runToken = beginTimedRun();
	const rng = mulberry32(Date.now());
	items = buildQuizItems(shuffle(bank, rng), rng);
	records = [];
	streak = 0;
	bestStreak = 0;
	timeLeft = DURATION_S;
	phase = 'running';
	const startedAt = Date.now();
	ticker = setInterval(() => {
		const elapsedMs = Date.now() - startedAt;
		timeLeft = Math.max(0, Math.ceil(DURATION_S - elapsedMs / 1000));
		if (elapsedMs >= DURATION_S * 1000) finish();
	}, 250);
}
```

In `finish()`, inside the existing `if (records.length > 0)` block, after `best = result.best;` add the fire-and-forget submission (captured locals so a restarted run can't race):

```ts
const finishedItems = items;
const finishedRecords = records;
void (async () => {
	const token = await runToken;
	if (token) {
		await submitTimedRun({
			token,
			rulesetId: DEFAULT_RULESET_ID,
			items: finishedItems,
			records: finishedRecords
		});
	}
})();
```

- [ ] **Step 7: e2e** — create `e2e/timed-sync.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('a signed-in timed run persists a server-validated best', async ({ page }) => {
	await signUpTestUser(page, 'timed');
	await page.goto('/quiz/timed');
	await page.waitForLoadState('networkidle'); // hydration race — see quiz.spec.ts
	await page.getByRole('button', { name: /^start$/i }).click();
	for (let i = 0; i < 3; i++) {
		await page.getByTestId('choice').first().click();
		// rapid mode auto-advances (~600ms)
		await page.waitForTimeout(750);
	}
	await page.getByRole('button', { name: /end run/i }).click();
	await expect(page.getByText(/time!/i)).toBeVisible();
	await expect
		.poll(
			async () => {
				const res = await page.request.get('/api/sync');
				if (!res.ok()) return null;
				const state = (await res.json()) as { timedBest: { score: number } | null };
				return state.timedBest;
			},
			{ timeout: 10_000 }
		)
		.not.toBeNull();
});
```

- [ ] **Step 8: Verify** — `npm run check && npm run test` pass. `npm run test:e2e -- timed-sync` → PASS. `npm run test:e2e` → full suite green (the existing timed spec still passes with the ceil-based timer).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: server-authoritative timed challenge validation (HMAC run tokens)"
```

---

### Task 9: Bookmarks — API, client store, explorer toggle

**Files:**
- Create: `src/routes/api/bookmarks/+server.ts`
- Create: `src/lib/bookmarks.svelte.ts`
- Modify: `src/lib/components/rules/RuleNode.svelte` (rulesetId prop + toggle button)
- Modify: `src/routes/rules/[ruleset]/[section]/+page.svelte` (pass rulesetId)
- Modify: `src/routes/+layout.svelte` (load/reset on session change)
- Create: `e2e/bookmarks.spec.ts`

**Interfaces:**
- Consumes: `requireUser`, `bookmarks` table (Task 1), `getManifest` from `$lib/content/manifests`, `sectionSlugForRuleId` from `$lib/content/rule-ids`, `authClient` session subscription in the layout (Task 7's block).
- Produces (exact — Task 10 renders bookmark rows; the store is UI-only):

```ts
// GET /api/bookmarks → 200 { bookmarks: { rulesetId: string; ruleId: string; createdAt: number }[] } (newest first) | 401
// PUT /api/bookmarks    body { rulesetId, ruleId } → 200 {ok:true} | 400 | 401  (idempotent)
// DELETE /api/bookmarks body { rulesetId, ruleId } → 200 {ok:true} | 400 | 401  (idempotent)

// src/lib/bookmarks.svelte.ts — module-level singleton, Svelte 5 runes class
export const bookmarks: {
	readonly enabled: boolean; // true once a signed-in load() succeeds
	load(): Promise<void>; // GET; silently no-ops on 401/network error
	reset(): void; // sign-out
	has(rulesetId: string, ruleId: string): boolean;
	toggle(rulesetId: string, ruleId: string): Promise<void>; // optimistic; reverts on failure
};
```

- [ ] **Step 1: Failing e2e** — create `e2e/bookmarks.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('signed out: no bookmark buttons in the explorer', async ({ page }) => {
	await page.goto('/rules/usau-official-2026-27/15');
	await expect(page.locator('article a[href="#15.A"]')).toBeVisible();
	await expect(page.getByRole('button', { name: /bookmark rule/i })).toHaveCount(0);
});

test('signed in: bookmark a rule, it persists across reload and via the API', async ({ page }) => {
	await signUpTestUser(page, 'marks');
	await page.goto('/rules/usau-official-2026-27/15');
	const button = page.getByRole('button', { name: /bookmark rule 15\.A$/i });
	await page.locator('article a[href="#15.A"]').hover();
	await button.click();
	await expect(page.getByRole('button', { name: /remove bookmark for rule 15\.A$/i })).toBeVisible();

	const res = await page.request.get('/api/bookmarks');
	expect(res.ok()).toBeTruthy();
	const { bookmarks } = (await res.json()) as { bookmarks: { ruleId: string }[] };
	expect(bookmarks.map((b) => b.ruleId)).toContain('15.A');

	await page.reload();
	await expect(page.getByRole('button', { name: /remove bookmark for rule 15\.A$/i })).toBeVisible();
	await page.getByRole('button', { name: /remove bookmark for rule 15\.A$/i }).click();
	await expect(page.getByRole('button', { name: /^bookmark rule 15\.A$/i })).toBeVisible();
});
```

Run `npm run test:e2e -- bookmarks` → first PASSES vacuously, second FAILS.

- [ ] **Step 2: API endpoint** — create `src/routes/api/bookmarks/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getManifest } from '$lib/content/manifests';
import { sectionSlugForRuleId } from '$lib/content/rule-ids';
import { bookmarks } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

const BodySchema = z.object({
	rulesetId: z.string().min(1).max(64),
	ruleId: z.string().min(1).max(64)
});

/** Shape-level validation: the ruleset must exist and the rule id must map to one of its sections. */
function validateTarget(rulesetId: string, ruleId: string): void {
	let manifest;
	try {
		manifest = getManifest(rulesetId);
	} catch {
		error(400, 'unknown ruleset');
	}
	const slug = sectionSlugForRuleId(ruleId);
	if (!slug || !manifest.sections.some((s) => s.slug === slug)) error(400, 'unknown rule id');
}

async function parseBody(request: Request) {
	const parsed = BodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid bookmark payload');
	return parsed.data;
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const rows = await event.locals.db
		.select({
			rulesetId: bookmarks.rulesetId,
			ruleId: bookmarks.ruleId,
			createdAt: bookmarks.createdAt
		})
		.from(bookmarks)
		.where(eq(bookmarks.userId, user.id))
		.orderBy(desc(bookmarks.createdAt));
	return json({ bookmarks: rows });
};

export const PUT: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { rulesetId, ruleId } = await parseBody(event.request);
	validateTarget(rulesetId, ruleId);
	await event.locals.db
		.insert(bookmarks)
		.values({ userId: user.id, rulesetId, ruleId, createdAt: Date.now() })
		.onConflictDoNothing();
	return json({ ok: true });
};

export const DELETE: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { rulesetId, ruleId } = await parseBody(event.request);
	await event.locals.db
		.delete(bookmarks)
		.where(
			and(
				eq(bookmarks.userId, user.id),
				eq(bookmarks.rulesetId, rulesetId),
				eq(bookmarks.ruleId, ruleId)
			)
		);
	return json({ ok: true });
};
```

- [ ] **Step 3: Client store** — create `src/lib/bookmarks.svelte.ts`:

```ts
/** Signed-in bookmark state for the explorer. Optimistic toggles, silent degradation. */
class BookmarksState {
	enabled = $state(false);
	#keys = $state<ReadonlySet<string>>(new Set());

	#key(rulesetId: string, ruleId: string): string {
		return `${rulesetId}::${ruleId}`;
	}

	async load(): Promise<void> {
		let res: Response;
		try {
			res = await fetch('/api/bookmarks');
		} catch {
			return;
		}
		if (!res.ok) return; // 401 → stay disabled
		const data = (await res.json().catch(() => null)) as {
			bookmarks?: { rulesetId: string; ruleId: string }[];
		} | null;
		if (!data?.bookmarks) return;
		this.#keys = new Set(data.bookmarks.map((b) => this.#key(b.rulesetId, b.ruleId)));
		this.enabled = true;
	}

	reset(): void {
		this.enabled = false;
		this.#keys = new Set();
	}

	has(rulesetId: string, ruleId: string): boolean {
		return this.#keys.has(this.#key(rulesetId, ruleId));
	}

	async toggle(rulesetId: string, ruleId: string): Promise<void> {
		const key = this.#key(rulesetId, ruleId);
		const had = this.#keys.has(key);
		const next = new Set(this.#keys);
		if (had) next.delete(key);
		else next.add(key);
		this.#keys = next; // optimistic
		try {
			const res = await fetch('/api/bookmarks', {
				method: had ? 'DELETE' : 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rulesetId, ruleId })
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			const revert = new Set(this.#keys);
			if (had) revert.add(key);
			else revert.delete(key);
			this.#keys = revert;
		}
	}
}

export const bookmarks = new BookmarksState();
```

- [ ] **Step 4: Layout wiring.** In the Task 7 session subscription in `src/routes/+layout.svelte`, add bookmark lifecycle (import `{ bookmarks } from '$lib/bookmarks.svelte'`):

```ts
if (signedIn && !wasSignedIn) {
	void flushOutbox();
	void hydrateFromServer(DEFAULT_RULESET_ID);
	void bookmarks.load();
}
if (!signedIn && wasSignedIn) bookmarks.reset();
```

- [ ] **Step 5: RuleNode toggle.** In `RuleNode.svelte` add the prop and button; thread `rulesetId` through the recursion:

```svelte
<script lang="ts">
	import type { RuleNode as TRuleNode } from '$lib/content/types';
	import RuleNode from './RuleNode.svelte';
	import { bookmarks } from '$lib/bookmarks.svelte';
	let {
		node,
		depth = 0,
		rulesetId
	}: { node: TRuleNode; depth?: number; rulesetId: string } = $props();
	const marked = $derived(bookmarks.has(rulesetId, node.id));
</script>
```

In the `.group` row, after the label `<a>` insert:

```svelte
{#if bookmarks.enabled}
	<button
		type="button"
		aria-pressed={marked}
		aria-label="{marked ? 'Remove bookmark for' : 'Bookmark'} rule {node.id}"
		onclick={() => bookmarks.toggle(rulesetId, node.id)}
		class="shrink-0 self-center transition-opacity {marked
			? 'text-cardinal opacity-100'
			: 'text-navy/30 opacity-0 group-hover:opacity-100 hover:text-cardinal focus-visible:opacity-100'}"
	>
		<svg aria-hidden="true" class="h-4 w-4" viewBox="0 -960 960 960" fill="currentColor">
			{#if marked}
				<path d="M200-120v-640q0-33 23.5-56.5T280-840h400q33 0 56.5 23.5T760-760v640L480-240 200-120Z" />
			{:else}
				<path d="M200-120v-640q0-33 23.5-56.5T280-840h400q33 0 56.5 23.5T760-760v640L480-240 200-120Zm80-122 200-86 200 86v-518H280v518Z" />
			{/if}
		</svg>
	</button>
{/if}
```

Update the recursive call: `<RuleNode node={child} depth={depth + 1} {rulesetId} />`. In `src/routes/rules/[ruleset]/[section]/+page.svelte` change the call to `<RuleNode node={rule} rulesetId={data.manifest.id} />`.

- [ ] **Step 6: Verify** — `npm run check` passes (svelte-check is strict about required props — the section page is RuleNode's only consumer). `npm run test:e2e -- bookmarks` → both PASS. `npm run test:e2e -- explorer` → explorer suite still green (signed-out DOM unchanged: the button subtree renders only when `bookmarks.enabled`).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: rule bookmarks — API, optimistic explorer toggle"
```

---

### Task 10: Dashboard `/me`

**Files:**
- Create: `src/lib/quiz/mastery-ui.ts` (extract shared level styles/labels)
- Modify: `src/routes/quiz/mastery/+page.svelte` (import instead of local consts)
- Create: `src/routes/me/+page.server.ts`
- Create: `src/routes/me/+page.svelte`
- Create: `e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: `computeSectionMastery`/`MASTERY_WINDOW` (`$lib/quiz/mastery` — pure, runs server-side), `getManifest`, `questionCountsBySection` (`$lib/quiz/bank`), `sectionSlugForRuleId`, schema tables, `DIFFICULTY_LABELS` not needed. Session via `locals.auth.api.getSession`.
- Produces (exact):

```ts
// src/lib/quiz/mastery-ui.ts (moved verbatim from the mastery page)
export const LEVEL_STYLES: Record<MasteryLevel, string>;
export const LEVEL_LABELS: Record<MasteryLevel, string>;

// /me PageData (returned by +page.server.ts load)
{
	user: { name: string; email: string; image: string | null };
	rulesetId: string;
	attempts: { id: string; mode: 'quick' | 'mastery' | 'timed'; sectionTitle: string | null;
	            score: number; total: number; durationS: number; createdAt: number }[]; // newest first, ≤20
	mastery: { sectionSlug: string; number: string | null; title: string;
	           level: MasteryLevel; recentPct: number; attempts: number }[]; // sections with questions, manifest order
	timedBest: { score: number; bestStreak: number; at: number } | null;
	bookmarks: { rulesetId: string; ruleId: string; sectionSlug: string | null; sectionTitle: string | null; createdAt: number }[];
}
```

- [ ] **Step 1: Extract mastery UI consts.** Create `src/lib/quiz/mastery-ui.ts` with the `LEVEL_STYLES` and `LEVEL_LABELS` objects moved VERBATIM from `src/routes/quiz/mastery/+page.svelte` (typed `Record<MasteryLevel, string>`, importing `MasteryLevel` from `./mastery`), and change the mastery page to import them. `npm run check` + `npm run test:e2e -- quiz` still green.

- [ ] **Step 2: Failing e2e** — create `e2e/dashboard.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

test('signed out, /me redirects home', async ({ page }) => {
	await page.goto('/me');
	await expect(page).toHaveURL(/\/$/);
});

test('dashboard shows attempts, mastery, timed best placeholder and bookmarks', async ({
	page
}) => {
	await signUpTestUser(page, 'dash');
	// seed one attempt through the real quiz flow
	await page.goto('/quiz/quick');
	await page.getByRole('button', { name: /start quiz/i }).click();
	for (let i = 0; i < 10; i++) {
		await page.getByTestId('choice').first().click();
		await page.getByRole('button', { name: /next question|see results/i }).click();
	}
	await expect(page.getByText(/% correct/)).toBeVisible();
	// seed a bookmark via the API
	const put = await page.request.put('/api/bookmarks', {
		data: { rulesetId: 'usau-official-2026-27', ruleId: '15.A' }
	});
	expect(put.ok()).toBeTruthy();
	// wait for the attempt to flush, then load the dashboard
	await expect
		.poll(async () => {
			const res = await page.request.get('/api/sync');
			return res.ok() ? ((await res.json()) as { responses: unknown[] }).responses.length : -1;
		})
		.toBe(10);

	await page.goto('/me');
	await expect(page.getByRole('heading', { name: /your perspective/i })).toBeVisible();
	await expect(page.getByText(/quick quiz/i).first()).toBeVisible(); // attempt row
	await expect(page.getByText('15.A')).toBeVisible(); // bookmark row
	await expect(page.getByText(/no timed runs yet/i)).toBeVisible();

	// remove the bookmark from the dashboard
	await page.getByRole('button', { name: /remove bookmark 15\.A/i }).click();
	await expect(page.getByText('15.A')).not.toBeVisible();
});
```

Run `npm run test:e2e -- dashboard` → FAIL (no /me route).

- [ ] **Step 3: Server load** — create `src/routes/me/+page.server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { getManifest } from '$lib/content/manifests';
import { sectionSlugForRuleId } from '$lib/content/rule-ids';
import { questionCountsBySection } from '$lib/quiz/bank';
import { computeSectionMastery } from '$lib/quiz/mastery';
import { bookmarks, questionResponses, quizAttempts } from '$lib/server/db/schema';

export const prerender = false;

const MAX_RESPONSES = 2000;

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
	if (!session) redirect(303, '/');
	const userId = session.user.id;
	const db = event.locals.db;
	const rulesetId = DEFAULT_RULESET_ID;
	const manifest = getManifest(rulesetId);
	const sectionBySlug = new Map(manifest.sections.map((s) => [s.slug, s]));

	const [attemptRows, responseRows, bestRows, bookmarkRows] = await Promise.all([
		db
			.select()
			.from(quizAttempts)
			.where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.rulesetId, rulesetId)))
			.orderBy(desc(quizAttempts.createdAt))
			.limit(20),
		db
			.select({
				questionId: questionResponses.questionId,
				sectionSlug: questionResponses.sectionSlug,
				correct: questionResponses.correct,
				at: questionResponses.at
			})
			.from(questionResponses)
			.where(
				and(eq(questionResponses.userId, userId), eq(questionResponses.rulesetId, rulesetId))
			)
			.orderBy(desc(questionResponses.at), desc(questionResponses.id))
			.limit(MAX_RESPONSES),
		db
			.select({
				score: quizAttempts.score,
				bestStreak: quizAttempts.bestStreak,
				createdAt: quizAttempts.createdAt
			})
			.from(quizAttempts)
			.where(
				and(
					eq(quizAttempts.userId, userId),
					eq(quizAttempts.rulesetId, rulesetId),
					eq(quizAttempts.mode, 'timed')
				)
			)
			.orderBy(desc(quizAttempts.score), desc(quizAttempts.bestStreak))
			.limit(1),
		db
			.select({
				rulesetId: bookmarks.rulesetId,
				ruleId: bookmarks.ruleId,
				createdAt: bookmarks.createdAt
			})
			.from(bookmarks)
			.where(eq(bookmarks.userId, userId))
			.orderBy(desc(bookmarks.createdAt))
	]);

	const responses = responseRows.reverse(); // chronological for computeSectionMastery
	const counts = questionCountsBySection(rulesetId);
	const mastery = manifest.sections
		.filter((s) => (counts.get(s.slug) ?? 0) > 0)
		.map((s) => {
			const m = computeSectionMastery(responses, s.slug);
			return {
				sectionSlug: s.slug,
				number: s.number,
				title: s.title,
				level: m.level,
				recentPct: m.recentPct,
				attempts: m.attempts
			};
		});

	const best = bestRows[0];
	return {
		user: {
			name: session.user.name,
			email: session.user.email,
			image: session.user.image ?? null
		},
		rulesetId,
		attempts: attemptRows.map((a) => ({
			id: a.id,
			mode: a.mode,
			sectionTitle: a.sectionSlug ? (sectionBySlug.get(a.sectionSlug)?.title ?? null) : null,
			score: a.score,
			total: a.total,
			durationS: a.durationS,
			createdAt: a.createdAt
		})),
		mastery,
		timedBest: best
			? { score: best.score, bestStreak: best.bestStreak ?? 0, at: best.createdAt }
			: null,
		bookmarks: bookmarkRows.map((b) => {
			const slug = sectionSlugForRuleId(b.ruleId);
			return {
				...b,
				sectionSlug: slug,
				sectionTitle: slug ? (sectionBySlug.get(slug)?.title ?? null) : null
			};
		})
	};
};
```

- [ ] **Step 4: Page** — create `src/routes/me/+page.svelte` (navy shell + white cards, matching the quiz hub's visual language; dates formatted with a fixed `toISOString().slice(0, 10)` so SSR and hydration agree):

```svelte
<script lang="ts">
	import Chip from '$lib/components/Chip.svelte';
	import { LEVEL_LABELS, LEVEL_STYLES } from '$lib/quiz/mastery-ui';
	let { data } = $props();

	const MODE_LABELS = { quick: 'Quick quiz', mastery: 'Section mastery', timed: 'Timed challenge' };
	let marks = $state(data.bookmarks);

	const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
	const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

	async function removeBookmark(rulesetId: string, ruleId: string) {
		const prev = marks;
		marks = marks.filter((b) => !(b.rulesetId === rulesetId && b.ruleId === ruleId));
		try {
			const res = await fetch('/api/bookmarks', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rulesetId, ruleId })
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			marks = prev;
		}
	}
</script>

<svelte:head><title>Dashboard · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-6xl px-4 py-10 sm:px-6">
	<Chip>Dashboard</Chip>
	<h1 class="display mt-3 text-4xl text-white sm:text-5xl">Your perspective.</h1>
	<p class="mt-2 text-sm text-white/60">{data.user.name} · {data.user.email}</p>

	<div class="mt-8 grid gap-4 lg:grid-cols-3">
		<div class="rounded-xl bg-white p-6 text-navy">
			<h2 class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">Timed best</h2>
			{#if data.timedBest}
				<p class="display mt-2 text-5xl">{data.timedBest.score}</p>
				<p class="mt-1 text-sm text-navy/70">
					correct in sixty seconds · streak {data.timedBest.bestStreak} · {day(data.timedBest.at)}
				</p>
			{:else}
				<p class="mt-2 text-sm text-navy/60">No timed runs yet.</p>
			{/if}
			<a
				href="/quiz/timed"
				class="mt-4 inline-block rounded-full bg-cardinal px-5 py-2 text-xs font-semibold tracking-wider text-white uppercase hover:brightness-110"
			>
				{data.timedBest ? 'Beat it' : 'Run the clock'}
			</a>
		</div>

		<div class="rounded-xl bg-white p-6 text-navy lg:col-span-2">
			<h2 class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">
				Recent attempts
			</h2>
			{#if data.attempts.length === 0}
				<p class="mt-2 text-sm text-navy/60">
					Nothing yet — finish a quiz and it lands here automatically.
				</p>
			{:else}
				<ul class="mt-3 divide-y divide-mist">
					{#each data.attempts as attempt (attempt.id)}
						<li class="flex items-baseline justify-between gap-3 py-2 text-sm">
							<span class="font-semibold">
								{MODE_LABELS[attempt.mode]}{#if attempt.sectionTitle}
									<span class="font-normal text-navy/60">· {attempt.sectionTitle}</span>{/if}
							</span>
							<span class="shrink-0 font-mono text-navy/80">
								{attempt.score}/{attempt.total} · {mmss(attempt.durationS)} · {day(
									attempt.createdAt
								)}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<h2 class="mt-10 text-xs font-semibold tracking-[0.18em] text-white/50 uppercase">
		Section mastery
	</h2>
	<div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each data.mastery as m (m.sectionSlug)}
			<a
				href="/quiz/mastery?section={m.sectionSlug}"
				class="rounded-xl border p-4 transition-transform hover:-translate-y-0.5 {LEVEL_STYLES[
					m.level
				]}"
			>
				<p class="font-mono text-xs text-cardinal">{m.number}.</p>
				<p class="display mt-1 text-xl">{m.title}</p>
				<p class="mt-2 text-xs tracking-wider uppercase opacity-80">
					{LEVEL_LABELS[m.level]}{#if m.attempts > 0}&nbsp;· {m.recentPct}% recent{/if}
				</p>
			</a>
		{/each}
	</div>

	<h2 class="mt-10 text-xs font-semibold tracking-[0.18em] text-white/50 uppercase">Bookmarks</h2>
	{#if marks.length === 0}
		<p class="mt-3 text-sm text-white/60">
			Pin rules while reading — the bookmark button appears next to each rule in the
			<a href="/rules" class="text-white underline hover:text-cardinal">explorer</a>.
		</p>
	{:else}
		<ul class="mt-3 grid gap-2 sm:grid-cols-2">
			{#each marks as mark (mark.rulesetId + mark.ruleId)}
				<li class="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-navy">
					<a
						href="/rules/{mark.rulesetId}/{mark.sectionSlug}#{mark.ruleId}"
						class="min-w-0 font-mono text-sm font-semibold text-cardinal hover:underline"
					>
						{mark.ruleId}
						{#if mark.sectionTitle}<span class="ml-2 font-sans font-normal text-navy/60"
								>{mark.sectionTitle}</span
							>{/if}
					</a>
					<button
						type="button"
						aria-label="Remove bookmark {mark.ruleId}"
						onclick={() => removeBookmark(mark.rulesetId, mark.ruleId)}
						class="shrink-0 text-navy/40 hover:text-cardinal"
					>
						<svg aria-hidden="true" class="h-4 w-4" viewBox="0 -960 960 960" fill="currentColor">
							<path
								d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
							/>
						</svg>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
```

(Check `Chip.svelte`'s actual props/slot API before using it — match how the landing page renders its chip. If it takes children, `<Chip>Dashboard</Chip>` as above; otherwise adapt.)

- [ ] **Step 5: Verify** — `npm run check` passes. `npm run build` succeeds (proves `/me` being non-prerenderable doesn't break the crawl — the nav's `/me` link only renders client-side for signed-in users anyway). `npm run test:e2e -- dashboard` → both PASS. Full `npm run test:e2e` green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: /me dashboard — attempts, mastery grid, timed best, bookmarks"
```

---

### Task 11: CI, README, full-suite verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:** none — infrastructure and docs.

- [ ] **Step 1: CI dev vars.** In `.github/workflows/ci.yml`, add one step immediately after `- run: npm run build` (before playwright install):

```yaml
      - run: cp .dev.vars.example .dev.vars
```

(The playwright webServer already applies local migrations; `.dev.vars.example` carries only dummy values and `ALLOW_TEST_SIGNIN=1`, so CI e2e gets auth without any secret.)

- [ ] **Step 2: README.** Update `README.md`:
- Feature list: accounts (Google sign-in), synced progress/mastery/timed bests, bookmarks, `/me` dashboard; note that everything except AI features still works signed-out.
- Dev setup: `cp .dev.vars.example .dev.vars`, `npm run db:migrate:local` before first `npm run dev`; new scripts table entries for `db:generate` / `db:migrate:local` / `db:migrate:remote`.
- Architecture note: local-first persistence (localStorage cache + background D1 sync), server-validated timed runs, prerendered pages + dynamic `/me` and `/api/*`.
- Deployment summary pointing at wrangler (D1 create, migrations remote, secrets, deploy) without reproducing secret values.

- [ ] **Step 3: Full verification suite** (all must pass; fix anything that doesn't):

```bash
npm run check
npm run check:scripts
npm run test
npm run validate:content
npx prettier --check .
npm run build
npm run test:e2e
```

Also confirm: `git grep -n "usau-official-2026-27" -- src ':!src/lib/content/config.ts'` → no hits (e2e files excepted), and `git status` shows no untracked runtime artifacts (`.dev.vars` ignored, `.wrangler/` ignored).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: CI dev-vars for e2e auth + Phase 3 README"
```

---

### Task 12: CHECKPOINT — Cloudflare deployment (user-run)

**This task is NOT for a subagent.** The controller (Fable) walks the user through it; the user runs every authenticated command. Task 4 (Google credentials) must be complete first.

- [ ] **Step 1: Login + create the database** (user runs):

```bash
npx wrangler login
npx wrangler d1 create best-perspective-db
```

User pastes the printed `database_id` (not a secret) to the controller → controller updates `wrangler.jsonc` and commits (`chore: real D1 database id`).

- [ ] **Step 2: Remote migrations** (user runs): `npm run db:migrate:remote` → all migrations applied.

- [ ] **Step 3: Secrets** (user runs; values never enter the chat):

```bash
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID      # PROD OAuth client id (not the dev client's)
npx wrangler secret put GOOGLE_CLIENT_SECRET  # PROD OAuth client secret
```

Do NOT set `ALLOW_TEST_SIGNIN` in production.

- [ ] **Step 4: Custom domain + vars.** Production domain is `https://usaurules.com` (user-provided; its zone must exist on the user's Cloudflare account — user adds the site in the Cloudflare dashboard first if needed). Controller adds to `wrangler.jsonc` and commits:

```jsonc
"routes": [{ "pattern": "usaurules.com", "custom_domain": true }],
"vars": { "BETTER_AUTH_URL": "https://usaurules.com" }
```

- [ ] **Step 5: Deploy** (user runs): `npm run build && npx wrangler deploy` → wrangler provisions the custom domain. Confirm the PROD Google OAuth client lists origin `https://usaurules.com` and redirect URI `https://usaurules.com/api/auth/callback/google` (created at Task 4's two-client split); if missing, add them now.

- [ ] **Step 6: Production smoke test** (user + controller): visit the prod URL → read a rule; sign in with Google; complete a quick quiz; check `/me` shows the attempt; bookmark a rule; run a timed challenge; confirm `/api/auth/sign-up/email` returns an error (test sign-in disabled). Record results in the progress ledger.

- [ ] **Step 7:** Update the ledger; proceed to the final whole-branch review and squash-merge.
