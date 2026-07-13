# Timed-Challenge Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public all-time top-10 leaderboard for the timed challenge with opt-in unique display names, per the approved spec `docs/superpowers/specs/2026-07-13-leaderboard-design.md`.

**Architecture:** Live query, no new tables beyond a `display_name` column on `user` (Approach 1): `GET /api/leaderboard` runs one window-function query over `quiz_attempts` joined to opted-in users. Display names are managed via `PUT /api/profile/display-name` with server-side validation (charset + `obscenity` profanity screen) and case-insensitive uniqueness (unique index on `lower(display_name)`; one-click path auto-resolves conflicts with numeric suffixes). UI: a public prerendered `/leaderboard` page (classic-table layout), one quiet claim/manage line in the existing "Timed best" dashboard card, and a one-line dismissable nudge on the timed results screen. Integrity rider: `RunClaims` gains `rulesetId`.

**Tech Stack:** Existing stack (SvelteKit/Svelte 5, TS, Tailwind v4, Zod 4, Drizzle/D1, Vitest, Playwright) + `obscenity` (new npm dependency, pure TS, Workers-compatible).

**Spec:** `docs/superpowers/specs/2026-07-13-leaderboard-design.md`. Conventions: `docs/superpowers/plans/2026-07-11-phase4-ai.md`. Ledger: `.superpowers/sdd/progress.md`.

## Global Constraints

- Node 22, npm, TypeScript. Latest installed deps win over plan snippets (note deviations).
- Palette (exact): navy `#1C3557`, deep `#12233C`, cardinal `#B41F3A` (CTAs/accents/links), mist `#F0F1F3`, turf `#2f7d52` (correct-states ONLY). `.display` type, white `rounded-xl` cards, chip labels.
- **HARD:** all prerendered routes stay prerendered. `/leaderboard` is a prerendered shell with client fetches. `/api/leaderboard` and `/api/profile/*` are under `/api/` — already covered by the hooks dynamic gate; do NOT touch `src/hooks.server.ts`.
- **HARD:** the leaderboard endpoint exposes ONLY: display name, score, bestStreak, attempt timestamp, rank — never emails, Google names, avatars, or user ids.
- **HARD (user-validated UI):** classic-table layout on `/leaderboard`; NO new dashboard card (one line inside the existing "Timed best" card); results nudge is a single quiet line, not a boxed callout; claim microcopy is exactly `join as “<suggestion>” or use another name` with the word **or** in full-strength bold navy (non-clickable) between two cardinal links.
- Display names: trim; 2–30 chars; allowed chars letters (any case), digits, spaces, `.`, `'`, `-`; profanity screened with `obscenity` (english preset); uniqueness is case-insensitive; `resolveConflict: true` appends the first free numeric suffix (`Base 2`, `Base 3`, …).
- Signed-out UX: `/leaderboard` fully works (board, no `me` row); nothing else changes signed-out.
- Ruleset id `usau-official-2026-27` never hardcoded outside `src/lib/content/config.ts` (tests excepted). The leaderboard is ruleset-scoped via `DEFAULT_RULESET_ID`.
- D1 schema via `npx drizzle-kit generate --name <descriptive>`; applied local; remote is user-run at the checkpoint. Prettier-format generated `drizzle/meta` JSON (repo precedent).
- Subagents run ONLY local commands — never `wrangler login/deploy/secret`, never `--remote`.
- e2e conventions: `await page.waitForLoadState('networkidle')` before first interaction on freshly-loaded pages; helpers in `e2e/helpers.ts` (`signUpTestUser`). Current suite: 152 unit + 41 e2e — keep green.
- Commit after every task (conventional commits), ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Branch: `feature/leaderboard` (created before Task 1); squash-merge at the end.

---

### Task 1: Schema — `user.display_name` + case-insensitive unique index

**Files:**
- Modify: `src/lib/server/db/schema.ts` (user table)
- Create: `drizzle/<n>_display-name.sql` (generated, committed)

**Interfaces:**
- Produces: `user.displayName` (`string | null`) readable via the existing `user` export.

- [ ] **Step 1: Column + index.** In `src/lib/server/db/schema.ts`, the `user` table is currently defined without a config callback. Add `displayName` after `image` and add the table-level index callback:

```ts
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable(
	'user',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull().unique(),
		emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
		image: text('image'),
		// Public leaderboard identity. NULL = not on the board. Uniqueness is
		// case-insensitive via the expression index below.
		displayName: text('display_name'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [uniqueIndex('user_display_name_lower_idx').on(sql`lower(${table.displayName})`)]
);
```

(Only the `displayName` field, the second config argument, and the `uniqueIndex` import are new — keep every existing field byte-identical.)

- [ ] **Step 2: Generate + apply**

```bash
npx drizzle-kit generate --name display-name
npm run db:migrate:local
npx wrangler d1 execute usau-rules-website-db --local --command "select sql from sqlite_master where name='user_display_name_lower_idx'"
```

Expected: one new migration adding the column and `CREATE UNIQUE INDEX \`user_display_name_lower_idx\` ON \`user\` (lower("display_name"))` (exact quoting may vary). If drizzle-kit cannot express the lower() index (older kit versions emit it fine; verify), STOP and report BLOCKED rather than hand-editing the migration.

Sanity-check the semantics directly:

```bash
npx wrangler d1 execute usau-rules-website-db --local --command "insert into user (id, name, email, display_name, created_at, updated_at) values ('t1','T','t1@x.com','Cameron J.',0,0)"
npx wrangler d1 execute usau-rules-website-db --local --command "insert into user (id, name, email, display_name, created_at, updated_at) values ('t2','T','t2@x.com','cameron j.',0,0)"
```

Expected: the second insert FAILS with a UNIQUE constraint error. Then clean up:

```bash
npx wrangler d1 execute usau-rules-website-db --local --command "delete from user where id in ('t1','t2')"
```

- [ ] **Step 3: Verify** — `npm run check && npm run test && npx prettier --check .` pass (format `drizzle/meta` if needed).

- [ ] **Step 4: Commit** — `git add -A ':!.claude' && git commit -m "feat: user display_name column with case-insensitive unique index"`

---

### Task 2: `RunClaims` binds `rulesetId`

**Files:**
- Modify: `src/lib/server/quiz/run-token.ts`
- Modify: `src/lib/server/quiz/run-token.test.ts`
- Modify: `src/routes/api/timed/start/+server.ts`
- Modify: `src/routes/api/timed/finish/+server.ts`
- Modify: `src/lib/quiz/sync.ts` (`beginTimedRun`)
- Modify: `src/routes/quiz/timed/+page.svelte` (pass rulesetId)

**Interfaces:**
- Consumes: existing `mintRunToken`/`verifyRunToken`, `DEFAULT_RULESET_ID`.
- Produces: `RunClaims` now `{ userId: string; runId: string; startedAt: number; rulesetId: string }`; `beginTimedRun(rulesetId: string): Promise<string | null>`.

- [ ] **Step 1: Failing tests.** In `src/lib/server/quiz/run-token.test.ts`, add (matching the file's existing import/style conventions):

```ts
it('round-trips rulesetId in the claims', async () => {
	const token = await mintRunToken(
		{ userId: 'u1', runId: 'r1', startedAt: 123, rulesetId: 'rs-a' },
		'secret'
	);
	const claims = await verifyRunToken(token, 'secret');
	expect(claims).toMatchObject({ rulesetId: 'rs-a' });
});

it('rejects legacy tokens without rulesetId', async () => {
	// A pre-upgrade token body (no rulesetId) must fail schema validation.
	const payload = btoa(JSON.stringify({ userId: 'u1', runId: 'r1', startedAt: 123 }));
	const legacy = await mintRunToken(
		{ userId: 'u1', runId: 'r1', startedAt: 123, rulesetId: 'x' },
		'secret'
	);
	const forged = `${payload}.${legacy.split('.')[1]}`;
	expect(await verifyRunToken(forged, 'secret')).toBeNull();
});
```

Run `npx vitest run src/lib/server/quiz/run-token` → FAIL (type error / missing field).

- [ ] **Step 2: Claims.** In `src/lib/server/quiz/run-token.ts` extend the interface and schema:

```ts
export interface RunClaims {
	userId: string;
	runId: string;
	startedAt: number;
	rulesetId: string;
}

const ClaimsSchema: z.ZodType<RunClaims> = z.object({
	userId: z.string().min(1),
	runId: z.string().min(1),
	startedAt: z.number().int().positive(),
	rulesetId: z.string().min(1)
});
```

Update the file's doc comment to mention rulesetId binding. Run the run-token tests → PASS.

- [ ] **Step 3: Start endpoint.** Replace `src/routes/api/timed/start/+server.ts` body handling:

```ts
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { mintRunToken } from '$lib/server/quiz/run-token';
import { requireUser } from '$lib/server/session';

const StartSchema = z.object({ rulesetId: z.string().min(1).max(64).optional() });

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const parsed = StartSchema.safeParse(await event.request.json().catch(() => ({})));
	const rulesetId = (parsed.success ? parsed.data.rulesetId : undefined) ?? DEFAULT_RULESET_ID;
	const token = await mintRunToken(
		{ userId: user.id, runId: crypto.randomUUID(), startedAt: Date.now(), rulesetId },
		event.platform!.env.BETTER_AUTH_SECRET
	);
	return json({ token });
};
```

- [ ] **Step 4: Finish endpoint.** In `src/routes/api/timed/finish/+server.ts`, directly after the existing `if (!claims || claims.userId !== user.id) error(400, 'invalid run token');` add:

```ts
	if (claims.rulesetId !== payload.rulesetId) error(400, 'run token bound to a different ruleset');
```

- [ ] **Step 5: Client.** In `src/lib/quiz/sync.ts` change `beginTimedRun`:

```ts
/** Requests a signed run token; null when signed out/offline (run stays local-only). */
export async function beginTimedRun(rulesetId: string): Promise<string | null> {
	try {
		const res = await fetch('/api/timed/start', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ rulesetId })
		});
		if (!res.ok) return null;
		const data = (await res.json().catch(() => null)) as { token?: string } | null;
		return data?.token ?? null;
	} catch {
		return null;
	}
}
```

In `src/routes/quiz/timed/+page.svelte`, update the call site to `beginTimedRun(DEFAULT_RULESET_ID)` (find the single `beginTimedRun(` occurrence). Update any `beginTimedRun` mocks/tests in `src/lib/quiz/sync.test.ts` if they call it without an argument (adjust minimally).

- [ ] **Step 6: Verify** — `npm run test && npm run check && npx prettier --check .` pass. Then `npm run test:e2e -- timed-sync` → the timed e2e still passes (it exercises start+finish end-to-end).

- [ ] **Step 7: Commit** — `git add -A ':!.claude' && git commit -m "feat: bind rulesetId into timed run tokens"`

---

### Task 3: Display-name domain module — validation, profanity, suggestion, suffix resolution

**Files:**
- Modify: `package.json` (add `obscenity`)
- Create: `src/lib/server/profile/display-name.ts`
- Test: `src/lib/server/profile/display-name.test.ts`

**Interfaces:**
- Produces (exact — Tasks 4 depends on these):

```ts
export function validateDisplayName(raw: string): { ok: true; name: string } | { ok: false; reason: string };
// trims; enforces 2–30 chars and charset letters/digits/space/.'-; profanity-screens via obscenity
export function suggestDisplayName(fullName: string): string;
// "Cameron Johnson" -> "Cameron J.", "Cher" -> "Cher", "" -> "Player"
export async function resolveUniqueName(
	base: string,
	isTaken: (candidate: string) => Promise<boolean>
): Promise<string | null>;
// base if free, else "base 2", "base 3", ... up to 50; null when exhausted or base > 30 chars can't fit a suffix
```

- [ ] **Step 1: Install** — `npm install obscenity`

- [ ] **Step 2: Failing tests.** Create `src/lib/server/profile/display-name.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveUniqueName, suggestDisplayName, validateDisplayName } from './display-name';

describe('validateDisplayName', () => {
	it('accepts and trims a normal name', () => {
		expect(validateDisplayName('  Cameron J.  ')).toEqual({ ok: true, name: 'Cameron J.' });
		expect(validateDisplayName("O'Neil-Smith 7")).toEqual({ ok: true, name: "O'Neil-Smith 7" });
	});
	it('rejects too short, too long, and bad charset', () => {
		expect(validateDisplayName('C')).toMatchObject({ ok: false });
		expect(validateDisplayName('x'.repeat(31))).toMatchObject({ ok: false });
		expect(validateDisplayName('nope<script>')).toMatchObject({ ok: false });
		expect(validateDisplayName('emoji 🥏')).toMatchObject({ ok: false });
	});
	it('rejects profanity, including obfuscated variants', () => {
		expect(validateDisplayName('fuck')).toMatchObject({ ok: false });
		expect(validateDisplayName('FuuuCk this')).toMatchObject({ ok: false });
	});
});

describe('suggestDisplayName', () => {
	it('derives First L. from a two-part name', () => {
		expect(suggestDisplayName('Cameron Johnson')).toBe('Cameron J.');
		expect(suggestDisplayName('Ana Maria de Silva')).toBe('Ana S.');
	});
	it('falls back sensibly for single names and empties', () => {
		expect(suggestDisplayName('Cher')).toBe('Cher');
		expect(suggestDisplayName('  ')).toBe('Player');
	});
});

describe('resolveUniqueName', () => {
	const takenSet = (names: string[]) => async (c: string) =>
		names.some((n) => n.toLowerCase() === c.toLowerCase());
	it('returns the base when free', async () => {
		expect(await resolveUniqueName('Cameron J.', takenSet([]))).toBe('Cameron J.');
	});
	it('appends the first free numeric suffix, case-insensitively', async () => {
		expect(await resolveUniqueName('Cameron J.', takenSet(['cameron j.']))).toBe('Cameron J. 2');
		expect(
			await resolveUniqueName('Cameron J.', takenSet(['Cameron J.', 'Cameron J. 2']))
		).toBe('Cameron J. 3');
	});
	it('gives up after the cap', async () => {
		expect(await resolveUniqueName('X Y', async () => true)).toBeNull();
	});
});
```

Run `npx vitest run src/lib/server/profile` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/server/profile/display-name.ts`:

```ts
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

/** Leaderboard display-name rules (spec): trim; 2–30 chars; letters/digits/space/.'-; no profanity. */

const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers
});

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 30;
const CHARSET = /^[\p{L}\p{N} .'-]+$/u;

export function validateDisplayName(
	raw: string
): { ok: true; name: string } | { ok: false; reason: string } {
	const name = raw.trim().replace(/\s+/g, ' ');
	if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) {
		return { ok: false, reason: `use ${DISPLAY_NAME_MIN}–${DISPLAY_NAME_MAX} characters` };
	}
	if (!CHARSET.test(name)) {
		return { ok: false, reason: "letters, numbers, spaces, and . ' - only" };
	}
	if (matcher.hasMatch(name)) {
		return { ok: false, reason: 'that name isn’t allowed' };
	}
	return { ok: true, name };
}

/** "Cameron Johnson" → "Cameron J."; single names pass through; empty → "Player". */
export function suggestDisplayName(fullName: string): string {
	const parts = fullName.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return 'Player';
	if (parts.length === 1) return parts[0].slice(0, DISPLAY_NAME_MAX);
	const last = parts[parts.length - 1];
	return `${parts[0]} ${last[0].toUpperCase()}.`.slice(0, DISPLAY_NAME_MAX);
}

const SUFFIX_CAP = 50;

/** base if free, else "base 2" … "base 50"; null when exhausted or a suffixed candidate can't fit. */
export async function resolveUniqueName(
	base: string,
	isTaken: (candidate: string) => Promise<boolean>
): Promise<string | null> {
	if (!(await isTaken(base))) return base;
	for (let n = 2; n <= SUFFIX_CAP; n++) {
		const candidate = `${base} ${n}`;
		if (candidate.length > DISPLAY_NAME_MAX) return null;
		if (!(await isTaken(candidate))) return candidate;
	}
	return null;
}
```

- [ ] **Step 4: Verify** — module tests PASS; `npm run test && npm run check && npx prettier --check .` pass. Confirm the obscenity import compiles under the worker build: `npm run build` succeeds.

- [ ] **Step 5: Commit** — `git add -A ':!.claude' && git commit -m "feat: display-name validation, suggestion, and unique-suffix resolution"`

---

### Task 4: Profile API — GET/PUT `/api/profile/display-name`

**Files:**
- Create: `src/lib/profile/payload.ts` (client-shared wire shapes)
- Test: `src/lib/profile/payload.test.ts`
- Create: `src/routes/api/profile/display-name/+server.ts`

**Interfaces:**
- Consumes: Task 3 module; `requireUser`; `user` table.
- Produces (exact — Tasks 6–8 depend on these):

```ts
// src/lib/profile/payload.ts
export interface DisplayNameState { displayName: string | null; suggestion: string; }
export const DisplayNameStateSchema: z.ZodType<DisplayNameState>;
export interface PutDisplayName { displayName: string | null; resolveConflict?: boolean; }
export const PutDisplayNameSchema: z.ZodType<PutDisplayName>;
```

- Endpoints: `GET /api/profile/display-name` → `200 DisplayNameState` | `401`; `PUT` body `PutDisplayName` → `200 {displayName}` | `400 {message}` | `409 {suggestion}` | `401`.

- [ ] **Step 1: Failing payload tests.** Create `src/lib/profile/payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DisplayNameStateSchema, PutDisplayNameSchema } from './payload';

describe('profile payload schemas', () => {
	it('accepts state and put shapes', () => {
		expect(
			DisplayNameStateSchema.safeParse({ displayName: null, suggestion: 'Cameron J.' }).success
		).toBe(true);
		expect(PutDisplayNameSchema.safeParse({ displayName: 'Cameron J.' }).success).toBe(true);
		expect(
			PutDisplayNameSchema.safeParse({ displayName: null, resolveConflict: true }).success
		).toBe(true);
	});
	it('rejects wrong types', () => {
		expect(PutDisplayNameSchema.safeParse({ displayName: 7 }).success).toBe(false);
		expect(PutDisplayNameSchema.safeParse({}).success).toBe(false);
	});
});
```

Run → FAIL. Then create `src/lib/profile/payload.ts`:

```ts
import { z } from 'zod';

/** Wire shapes shared by the dashboard/nudge UI and /api/profile/display-name. */

export interface DisplayNameState {
	displayName: string | null;
	suggestion: string;
}

export const DisplayNameStateSchema: z.ZodType<DisplayNameState> = z.object({
	displayName: z.string().nullable(),
	suggestion: z.string()
});

export interface PutDisplayName {
	displayName: string | null;
	resolveConflict?: boolean;
}

export const PutDisplayNameSchema: z.ZodType<PutDisplayName> = z.object({
	displayName: z.string().max(200).nullable(),
	resolveConflict: z.boolean().optional()
});
```

Run → PASS.

- [ ] **Step 2: Endpoint.** Create `src/routes/api/profile/display-name/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { PutDisplayNameSchema } from '$lib/profile/payload';
import {
	resolveUniqueName,
	suggestDisplayName,
	validateDisplayName
} from '$lib/server/profile/display-name';
import { user } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';
import type { Db } from '$lib/server/db';

async function isTakenBy(db: Db, candidate: string, ownUserId: string): Promise<boolean> {
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(sql`lower(${user.displayName}) = lower(${candidate})`)
		.limit(1);
	return rows.length > 0 && rows[0].id !== ownUserId;
}

export const GET: RequestHandler = async (event) => {
	const me = await requireUser(event);
	const rows = await event.locals.db
		.select({ displayName: user.displayName, name: user.name })
		.from(user)
		.where(eq(user.id, me.id))
		.limit(1);
	const row = rows[0];
	return json({
		displayName: row?.displayName ?? null,
		suggestion: suggestDisplayName(row?.name ?? '')
	});
};

export const PUT: RequestHandler = async (event) => {
	const me = await requireUser(event);
	const parsed = PutDisplayNameSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid display-name payload');
	const db = event.locals.db;

	if (parsed.data.displayName === null) {
		await db.update(user).set({ displayName: null }).where(eq(user.id, me.id));
		return json({ displayName: null });
	}

	const validated = validateDisplayName(parsed.data.displayName);
	if (!validated.ok) error(400, validated.reason);

	const taken = (candidate: string) => isTakenBy(db, candidate, me.id);
	let finalName = validated.name;
	if (await taken(finalName)) {
		const resolved = await resolveUniqueName(finalName, taken);
		if (!parsed.data.resolveConflict) {
			return json({ suggestion: resolved ?? undefined, message: 'that name is taken' }, { status: 409 });
		}
		if (!resolved) error(400, 'that name is taken — try another');
		finalName = resolved;
	}

	// The unique index is the backstop for set-set races: retry once with a re-resolve.
	try {
		await db.update(user).set({ displayName: finalName }).where(eq(user.id, me.id));
	} catch {
		const retry = await resolveUniqueName(validated.name, taken);
		if (!retry) error(409, 'that name is taken');
		finalName = retry;
		await db.update(user).set({ displayName: finalName }).where(eq(user.id, me.id));
	}
	return json({ displayName: finalName });
};
```

- [ ] **Step 3: Verify against a running worker.**

```bash
npm run build
npx wrangler dev --port 8787 &   # wait for ready
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/profile/display-name                      # 401
curl -s -c /tmp/lb-c1 -X POST http://127.0.0.1:8787/api/auth/sign-up/email -H 'content-type: application/json' -d '{"email":"lb-1@example.com","password":"test-password-123","name":"Casey Jordan"}' > /dev/null
curl -s -b /tmp/lb-c1 http://127.0.0.1:8787/api/profile/display-name                                          # {"displayName":null,"suggestion":"Casey J."}
curl -s -b /tmp/lb-c1 -X PUT http://127.0.0.1:8787/api/profile/display-name -H 'content-type: application/json' -d '{"displayName":"Casey J."}'   # {"displayName":"Casey J."}
curl -s -c /tmp/lb-c2 -X POST http://127.0.0.1:8787/api/auth/sign-up/email -H 'content-type: application/json' -d '{"email":"lb-2@example.com","password":"test-password-123","name":"Casey Johnson"}' > /dev/null
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/lb-c2 -X PUT http://127.0.0.1:8787/api/profile/display-name -H 'content-type: application/json' -d '{"displayName":"casey j."}'   # 409
curl -s -b /tmp/lb-c2 -X PUT http://127.0.0.1:8787/api/profile/display-name -H 'content-type: application/json' -d '{"displayName":"casey j.","resolveConflict":true}'             # {"displayName":"casey j. 2"}
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/lb-c2 -X PUT http://127.0.0.1:8787/api/profile/display-name -H 'content-type: application/json' -d '{"displayName":"fuck"}'        # 400
curl -s -b /tmp/lb-c2 -X PUT http://127.0.0.1:8787/api/profile/display-name -H 'content-type: application/json' -d '{"displayName":null}'                                           # {"displayName":null}
```

Kill the dev server after. All expected statuses/bodies must match.

- [ ] **Step 4: Full verify** — `npm run test && npm run check && npx prettier --check .` pass.

- [ ] **Step 5: Commit** — `git add -A ':!.claude' && git commit -m "feat: display-name profile API with conflict resolution"`

---

### Task 5: Leaderboard query + `GET /api/leaderboard`

**Files:**
- Create: `src/lib/leaderboard/payload.ts` (client-shared)
- Test: `src/lib/leaderboard/payload.test.ts`
- Create: `src/routes/api/leaderboard/+server.ts`

**Interfaces:**
- Consumes: `quizAttempts`/`user` schema; `DEFAULT_RULESET_ID`; optional session (via `event.locals.auth`, NOT `requireUser` — the route is public).
- Produces (exact — Tasks 6–8 depend on these):

```ts
// src/lib/leaderboard/payload.ts
export const LEADERBOARD_SIZE = 10;
export interface LeaderboardEntry { rank: number; displayName: string; score: number; bestStreak: number; at: number; }
export interface LeaderboardResponse { entries: LeaderboardEntry[]; me: LeaderboardEntry | null; }
export const LeaderboardResponseSchema: z.ZodType<LeaderboardResponse>;
```

- [ ] **Step 1: Payload module (test first).** Create `src/lib/leaderboard/payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LeaderboardResponseSchema } from './payload';

describe('LeaderboardResponseSchema', () => {
	const entry = { rank: 1, displayName: 'Sam K.', score: 124, bestStreak: 38, at: 1783950000000 };
	it('accepts a board with and without me', () => {
		expect(LeaderboardResponseSchema.safeParse({ entries: [entry], me: null }).success).toBe(true);
		expect(
			LeaderboardResponseSchema.safeParse({ entries: [], me: { ...entry, rank: 23 } }).success
		).toBe(true);
	});
	it('rejects malformed entries', () => {
		expect(
			LeaderboardResponseSchema.safeParse({ entries: [{ rank: 'x' }], me: null }).success
		).toBe(false);
	});
});
```

FAIL, then create `src/lib/leaderboard/payload.ts`:

```ts
import { z } from 'zod';

/** Wire shapes shared by /leaderboard, the timed nudge, and /api/leaderboard. */

export const LEADERBOARD_SIZE = 10;

export interface LeaderboardEntry {
	rank: number;
	displayName: string;
	score: number;
	bestStreak: number;
	at: number; // attempt createdAt, epoch ms
}

const EntrySchema = z.object({
	rank: z.number().int().positive(),
	displayName: z.string(),
	score: z.number().int(),
	bestStreak: z.number().int(),
	at: z.number()
});

export interface LeaderboardResponse {
	entries: LeaderboardEntry[];
	me: LeaderboardEntry | null;
}

export const LeaderboardResponseSchema: z.ZodType<LeaderboardResponse> = z.object({
	entries: z.array(EntrySchema),
	me: EntrySchema.nullable()
});
```

PASS.

- [ ] **Step 2: Endpoint.** Create `src/routes/api/leaderboard/+server.ts`. One CTE ranks every opted-in player's best run; top 10 plus the caller's own row come out of the same ranking, so ranks are always consistent:

```ts
import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { LEADERBOARD_SIZE } from '$lib/leaderboard/payload';

interface RankedRow {
	rank: number;
	display_name: string;
	score: number;
	best_streak: number;
	at: number;
	user_id: string;
}

export const GET: RequestHandler = async (event) => {
	// Public route: no requireUser. locals may be populated (hooks run for /api/*);
	// a session is optional and only used to find the caller's own row.
	const db = event.locals.db;
	const rulesetId = DEFAULT_RULESET_ID;

	// best = each opted-in user's single best timed run (score desc, streak desc,
	// earliest first); ranked = dense ranks over those bests.
	const ranked = await db.all<RankedRow>(sql`
		with best as (
			select
				qa.user_id,
				u.display_name,
				qa.score,
				qa.best_streak,
				qa.created_at as at,
				row_number() over (
					partition by qa.user_id
					order by qa.score desc, qa.best_streak desc, qa.created_at asc
				) as rn
			from quiz_attempts qa
			join user u on u.id = qa.user_id
			where qa.mode = 'timed' and qa.ruleset_id = ${rulesetId} and u.display_name is not null
		),
		ranked as (
			select
				user_id, display_name, score, best_streak, at,
				rank() over (order by score desc, best_streak desc, at asc) as rank
			from best where rn = 1
		)
		select rank, display_name, score, best_streak, at, user_id from ranked
		order by rank asc
	`);

	const toEntry = (r: RankedRow) => ({
		rank: r.rank,
		displayName: r.display_name,
		score: r.score,
		bestStreak: r.best_streak,
		at: r.at
	});

	let me: ReturnType<typeof toEntry> | null = null;
	if (event.locals.auth) {
		const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
		if (session) {
			const mine = ranked.find((r) => r.user_id === session.user.id);
			if (mine) me = toEntry(mine);
		}
	}

	return json({
		entries: ranked.slice(0, LEADERBOARD_SIZE).map(toEntry),
		me
	});
};
```

Note: `db.all(sql...)` is drizzle's raw-SQL escape hatch on D1 and returns snake_case columns as written. `user_id` never leaves the server — `toEntry` strips it.

- [ ] **Step 3: Verify against a running worker.** Seed two players + runs through the REAL endpoints (finish requires a valid token; use short runs):

```bash
npm run build
npx wrangler dev --port 8787 &   # wait for ready
# player 1: sign up, set name, start+finish a run with one correct answer
curl -s -c /tmp/lb-p1 -X POST http://127.0.0.1:8787/api/auth/sign-up/email -H 'content-type: application/json' -d '{"email":"lb-p1@example.com","password":"test-password-123","name":"Pat One"}' > /dev/null
curl -s -b /tmp/lb-p1 -X PUT http://127.0.0.1:8787/api/profile/display-name -H 'content-type: application/json' -d '{"displayName":"Pat O."}' > /dev/null
TOKEN=$(curl -s -b /tmp/lb-p1 -X POST http://127.0.0.1:8787/api/timed/start -H 'content-type: application/json' -d '{}' | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
sleep 2
# 15-01's answerIndex is in the committed bank; look it up so the response is CORRECT:
ANSWER=$(python3 -c "import json;qs=json.load(open('content/questions/usau-official-2026-27/15.json'));q=[x for x in qs if x['id']=='15-01'][0];print(q['answerIndex'])")
curl -s -b /tmp/lb-p1 -X POST http://127.0.0.1:8787/api/timed/finish -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\",\"rulesetId\":\"usau-official-2026-27\",\"responses\":[{\"questionId\":\"15-01\",\"choiceIndex\":$ANSWER}]}"
# expected: {"score":1,...} 201
# board signed-out: entries has Pat O. at rank 1, me null
curl -s http://127.0.0.1:8787/api/leaderboard
# board signed-in as p1: me present with rank 1
curl -s -b /tmp/lb-p1 http://127.0.0.1:8787/api/leaderboard
```

Verify the signed-out response contains NO email/user-id fields. Kill the dev server.

- [ ] **Step 4: Full verify** — `npm run test && npm run check && npx prettier --check .` pass.

- [ ] **Step 5: Commit** — `git add -A ':!.claude' && git commit -m "feat: public leaderboard endpoint — ranked best timed runs"`

---

### Task 6: `/leaderboard` page + entry links

**Files:**
- Create: `src/routes/leaderboard/+page.svelte`
- Modify: `src/routes/quiz/timed/+page.svelte` (intro link)
- Modify: `src/routes/quiz/+page.svelte` (line under the mode grid)

**Interfaces:**
- Consumes: `GET /api/leaderboard`, `LeaderboardResponseSchema`, `LEADERBOARD_SIZE`.

- [ ] **Step 1: Page.** Create `src/routes/leaderboard/+page.svelte` (prerendered shell — no load files; classic-table layout per the user-validated wireframe):

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import {
		LEADERBOARD_SIZE,
		LeaderboardResponseSchema,
		type LeaderboardResponse
	} from '$lib/leaderboard/payload';

	let board = $state<LeaderboardResponse | null>(null);
	let failed = $state(false);

	async function load() {
		failed = false;
		try {
			const res = await fetch('/api/leaderboard');
			const parsed = LeaderboardResponseSchema.safeParse(await res.json().catch(() => null));
			if (!res.ok || !parsed.success) {
				failed = true;
				return;
			}
			board = parsed.data;
		} catch {
			failed = true;
		}
	}

	onMount(() => {
		void load();
	});

	const dateLabel = (at: number) =>
		new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	const showMeRow = $derived(
		board?.me != null && !board.entries.some((e) => e.rank === board!.me!.rank && e.displayName === board!.me!.displayName)
	);
</script>

<svelte:head><title>Leaderboard · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<p class="text-xs font-semibold tracking-[0.18em] text-cardinal uppercase">Timed challenge</p>
	<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Leaderboard.</h1>
	<p class="mt-3 max-w-xl text-white/70">
		The {LEADERBOARD_SIZE} best five-minute runs, server-verified. One entry per player.
	</p>

	<div class="mt-8 rounded-xl bg-white p-4 text-navy sm:p-6">
		{#if failed}
			<div class="py-10 text-center">
				<p class="text-sm text-navy/60">Couldn’t load the leaderboard.</p>
				<button
					type="button"
					onclick={load}
					class="mt-4 rounded-full border border-navy/30 px-5 py-2 text-xs font-semibold tracking-wider uppercase hover:border-navy"
				>
					Try again
				</button>
			</div>
		{:else if !board}
			<div class="h-64 animate-pulse rounded-lg bg-mist" aria-hidden="true"></div>
		{:else if board.entries.length === 0}
			<p class="py-10 text-center text-sm text-navy/60">
				No runs on the board yet — set a name and play the timed challenge.
			</p>
		{:else}
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-[10px] tracking-[0.14em] text-navy/50 uppercase">
						<th class="px-2 py-2 sm:px-3">#</th>
						<th class="px-2 py-2 sm:px-3">Player</th>
						<th class="px-2 py-2 text-right sm:px-3">Score</th>
						<th class="px-2 py-2 text-right sm:px-3">Streak</th>
						<th class="hidden px-3 py-2 text-right sm:table-cell">When</th>
					</tr>
				</thead>
				<tbody>
					{#each board.entries as entry (entry.rank + entry.displayName)}
						<tr class="border-t border-mist">
							<td
								class="px-2 py-2.5 font-mono font-bold sm:px-3 {entry.rank <= 3
									? 'text-cardinal'
									: 'text-navy'}">{entry.rank}</td
							>
							<td class="px-2 py-2.5 sm:px-3">
								<span
									class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-white"
									aria-hidden="true">{entry.displayName[0].toUpperCase()}</span
								>{entry.displayName}
							</td>
							<td class="px-2 py-2.5 text-right font-mono font-bold sm:px-3">{entry.score}</td>
							<td class="px-2 py-2.5 text-right font-mono sm:px-3">{entry.bestStreak}</td>
							<td class="hidden px-3 py-2.5 text-right text-navy/60 sm:table-cell"
								>{dateLabel(entry.at)}</td
							>
						</tr>
					{/each}
					{#if showMeRow && board.me}
						<tr class="rounded-lg bg-mist">
							<td class="px-2 py-2.5 font-mono font-bold sm:px-3">{board.me.rank}</td>
							<td class="px-2 py-2.5 font-semibold sm:px-3">
								<span
									class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-white"
									aria-hidden="true">{board.me.displayName[0].toUpperCase()}</span
								>You — {board.me.displayName}
							</td>
							<td class="px-2 py-2.5 text-right font-mono font-bold sm:px-3">{board.me.score}</td>
							<td class="px-2 py-2.5 text-right font-mono sm:px-3">{board.me.bestStreak}</td>
							<td class="hidden px-3 py-2.5 text-right text-navy/60 sm:table-cell"
								>{dateLabel(board.me.at)}</td
							>
						</tr>
					{/if}
				</tbody>
			</table>
		{/if}
	</div>

	<a
		href="/quiz/timed"
		class="mt-6 inline-block rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
	>
		Play the timed challenge →
	</a>
</section>
```

- [ ] **Step 2: Timed intro link.** In `src/routes/quiz/timed/+page.svelte`, inside the `{#if phase === 'intro'}` block, directly under the `Personal best` paragraph's `{/if}` (i.e. before the Start button), add:

```svelte
		<p class="mt-3 text-sm">
			<a href="/leaderboard" class="text-white/70 underline decoration-white/30 underline-offset-2 hover:text-white">
				See the leaderboard →
			</a>
		</p>
```

- [ ] **Step 3: Quiz hub link.** The hub's mode cards are whole-card anchors, so the leaderboard link cannot nest inside the timed card (invalid HTML). Concrete form of the spec's "linked from the quiz hub timed card": one line directly under the mode grid in `src/routes/quiz/+page.svelte` (after the closing `</div>` of the grid):

```svelte
	<p class="mt-6 text-sm">
		<a href="/leaderboard" class="text-white/70 underline decoration-white/30 underline-offset-2 hover:text-white">
			Timed challenge has a public leaderboard →
		</a>
	</p>
```

- [ ] **Step 4: Verify** — `npm run check && npx prettier --check .` pass; `npm run build` succeeds (page prerenders). Quick manual probe: `npx wrangler dev --port 8787` then `curl -s http://127.0.0.1:8787/leaderboard | grep -o '<title>[^<]*'` → `<title>Leaderboard · Best Perspective` (kill server after).

- [ ] **Step 5: Commit** — `git add -A ':!.claude' && git commit -m "feat: public leaderboard page with own-rank row"`

---

### Task 7: Claim UI — shared component + dashboard line

**Files:**
- Create: `src/lib/components/DisplayNameClaim.svelte`
- Modify: `src/routes/me/+page.server.ts` (return displayName + suggestion)
- Modify: `src/routes/me/+page.svelte` (line in the "Timed best" card)

**Interfaces:**
- Consumes: `PUT /api/profile/display-name`, `PutDisplayName` shapes.
- Produces: `DisplayNameClaim` component with props (exact — Task 8 reuses it):

```ts
{
	suggestion: string;                       // server-derived "Cameron J."
	prefix?: string;                          // text before the links (default '')
	onSaved: (displayName: string) => void;   // fired with the final (possibly suffixed) name
}
```

Behavior: renders `{prefix}join as “{suggestion}” or use another name` — cardinal links, bold navy non-clickable `or` (user-validated microcopy). "join as" PUTs `{displayName: suggestion, resolveConflict: true}`. "use another name" swaps the line for a small inline input + Save + Cancel; Save PUTs without `resolveConflict`; a 409 shows `taken — try “{suggestion}”?` and prefills the returned suggestion; a 400 shows the server message. All errors inline, never a modal.

- [ ] **Step 1: Component.** Create `src/lib/components/DisplayNameClaim.svelte`:

```svelte
<script lang="ts">
	let {
		suggestion,
		prefix = '',
		onSaved
	}: { suggestion: string; prefix?: string; onSaved: (displayName: string) => void } = $props();

	let editing = $state(false);
	let value = $state('');
	let busy = $state(false);
	let message = $state<string | null>(null);

	async function put(body: { displayName: string; resolveConflict?: boolean }) {
		busy = true;
		message = null;
		try {
			const res = await fetch('/api/profile/display-name', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const data = (await res.json().catch(() => null)) as {
				displayName?: string;
				suggestion?: string;
				message?: string;
			} | null;
			if (res.ok && data?.displayName) {
				onSaved(data.displayName);
				return;
			}
			if (res.status === 409) {
				editing = true;
				if (data?.suggestion) value = data.suggestion;
				message = data?.suggestion ? `taken — try “${data.suggestion}”?` : 'that name is taken';
				return;
			}
			message = data?.message ?? 'couldn’t save that name — try again';
		} catch {
			message = 'network error — try again';
		} finally {
			busy = false;
		}
	}
</script>

<span class="text-sm text-navy/70">
	{prefix}<button
		type="button"
		disabled={busy}
		onclick={() => put({ displayName: suggestion, resolveConflict: true })}
		class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal disabled:opacity-40"
		>join as “{suggestion}”</button
	>
	<span class="font-extrabold text-navy">or</span>
	{#if editing}
		<span class="inline-flex flex-wrap items-center gap-1.5">
			<input
				type="text"
				bind:value
				maxlength={30}
				placeholder="Display name"
				class="w-36 rounded-md border border-mist px-2 py-1 text-xs focus:border-navy/50 focus:outline-none"
			/>
			<button
				type="button"
				disabled={busy || value.trim().length < 2}
				onclick={() => put({ displayName: value })}
				class="rounded-full bg-cardinal px-3 py-1 text-[10px] font-semibold tracking-wider text-white uppercase hover:brightness-110 disabled:opacity-40"
				>Save</button
			>
			<button
				type="button"
				onclick={() => {
					editing = false;
					message = null;
				}}
				class="text-xs text-navy/50 underline underline-offset-2 hover:text-navy">cancel</button
			>
		</span>
	{:else}
		<button
			type="button"
			disabled={busy}
			onclick={() => (editing = true)}
			class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal disabled:opacity-40"
			>use another name</button
		>
	{/if}
	{#if message}
		<span class="text-xs font-semibold text-cardinal" role="alert">{message}</span>
	{/if}
</span>
```

- [ ] **Step 2: Server load.** In `src/routes/me/+page.server.ts`: import `user` from the schema and `suggestDisplayName` from `$lib/server/profile/display-name`; add to the existing `Promise.all` a query for the caller's row:

```ts
		db
			.select({ displayName: user.displayName, name: user.name })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1)
```

Destructure it (e.g. `profileRows`) and extend the returned object with:

```ts
		profile: {
			displayName: profileRows[0]?.displayName ?? null,
			suggestion: suggestDisplayName(profileRows[0]?.name ?? session.user.name ?? '')
		}
```

- [ ] **Step 3: Dashboard line.** In `src/routes/me/+page.svelte`, inside the "Timed best" card, between the stats block (`{#if data.timedBest}…{/if}`) and the CTA `<div class="mt-auto pt-5">`, insert:

```svelte
			<div class="mt-4 border-t border-mist pt-3 text-sm text-navy/70">
				{#if data.profile.displayName}
					On the <a href="/leaderboard" class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal">leaderboard</a>
					as <b class="text-navy">{data.profile.displayName}</b>
					· <button type="button" onclick={startChange} class="text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal">change</button>
					· <button type="button" onclick={removeName} class="text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal">remove</button>
				{:else}
					Not on the <a href="/leaderboard" class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal">leaderboard</a> —
					<DisplayNameClaim suggestion={data.profile.suggestion} onSaved={(n) => (displayName = n)} />
				{/if}
			</div>
```

Script additions: import `DisplayNameClaim`; local state seeded from load data so saves update without a reload:

```ts
	import DisplayNameClaim from '$lib/components/DisplayNameClaim.svelte';

	let displayName = $state<string | null>(null);
	$effect.pre(() => {
		displayName = data.profile.displayName;
	});

	async function removeName() {
		const prev = displayName;
		displayName = null;
		const res = await fetch('/api/profile/display-name', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ displayName: null })
		}).catch(() => null);
		if (!res?.ok) displayName = prev; // revert on failure
	}

	function startChange() {
		// change = remove locally then re-open the claim flow prefilled
		displayName = null;
	}
```

and switch the template's `data.profile.displayName` reads to the local `displayName` state (`{#if displayName}` / `{displayName}`). Note "change" simply clears local state to re-show the claim line (server value untouched until a new save) — the claim's `onSaved` sets it back. Keep exact microcopy and link styling from the snippets.

- [ ] **Step 4: Verify** — `npm run check && npx prettier --check .` pass. `npm run test:e2e -- dashboard` → existing dashboard e2e still green (signed-in dashboard renders).

- [ ] **Step 5: Commit** — `git add -A ':!.claude' && git commit -m "feat: leaderboard claim/manage line in the dashboard timed card"`

---

### Task 8: Post-run nudge on the timed results screen

**Files:**
- Modify: `src/routes/quiz/timed/+page.svelte`

**Interfaces:**
- Consumes: `GET /api/leaderboard` + `LeaderboardResponseSchema` + `LEADERBOARD_SIZE`; `GET /api/profile/display-name` + `DisplayNameStateSchema`; `DisplayNameClaim`; the existing `finish()`/done phase and `submitTimedRun` flow.

Behavior (spec, user-validated): after a run is server-accepted, if the score would place in the top 10 AND the player has no display name, show ONE quiet line under the streak line in the results: `#N on the leaderboard if you claim it — join as “X” or use another name ✕`. Dismiss hides it for this results screen. After a successful claim it becomes `On the board as <name> — see the leaderboard →`. Signed-out players never see it (profile fetch 401s → nudge stays hidden). All fetches are fire-and-forget; the results render regardless.

- [ ] **Step 1: State + logic.** In `src/routes/quiz/timed/+page.svelte` script, add:

```ts
	import DisplayNameClaim from '$lib/components/DisplayNameClaim.svelte';
	import { DisplayNameStateSchema } from '$lib/profile/payload';
	import { LEADERBOARD_SIZE, LeaderboardResponseSchema } from '$lib/leaderboard/payload';

	let nudge = $state<{ rank: number; suggestion: string } | null>(null);
	let nudgeDismissed = $state(false);
	let claimedName = $state<string | null>(null);

	/** Server-accepted score → would it make the board, and does the player need a name? */
	async function maybeNudge(score: number, streak: number) {
		nudge = null;
		nudgeDismissed = false;
		claimedName = null;
		try {
			const profileRes = await fetch('/api/profile/display-name');
			if (!profileRes.ok) return; // signed out (401) → no nudge
			const profile = DisplayNameStateSchema.safeParse(await profileRes.json().catch(() => null));
			if (!profile.success || profile.data.displayName !== null) return;
			const boardRes = await fetch('/api/leaderboard');
			const board = LeaderboardResponseSchema.safeParse(await boardRes.json().catch(() => null));
			if (!boardRes.ok || !board.success) return;
			const beats = board.data.entries.filter(
				(e) => e.score > score || (e.score === score && e.bestStreak >= streak)
			).length;
			const rank = beats + 1;
			if (rank <= LEADERBOARD_SIZE) nudge = { rank, suggestion: profile.data.suggestion };
		} catch {
			// network problems never touch the results screen
		}
	}
```

Call it where the server accepts the run: the done-phase flow currently calls `submitTimedRun` fire-and-forget. Locate that call (in `finish()`); change the surrounding code so the submit promise (it resolves `{score, bestStreak} | null` — check `submitTimedRun`'s current return; if it returns void, extend it in `src/lib/quiz/sync.ts` to return the parsed `{score, bestStreak}` on 201 and `null` otherwise, keeping fire-and-forget semantics at existing call sites) triggers the nudge:

```ts
		void submitTimedRun({ token, rulesetId: DEFAULT_RULESET_ID, items, records }).then((accepted) => {
			if (accepted) void maybeNudge(accepted.score, accepted.bestStreak);
		});
```

(If `submitTimedRun` already returns the parsed result, use it directly — note the actual shape in the task report.)

- [ ] **Step 2: Markup.** In the done-phase `QuizSummary` block, directly under the existing `Best streak this run:` paragraph, add:

```svelte
				{#if claimedName}
					<p class="mt-2 text-sm text-navy/70">
						On the board as <b class="text-navy">{claimedName}</b> —
						<a href="/leaderboard" class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal">see the leaderboard →</a>
					</p>
				{:else if nudge && !nudgeDismissed}
					<p class="mt-2 text-sm text-navy/70">
						#{nudge.rank} on the
						<a href="/leaderboard" class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal">leaderboard</a>
						if you claim it —
						<DisplayNameClaim suggestion={nudge.suggestion} onSaved={(n) => (claimedName = n)} />
						<button
							type="button"
							aria-label="Dismiss"
							onclick={() => (nudgeDismissed = true)}
							class="ml-1 text-navy/40 hover:text-navy/70">✕</button
						>
					</p>
				{/if}
```

- [ ] **Step 3: Verify** — `npm run check && npx prettier --check .`; `npm run test:e2e -- timed` → existing timed e2e green (the nudge is additive; signed-out timed runs are unaffected because the profile fetch 401s).

- [ ] **Step 4: Commit** — `git add -A ':!.claude' && git commit -m "feat: leaderboard claim nudge on qualifying timed results"`

---

### Task 9: e2e suite + README

**Files:**
- Create: `e2e/leaderboard.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: e2e.** Create `e2e/leaderboard.spec.ts` (real local API — no mocking; each test signs up throwaway users; note the suite runs against one shared local D1, so use unique names via `Date.now()` to avoid cross-run collisions):

```ts
import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

const RULESET = 'usau-official-2026-27';

async function setName(page: import('@playwright/test').Page, displayName: string, resolve = false) {
	const res = await page.request.put('/api/profile/display-name', {
		data: resolve ? { displayName, resolveConflict: true } : { displayName }
	});
	return res;
}

async function playTimedRun(page: import('@playwright/test').Page) {
	await page.goto('/quiz/timed');
	await page.waitForLoadState('networkidle');
	await page.clock.install();
	await page.getByRole('button', { name: /^start$/i }).click();
	await page.getByTestId('choice').first().click();
	await page.clock.fastForward(700);
	await page.getByRole('button', { name: /end run/i }).click();
	await expect(page.getByRole('heading', { name: /time!/i })).toBeVisible();
}

test('signed out: board loads with empty state or entries, no me row', async ({ page }) => {
	await page.goto('/leaderboard');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: /leaderboard/i })).toBeVisible();
	await expect(page.getByText(/you —/i)).toHaveCount(0);
});

test('claim via API + play run → row appears on the board', async ({ page }) => {
	const name = `Boarder ${Date.now() % 100000}`;
	await signUpTestUser(page, 'lb-claim');
	expect((await setName(page, name)).ok()).toBeTruthy();
	await playTimedRun(page);
	await page.goto('/leaderboard');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(name).first()).toBeVisible();
});

test('duplicate custom name 409s; resolveConflict appends a suffix', async ({ page }) => {
	const base = `Dup ${Date.now() % 100000}`;
	await signUpTestUser(page, 'lb-dup1');
	expect((await setName(page, base)).ok()).toBeTruthy();
	await signUpTestUser(page, 'lb-dup2'); // fresh cookie jar? NO — same context; see note below
	const conflict = await setName(page, base.toLowerCase());
	expect(conflict.status()).toBe(409);
	expect((await conflict.json()).suggestion).toBe(`${base.toLowerCase()} 2`);
	const resolved = await setName(page, base.toLowerCase(), true);
	expect((await resolved.json()).displayName).toBe(`${base.toLowerCase()} 2`);
});

test('dashboard: claim line appears, join-as sets the name, remove clears it', async ({ page }) => {
	await signUpTestUser(page, 'lb-dash');
	await page.goto('/me');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(/not on the/i)).toBeVisible();
	await page.getByRole('button', { name: /join as/i }).click();
	await expect(page.getByText(/on the/i).first()).toBeVisible();
	await page.getByRole('button', { name: /^remove$/i }).click();
	await expect(page.getByText(/not on the/i)).toBeVisible();
});

test('post-run nudge: qualifying run without a name shows the claim line', async ({ page }) => {
	await signUpTestUser(page, 'lb-nudge');
	await playTimedRun(page);
	await expect(page.getByText(/if you claim it/i)).toBeVisible({ timeout: 10_000 });
	await page.getByRole('button', { name: /join as/i }).click();
	await expect(page.getByText(/on the board as/i)).toBeVisible();
	await expect(page.getByRole('link', { name: /see the leaderboard/i })).toBeVisible();
});
```

**Note on the duplicate test:** `signUpTestUser` signs up via `page.request`, which replaces the session cookie in the shared context — the second sign-up REPLACES the first user's session, which is exactly what the test needs (two different users, sequentially). Verify this matches `e2e/helpers.ts` behavior; if sign-up doesn't switch sessions, use `browser.newContext()` for the second user instead and note the deviation.

**Note on `playTimedRun`:** `page.clock.install()` + fastForward mirrors `e2e/quiz.spec.ts`'s existing timed tests — copy their exact clock incantation if it differs from the above.

Run `npm run test:e2e -- leaderboard` → 5/5 PASS. Then the FULL suite → 46 passing.

- [ ] **Step 2: README.** Add a "Leaderboard" bullet to the features list (all-time top 10, opt-in unique display names, profanity-filtered, own-rank row) and extend the AI-adjacent data note: display names are public once set; clearing the name removes you from the board immediately.

- [ ] **Step 3: Full verification suite**

```bash
npm run check && npm run check:scripts && npm run test && npm run validate:content && npx prettier --check . && npm run build && npm run test:e2e
```

All green.

- [ ] **Step 4: Commit** — `git add -A ':!.claude' && git commit -m "test: leaderboard e2e coverage + README"`

---

### Task 10: CHECKPOINT — wipe, remote migration, deploy, prod smoke

**This task is NOT for a subagent.** Controller + user (all remote commands user-run).

- [ ] **Step 1 (controller): local wipe** — `npx wrangler d1 execute usau-rules-website-db --local --command "delete from quiz_attempts where mode='timed'"` (cascades those runs' question_responses).
- [ ] **Step 2 (user): remote wipe + migration**
  - `npx wrangler d1 execute usau-rules-website-db --remote --command "delete from quiz_attempts where mode='timed'"`
  - `npm run db:migrate:remote` (applies the display-name migration)
- [ ] **Step 3 (user): deploy** — `npm run build && npx wrangler deploy`
- [ ] **Step 4 (smoke, user browser + controller checks):** signed-out `/leaderboard` shows the empty state; sign in on the phone/desktop → dashboard shows the claim line → join as suggestion → play a timed run → row appears on `/leaderboard`; nudge shows on a second account or after removing the name. Controller verifies via browser fetch (Bot Fight Mode blocks curl): board JSON contains no emails/user ids.
- [ ] **Step 5:** Ledger entry; note the stale-localStorage caveat (devices keep an old 60s personal best until beaten).

---

## After the last task

Final whole-branch review (fable reviewer; scope: spec compliance, the public endpoint's data exposure, uniqueness race handling, prerender integrity) + security pass on the two new endpoints (public read exposes only the five spec'd fields; PUT is self-scoped — a user can only ever write their own row). Fix findings, re-run the full suite, squash-merge `feature/leaderboard` to `main`, push, verify CI.

## Self-review (done at plan time)

- **Spec coverage:** board scope/ordering (Task 5 SQL), unique opt-in names + suffix resolution + profanity (Tasks 1/3/4), initials chip + classic table + own-rank row (Task 6), dashboard line + microcopy + bold-navy "or" (Tasks 7, component), nudge line + dismiss + qualification (Task 8), links from timed intro/quiz hub/dashboard (Tasks 6/7), RunClaims rulesetId (Task 2), wipe checkpoint (Task 10), signed-out UX (Tasks 5/6/8), no new hooks entries (constraint), e2e + README (Task 9).
- **Placeholder scan:** clean — every code step carries full code; the two "verify against actual file" notes (submitTimedRun return shape, e2e clock incantation) are bounded look-and-match instructions, not TBDs.
- **Type consistency:** `LeaderboardEntry`/`LeaderboardResponse` (Task 5) consumed by Tasks 6/8; `DisplayNameState`/`PutDisplayName` (Task 4) consumed by 7/8; `DisplayNameClaim` props (Task 7) match Task 8's usage; `beginTimedRun(rulesetId)` (Task 2) matches the timed page call; `suggestDisplayName`/`resolveUniqueName`/`validateDisplayName` signatures consistent across Tasks 3/4/7.
