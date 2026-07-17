# Ask Chat Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot `/ask` page with a multi-turn chat app: conversation sidebar, per-conversation pages at `/ask/[id]`, follow-ups, copy + 👍/👎 on messages, soft-deletable conversations — on new `ai_conversations`/`ai_messages` tables with existing `ai_asks` data migrated in and that table dropped.

**Architecture:** One migration cuts the data layer over (create, copy, drop). A single streaming endpoint `POST /api/ai/chat` creates-or-continues conversations, reusing the existing Gemini context-cache machinery with a new `priorTurns` extension for transcript context. The UI is an optional-param route `src/routes/ask/[[id]]/+page.svelte` under a session-gating `+layout.svelte` with the sidebar; after the first send the URL updates via shallow `replaceState` (no remount, streaming state preserved).

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, Tailwind v4, Drizzle ORM on Cloudflare D1, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-17-ask-chat-rework-design.md`
**Branch:** `feat/ask-history` (reworked in place; do not create a new branch).

## Global Constraints

- Svelte 5 runes only (`$state`, `$derived`, `$props`, `$effect`) — no legacy `export let` / stores in components.
- No new dependencies.
- Quota: every `POST /api/ai/chat` call consumes 1 `'ask'` unit from the existing caps; `ai_usage`, `consumeQuota`, and the 429 copy are unchanged.
- Conversation cap: 25 messages (`CONVERSATION_MESSAGE_CAP`); server 400 message: `This conversation is full — start a new one`.
- Soft delete only: `deletedAt` on conversations; rows are never removed.
- Sidebar page size default 20, clamp 1–50, cursor = `updatedAt` of last entry; conversation detail returns all messages.
- Error copy (exact): sidebar load failure `Couldn't load your conversations.`; delete failure `Couldn't delete that conversation — try again.`; 503 `AI features are offline right now.`; 401 `Your session expired — sign in again.`; generic send failure `The rules assistant is unavailable — try again in a minute.`
- History/sidebar failures must never block sending a message.
- Run `npm run format` before every commit (CI runs `prettier --check`).
- Verification: `npm test` and `npm run check` must be green after every task. **`npx playwright test e2e/ai.spec.ts` is expected red for the ask/history sections from Task 1 until Task 8 rewrites them** (the old UI/endpoints are being cut over); scenario sections must stay green — spot-check with `npx playwright test e2e/ai.spec.ts --grep "scenario mode"` if in doubt.

---

### Task 1: Schema cutover — new tables, data migration, drop `ai_asks`, remove dead endpoints

**Files:**
- Modify: `src/lib/server/db/schema.ts` (replace the `aiAsks` export, lines ~196–213)
- Create (generated then hand-edited): `drizzle/0005_ask-chat.sql`
- Delete: `src/routes/api/ai/ask/+server.ts`, `src/routes/api/ai/asks/+server.ts`, `src/routes/api/ai/asks/[id]/+server.ts`

**Interfaces:**
- Consumes: existing `user` table, existing `aiAsks` definition.
- Produces (from `$lib/server/db/schema`): `aiConversations` (columns `id, userId, rulesetId, title, createdAt, updatedAt, deletedAt`) and `aiMessages` (columns `id, conversationId, role, content, status, model, feedback, createdAt`). Tasks 4–5 import both.

Deleting the three endpoint files in this task keeps `npm run check` green (they are the only importers of `aiAsks`). The `/ask` page will be runtime-broken (its fetches 404) until Task 7 — that is expected mid-branch.

- [ ] **Step 1: Replace `aiAsks` in the schema**

In `src/lib/server/db/schema.ts`, delete the whole `export const aiAsks = …` block and put in its place:

```ts
export const aiConversations = sqliteTable(
	'ai_conversations',
	{
		id: text('id').primaryKey(), // uuid
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rulesetId: text('ruleset_id').notNull(), // conversation is pinned to one ruleset
		title: text('title').notNull(), // first user message, truncated to 80 chars
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(), // last-message time; drives sidebar ordering
		deletedAt: integer('deleted_at') // ms epoch; NULL = visible (soft delete)
	},
	(table) => [index('ai_conversations_user_updated_idx').on(table.userId, table.updatedAt)]
);

export const aiMessages = sqliteTable(
	'ai_messages',
	{
		id: text('id').primaryKey(), // uuid; public id used by the feedback endpoint
		conversationId: text('conversation_id')
			.notNull()
			.references(() => aiConversations.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['user', 'assistant'] }).notNull(),
		content: text('content').notNull(), // '' allowed for status='error' assistant rows
		// assistant only: complete = stream finished; truncated = MAX_TOKENS; error = no stream
		status: text('status', { enum: ['complete', 'truncated', 'error'] }),
		model: text('model'), // assistant only; per message so model changes stay accurate
		feedback: text('feedback', { enum: ['up', 'down'] }), // assistant only; NULL = none
		createdAt: integer('created_at').notNull()
	},
	(table) => [index('ai_messages_convo_created_idx').on(table.conversationId, table.createdAt)]
);
```

- [ ] **Step 2: Delete the dead endpoints**

```bash
git rm src/routes/api/ai/ask/+server.ts src/routes/api/ai/asks/+server.ts "src/routes/api/ai/asks/[id]/+server.ts"
```

- [ ] **Step 3: Generate the migration, then hand-edit in the data copy**

Run: `npx drizzle-kit generate --name ask-chat`
Expected: `drizzle/0005_ask-chat.sql` with two `CREATE TABLE` statements, two `CREATE INDEX` statements, and a `DROP TABLE \`ai_asks\``-ish section (drizzle may emit the drop as a plain `DROP TABLE`). 

Edit the generated file so the statement order is: **creates → indexes → data copy → drop**. Insert this data-copy block (ids are derived deterministically from the old ask id; conversations before messages so FKs hold) immediately BEFORE the drop, using `--> statement-breakpoint` separators matching the file's style:

```sql
INSERT INTO `ai_conversations` (`id`, `user_id`, `ruleset_id`, `title`, `created_at`, `updated_at`, `deleted_at`)
SELECT 'conv-' || `id`, `user_id`, `ruleset_id`, substr(`prompt`, 1, 80), `created_at`, `created_at`, `hidden_at`
FROM `ai_asks` WHERE `status` != 'error';
--> statement-breakpoint
INSERT INTO `ai_messages` (`id`, `conversation_id`, `role`, `content`, `status`, `model`, `feedback`, `created_at`)
SELECT 'msgu-' || `id`, 'conv-' || `id`, 'user', `prompt`, NULL, NULL, NULL, `created_at`
FROM `ai_asks` WHERE `status` != 'error';
--> statement-breakpoint
INSERT INTO `ai_messages` (`id`, `conversation_id`, `role`, `content`, `status`, `model`, `feedback`, `created_at`)
SELECT 'msga-' || `id`, 'conv-' || `id`, 'assistant', coalesce(`answer`, ''),
       CASE `status` WHEN 'answered' THEN 'complete' ELSE 'truncated' END, `model`, NULL, `created_at` + 1
FROM `ai_asks` WHERE `status` != 'error';
```

- [ ] **Step 4: Verify the migration migrates data**

Seed a fixture row into the OLD table before applying (the local dev DB may or may not have real rows — the fixture makes the check deterministic):

```bash
npx wrangler d1 execute usau-rules-website-db --local --command "INSERT INTO ai_asks (id, user_id, ruleset_id, model, prompt, answer, status, created_at, hidden_at) SELECT 'migtest-1', id, 'usau-official-2026-27', 'm', 'Migration fixture question', 'Migration fixture answer', 'answered', 1752000000000, NULL FROM user LIMIT 1"
```

(If the local `user` table is empty, sign up once via `npm run dev` + the test sign-in, or skip the fixture and rely on CI's empty-table no-op path — but say so in your report.)

Run: `npm run db:migrate:local`
Expected: applies `0005_ask-chat` without error.

Verify:

```bash
npx wrangler d1 execute usau-rules-website-db --local --json --command "SELECT (SELECT count(*) FROM ai_conversations WHERE id = 'conv-migtest-1') AS convs, (SELECT count(*) FROM ai_messages WHERE conversation_id = 'conv-migtest-1') AS msgs"
```
Expected: `convs: 1, msgs: 2`. Also confirm `ai_asks` is gone:
`… --command "SELECT name FROM sqlite_master WHERE name = 'ai_asks'"` → no rows.

Run: `npm run check` → 0 errors. Run: `npm test` → all pass (no unit test imports `aiAsks`).

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/lib/server/db/schema.ts drizzle/ src/routes/api/ai/
git commit -m "feat: conversation schema; migrate and drop ai_asks; remove ask endpoints"
```

---

### Task 2: Wire types + chat helpers (TDD)

**Files:**
- Modify: `src/lib/ai/payload.ts` (append; do NOT remove the Ask* exports yet — the old page still imports them until Task 7)
- Modify: `src/lib/server/ai/history.ts` + `src/lib/server/ai/history.test.ts` (default-limit parameter)
- Create: `src/lib/server/ai/chat.ts`
- Test: `src/lib/server/ai/chat.test.ts`

**Interfaces:**
- Produces (from `$lib/ai/payload`, shared client+server):
  ```ts
  export const CHAT_MAX_MESSAGE_CHARS = 500;
  export const CONVERSATION_MESSAGE_CAP = 25;
  export interface ChatPayload { message: string; conversationId?: string; rulesetId?: string }
  export const ChatPayloadSchema: z.ZodType<ChatPayload>;
  export function deriveTitle(message: string): string; // trim, collapse whitespace, slice 80
  export interface ConversationSummary { id: string; title: string; updatedAt: number }
  export interface ConversationListResponse { conversations: ConversationSummary[]; hasMore: boolean }
  export interface ChatMessage {
  	id: string;
  	role: 'user' | 'assistant';
  	content: string;
  	status: 'complete' | 'truncated' | 'error' | null;
  	feedback: 'up' | 'down' | null;
  	createdAt: number;
  }
  export interface ConversationDetail { id: string; title: string; rulesetId: string; messages: ChatMessage[] }
  ```
- Produces (from `$lib/server/ai/chat`):
  ```ts
  export interface StoredTurn { role: 'user' | 'assistant'; content: string; status: string | null }
  export function toGeminiTurns(messages: StoredTurn[]): { role: 'user' | 'model'; text: string }[];
  ```
- Changes: `parseHistoryQuery(params: URLSearchParams, defaultLimit = 10)` — second optional arg; existing behavior unchanged when omitted.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/ai/chat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveTitle } from '$lib/ai/payload';
import { toGeminiTurns } from './chat';

describe('deriveTitle', () => {
	it('trims, collapses internal whitespace, and caps at 80 chars', () => {
		expect(deriveTitle('  What is\n a   stall?  ')).toBe('What is a stall?');
		expect(deriveTitle('x'.repeat(200))).toHaveLength(80);
	});
});

describe('toGeminiTurns', () => {
	it('maps roles and preserves order', () => {
		expect(
			toGeminiTurns([
				{ role: 'user', content: 'Q1', status: null },
				{ role: 'assistant', content: 'A1', status: 'complete' },
				{ role: 'user', content: 'Q2', status: null }
			])
		).toEqual([
			{ role: 'user', text: 'Q1' },
			{ role: 'model', text: 'A1' },
			{ role: 'user', text: 'Q2' }
		]);
	});
	it('drops error and empty assistant turns but keeps truncated ones', () => {
		expect(
			toGeminiTurns([
				{ role: 'user', content: 'Q1', status: null },
				{ role: 'assistant', content: '', status: 'error' },
				{ role: 'assistant', content: 'partial', status: 'truncated' }
			])
		).toEqual([
			{ role: 'user', text: 'Q1' },
			{ role: 'model', text: 'partial' }
		]);
	});
});
```

Append to `src/lib/server/ai/history.test.ts`'s `parseHistoryQuery` describe:

```ts
	it('accepts a caller-supplied default limit', () => {
		expect(parseHistoryQuery(new URLSearchParams(), 20).limit).toBe(20);
		expect(parseHistoryQuery(new URLSearchParams('limit=5'), 20).limit).toBe(5);
		expect(parseHistoryQuery(new URLSearchParams('limit=999'), 20).limit).toBe(50);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/ai/chat.test.ts src/lib/server/ai/history.test.ts`
Expected: FAIL — `deriveTitle`/`toGeminiTurns` unresolved; default-limit test fails.

- [ ] **Step 3: Implement**

Append to `src/lib/ai/payload.ts`:

```ts
/** ---- Ask chat (multi-turn) wire shapes ---- */

export const CHAT_MAX_MESSAGE_CHARS = 500;
/** Hard per-conversation size guardrail (messages of both roles combined). */
export const CONVERSATION_MESSAGE_CAP = 25;

export interface ChatPayload {
	message: string;
	conversationId?: string;
	rulesetId?: string;
}

export const ChatPayloadSchema: z.ZodType<ChatPayload> = z.object({
	message: z.string().trim().min(3).max(CHAT_MAX_MESSAGE_CHARS),
	// NOT z.string().uuid(): migrated conversations have derived ids like 'conv-<uuid>'.
	conversationId: z.string().min(1).max(64).optional(),
	rulesetId: z.string().min(1).max(64).optional()
});

/** Sidebar title derived from the first message. */
export function deriveTitle(message: string): string {
	return message.trim().replace(/\s+/g, ' ').slice(0, 80);
}

export interface ConversationSummary {
	id: string;
	title: string;
	updatedAt: number; // ms epoch of last message
}

export interface ConversationListResponse {
	conversations: ConversationSummary[];
	hasMore: boolean;
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	status: 'complete' | 'truncated' | 'error' | null; // assistant only; null for user rows
	feedback: 'up' | 'down' | null; // assistant only
	createdAt: number;
}

export interface ConversationDetail {
	id: string;
	title: string;
	rulesetId: string;
	messages: ChatMessage[];
}
```

Create `src/lib/server/ai/chat.ts`:

```ts
/** Transcript assembly for multi-turn ask chat. */

export interface StoredTurn {
	role: 'user' | 'assistant';
	content: string;
	status: string | null;
}

/** DB rows → Gemini turns. Error/empty assistant rows carry no signal — drop them. */
export function toGeminiTurns(messages: StoredTurn[]): { role: 'user' | 'model'; text: string }[] {
	return messages
		.filter((m) => m.content !== '' && (m.role === 'user' || m.status !== 'error'))
		.map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('model' as const), text: m.content }));
}
```

In `src/lib/server/ai/history.ts`, change the signature and default handling:

```ts
export function parseHistoryQuery(
	params: URLSearchParams,
	defaultLimit: number = DEFAULT_LIMIT
): { before: number | null; limit: number } {
	const limit = toPositiveInt(params.get('limit'));
	return {
		before: toPositiveInt(params.get('before')),
		limit: limit === null ? defaultLimit : Math.min(limit, MAX_LIMIT)
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/ai/chat.test.ts src/lib/server/ai/history.test.ts`
Expected: PASS. Then `npm test` and `npm run check` → green.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/lib/ai/payload.ts src/lib/server/ai/chat.ts src/lib/server/ai/chat.test.ts src/lib/server/ai/history.ts src/lib/server/ai/history.test.ts
git commit -m "feat: chat wire shapes, transcript helper, parameterized list default"
```

---

### Task 3: `priorTurns` on GeminiRequest (TDD)

**Files:**
- Modify: `src/lib/server/ai/gemini.ts` (`GeminiRequest` interface + `buildBody`)
- Test: `src/lib/server/ai/gemini.test.ts` (append)

**Interfaces:**
- Produces: `GeminiRequest.priorTurns?: { role: 'user' | 'model'; text: string }[]` — inserted into `contents` BEFORE the task prompt, in both the cached and inline (fallback) bodies. Omitted → behavior byte-identical to today (existing tests are the regression gate). Task 4 passes `toGeminiTurns(...)` here.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/ai/gemini.test.ts` (uses the file's existing `memoryStore`, `okJson`, `geminiAnswer`, and `req` helpers — read them first; `req` builds a `GeminiRequest` with a `fetchImpl` seam):

```ts
describe('priorTurns', () => {
	it('inserts prior turns before the task prompt in the cached body', async () => {
		const store = memoryStore();
		const bodies: Record<string, unknown>[] = [];
		const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
			if (String(url).includes('cachedContents')) return okJson({ name: 'cachedContents/abc' });
			return geminiAnswer('ok [1.A]');
		});
		const request = {
			...req(fetchMock as typeof fetch, store),
			priorTurns: [
				{ role: 'user' as const, text: 'Q1' },
				{ role: 'model' as const, text: 'A1' }
			]
		};
		await generateText(request);
		const call = bodies.find((b) => 'cachedContent' in b)!;
		expect(call.contents).toEqual([
			{ role: 'user', parts: [{ text: 'Q1' }] },
			{ role: 'model', parts: [{ text: 'A1' }] },
			{ role: 'user', parts: [{ text: 'TASK' }] }
		]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/ai/gemini.test.ts`
Expected: the new test FAILS (contents lack the prior turns); all existing tests still pass.

- [ ] **Step 3: Implement**

In `src/lib/server/ai/gemini.ts`, add to `GeminiRequest`:

```ts
	/** Prior conversation turns, oldest first; sent before taskPrompt. */
	priorTurns?: { role: 'user' | 'model'; text: string }[];
```

Change `buildBody` to:

```ts
function buildBody(req: GeminiRequest, cacheName: string | null): Record<string, unknown> {
	const turns = (req.priorTurns ?? []).map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
	// With a cache, systemInstruction/grounding live IN the cache and must not repeat here.
	return cacheName
		? {
				cachedContent: cacheName,
				contents: [...turns, userText(req.taskPrompt)],
				generationConfig: req.generationConfig
			}
		: {
				systemInstruction: { parts: [{ text: req.systemPolicy }] },
				contents: [userText(req.grounding), ...turns, userText(req.taskPrompt)],
				generationConfig: req.generationConfig
			};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/ai/gemini.test.ts` → all PASS. Then `npm test` + `npm run check` → green.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/lib/server/ai/gemini.ts src/lib/server/ai/gemini.test.ts
git commit -m "feat: send prior conversation turns to Gemini"
```

---

### Task 4: `POST /api/ai/chat` streaming endpoint

**Files:**
- Create: `src/routes/api/ai/chat/+server.ts`

**Interfaces:**
- Consumes: `ChatPayloadSchema`, `deriveTitle` (`$lib/ai/payload`); `CONVERSATION_MESSAGE_CAP` (`$lib/ai/payload`); `toGeminiTurns` (`$lib/server/ai/chat`); `aiConversations`, `aiMessages` (schema, Task 1); `priorTurns` (Task 3); existing `streamText`/`d1CacheStore`, `groundingFor`, `aiAvailable`/`consumeQuota`/`d1UsageStore`, `buildAskPrompt`/`systemPolicy`, `requireUser`, `AI_MAX_OUTPUT_TOKENS`/`GEMINI_MODEL`.
- Produces: streaming ndjson response (same `think`/`text`/`truncated` frames as the old ask endpoint) with headers `x-bp-conversation-id`, `x-bp-message-id` (assistant message id), `x-bp-ai-remaining`. Errors: 400 invalid/full/unknown-ruleset, 404 foreign/deleted conversation, 429 quota (same copy as before), 502 after one retry, 503 offline.

- [ ] **Step 1: Implement the endpoint**

Create `src/routes/api/ai/chat/+server.ts`:

```ts
import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { ChatPayloadSchema, CONVERSATION_MESSAGE_CAP, deriveTitle } from '$lib/ai/payload';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { toGeminiTurns } from '$lib/server/ai/chat';
import { AI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from '$lib/server/ai/config';
import { d1CacheStore, streamText } from '$lib/server/ai/gemini';
import { groundingFor } from '$lib/server/ai/grounding';
import { aiAvailable, consumeQuota, d1UsageStore } from '$lib/server/ai/guardrails';
import { buildAskPrompt, systemPolicy } from '$lib/server/ai/prompts';
import { aiConversations, aiMessages } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const env = event.platform?.env;
	if (!env || !aiAvailable(env)) error(503, 'AI features are currently offline');
	const parsed = ChatPayloadSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid message');
	const db = event.locals.db;

	// Resolve the conversation: existing (owner-scoped, not deleted) or new.
	let rulesetId: string;
	let priorTurns: { role: 'user' | 'model'; text: string }[] = [];
	const existingId = parsed.data.conversationId ?? null;
	if (existingId) {
		const convos = await db
			.select({ id: aiConversations.id, rulesetId: aiConversations.rulesetId })
			.from(aiConversations)
			.where(
				and(
					eq(aiConversations.id, existingId),
					eq(aiConversations.userId, user.id),
					isNull(aiConversations.deletedAt)
				)
			)
			.limit(1);
		if (!convos[0]) error(404, 'conversation not found'); // no existence oracle
		rulesetId = convos[0].rulesetId; // body rulesetId is ignored for existing conversations
		const prior = await db
			.select({ role: aiMessages.role, content: aiMessages.content, status: aiMessages.status })
			.from(aiMessages)
			.where(eq(aiMessages.conversationId, existingId))
			.orderBy(asc(aiMessages.createdAt));
		if (prior.length >= CONVERSATION_MESSAGE_CAP)
			error(400, 'This conversation is full — start a new one');
		priorTurns = toGeminiTurns(prior);
	} else {
		rulesetId = parsed.data.rulesetId ?? DEFAULT_RULESET_ID;
	}
	const grounding = groundingFor(rulesetId);
	if (!grounding) error(400, 'unknown ruleset');

	const decision = await consumeQuota(d1UsageStore(db), user.id, 'ask', Date.now());
	if (!decision.allowed) {
		error(
			429,
			decision.reason === 'user-cap'
				? 'Daily question limit reached — try again tomorrow'
				: 'The daily AI budget is used up — try again tomorrow'
		);
	}

	// Persist the conversation (if new) and the user message BEFORE calling Gemini,
	// so even a failed generation leaves an accurate transcript.
	const now = Date.now();
	const conversationId = existingId ?? crypto.randomUUID();
	if (!existingId) {
		await db.insert(aiConversations).values({
			id: conversationId,
			userId: user.id,
			rulesetId,
			title: deriveTitle(parsed.data.message),
			createdAt: now,
			updatedAt: now
		});
	}
	await db.insert(aiMessages).values({
		id: crypto.randomUUID(),
		conversationId,
		role: 'user',
		content: parsed.data.message,
		createdAt: now
	});

	const assistantMessageId = crypto.randomUUID();
	let answerText = '';
	let truncated = false;
	// Persistence must never break the stream; failures are reported and swallowed.
	const persistAssistant = async (status: 'complete' | 'truncated' | 'error') => {
		try {
			const at = Date.now();
			await db.insert(aiMessages).values({
				id: assistantMessageId,
				conversationId,
				role: 'assistant',
				content: status === 'error' ? '' : answerText,
				status,
				model: GEMINI_MODEL,
				createdAt: at
			});
			await db
				.update(aiConversations)
				.set({ updatedAt: at })
				.where(eq(aiConversations.id, conversationId));
		} catch (cause) {
			console.error('chat: failed to persist assistant message', cause);
		}
	};
	const observer = {
		onText: (t: string) => (answerText += t),
		onTruncated: () => (truncated = true),
		onClose: () => persistAssistant(truncated ? 'truncated' : 'complete')
	};

	const geminiRequest = {
		apiKey: env.GEMINI_API_KEY!,
		store: d1CacheStore(db),
		rulesetId,
		systemPolicy: systemPolicy(rulesetId),
		grounding,
		priorTurns,
		taskPrompt: buildAskPrompt(parsed.data.message),
		generationConfig: {
			temperature: 0.3,
			maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
			// See the 2026-07-13 owner decision on the old ask endpoint: 'medium' bounds
			// worst-case thinking-tail latency while staying adaptive.
			thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true }
		}
	};

	// Spec: failure → one retry → apologetic error. Retries only help before the stream opens.
	let stream: ReadableStream<Uint8Array>;
	try {
		stream = await streamText(geminiRequest, observer);
	} catch {
		try {
			stream = await streamText(geminiRequest, observer);
		} catch (cause) {
			console.error('chat: streamText failed after retry', cause);
			await persistAssistant('error');
			error(502, 'The rules assistant is unavailable right now — try again in a minute');
		}
	}

	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store',
			'x-bp-conversation-id': conversationId,
			'x-bp-message-id': assistantMessageId,
			'x-bp-ai-remaining': String(decision.remaining)
		}
	});
};
```

- [ ] **Step 2: Verify**

Run: `npm run check` → 0 errors (regenerates `./$types`). Run: `npm test` → green.
(Data-dependent behavior gets seeded-D1 e2e coverage in Task 8.)

- [ ] **Step 3: Commit**

```bash
npm run format
git add src/routes/api/ai/chat/
git commit -m "feat: multi-turn streaming chat endpoint"
```

---

### Task 5: Conversation list/detail/delete + feedback endpoints

**Files:**
- Create: `src/routes/api/ai/conversations/+server.ts`
- Create: `src/routes/api/ai/conversations/[id]/+server.ts`
- Create: `src/routes/api/ai/messages/[id]/feedback/+server.ts`

**Interfaces:**
- Consumes: `parseHistoryQuery`/`pageRows` (Task 2 signature), schema tables, `requireUser`.
- Produces:
  - `GET /api/ai/conversations?before=<ms>&limit=<n>` → `ConversationListResponse` (`updatedAt DESC`, default limit 20, excludes deleted).
  - `GET /api/ai/conversations/<id>` → `ConversationDetail` (messages `createdAt ASC`); 404 if foreign/deleted/unknown.
  - `DELETE /api/ai/conversations/<id>` → `{ ok: true }` always (soft delete, idempotent).
  - `POST /api/ai/messages/<id>/feedback` with `{ feedback: 'up' | 'down' | null }` → `{ ok: true }` always; writes only to the caller's own assistant messages.

- [ ] **Step 1: List endpoint**

Create `src/routes/api/ai/conversations/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { pageRows, parseHistoryQuery } from '$lib/server/ai/history';
import { aiConversations } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const { before, limit } = parseHistoryQuery(event.url.searchParams, 20);
	const conditions = [eq(aiConversations.userId, user.id), isNull(aiConversations.deletedAt)];
	if (before !== null) conditions.push(lt(aiConversations.updatedAt, before));
	const rows = await event.locals.db
		.select({
			id: aiConversations.id,
			title: aiConversations.title,
			updatedAt: aiConversations.updatedAt
		})
		.from(aiConversations)
		.where(and(...conditions))
		.orderBy(desc(aiConversations.updatedAt))
		.limit(limit + 1); // sentinel row for hasMore
	const { items, hasMore } = pageRows(rows, limit);
	return json({ conversations: items, hasMore });
};
```

- [ ] **Step 2: Detail + delete endpoint**

Create `src/routes/api/ai/conversations/[id]/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { aiConversations, aiMessages } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const db = event.locals.db;
	const convos = await db
		.select({
			id: aiConversations.id,
			title: aiConversations.title,
			rulesetId: aiConversations.rulesetId
		})
		.from(aiConversations)
		.where(
			and(
				eq(aiConversations.id, event.params.id),
				eq(aiConversations.userId, user.id),
				isNull(aiConversations.deletedAt)
			)
		)
		.limit(1);
	if (!convos[0]) error(404, 'conversation not found'); // no existence oracle
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
		.where(eq(aiMessages.conversationId, convos[0].id))
		.orderBy(asc(aiMessages.createdAt));
	return json({ ...convos[0], messages });
};

// Soft delete: conversations double as the Q&A quality log, so we hide, never remove.
export const DELETE: RequestHandler = async (event) => {
	const user = await requireUser(event);
	await event.locals.db
		.update(aiConversations)
		.set({ deletedAt: Date.now() })
		.where(
			and(
				eq(aiConversations.id, event.params.id),
				eq(aiConversations.userId, user.id),
				isNull(aiConversations.deletedAt)
			)
		);
	return json({ ok: true }); // idempotent; no existence oracle
};
```

- [ ] **Step 3: Feedback endpoint**

Create `src/routes/api/ai/messages/[id]/feedback/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { aiConversations, aiMessages } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/session';

const BodySchema = z.object({ feedback: z.enum(['up', 'down']).nullable() });

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const parsed = BodySchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) error(400, 'invalid feedback payload');
	const db = event.locals.db;
	const rows = await db
		.select({ id: aiMessages.id, role: aiMessages.role, ownerId: aiConversations.userId })
		.from(aiMessages)
		.innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
		.where(eq(aiMessages.id, event.params.id))
		.limit(1);
	const row = rows[0];
	// Silent no-op on foreign/unknown/user-role targets: idempotent, no existence oracle.
	if (row && row.ownerId === user.id && row.role === 'assistant') {
		await db.update(aiMessages).set({ feedback: parsed.data.feedback }).where(eq(aiMessages.id, row.id));
	}
	return json({ ok: true });
};
```

- [ ] **Step 4: Verify**

Run: `npm run check` → 0 errors. Run: `npm test` → green.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/routes/api/ai/conversations/ src/routes/api/ai/messages/
git commit -m "feat: conversation list/detail/delete and message feedback endpoints"
```

---

### Task 6: Sidebar state module + chat components

**Files:**
- Create: `src/lib/ask/conversations.svelte.ts`
- Create: `src/lib/components/chat/ConversationSidebar.svelte`
- Create: `src/lib/components/chat/ChatMessageRow.svelte`

**Interfaces:**
- Consumes: `ConversationSummary`/`ConversationListResponse`/`ChatMessage` (`$lib/ai/payload`), `timeAgo` (`$lib/time`), `AskAnswer.svelte`.
- Produces:
  - `conversations` singleton (`$lib/ask/conversations.svelte`): `list: ConversationSummary[]`, `hasMore`, `loading`, `errorMessage`, `load()`, `loadMore()`, `prepend(c: ConversationSummary)`, `touch(id: string, updatedAt: number)`, `remove(id: string): Promise<boolean>` (optimistic, rolls back, returns success).
  - `ConversationSidebar.svelte` props: `{ activeId: string | null }`. Handles delete internally (navigates to `/ask` when the active conversation is deleted).
  - `ChatMessageRow.svelte` props: `{ message: ChatMessage }`. Renders one persisted message (user bubble / assistant via `AskAnswer` + copy + 👍/👎; `error` status → muted placeholder, no action buttons; `truncated` → "cut short" note). Mutates `message.feedback` optimistically (deep `$state` proxy from the parent's array).

These components compile standalone this task (nothing routes to them until Task 7), so `npm run check` is the gate.

- [ ] **Step 1: State module**

Create `src/lib/ask/conversations.svelte.ts` (pattern: `src/lib/bookmarks.svelte.ts`):

```ts
import type { ConversationListResponse, ConversationSummary } from '$lib/ai/payload';

/** Sidebar conversation list. Optimistic delete, silent-degrading fetches. */
class ConversationsState {
	list = $state<ConversationSummary[]>([]);
	hasMore = $state(false);
	loading = $state(true);
	loadingMore = $state(false);
	errorMessage = $state<string | null>(null);

	async #fetchPage(before: number | null): Promise<ConversationListResponse | null> {
		try {
			const res = await fetch(
				before === null ? '/api/ai/conversations' : `/api/ai/conversations?before=${before}`
			);
			if (!res.ok) return null;
			return (await res.json()) as ConversationListResponse;
		} catch {
			return null;
		}
	}

	async load(): Promise<void> {
		this.loading = true;
		const page = await this.#fetchPage(null);
		this.loading = false;
		if (!page) {
			this.errorMessage = "Couldn't load your conversations.";
			return;
		}
		this.errorMessage = null;
		// A conversation may have been prepended while the fetch was in flight — keep it.
		const ids = new Set(this.list.map((c) => c.id));
		this.list = [...this.list, ...page.conversations.filter((c) => !ids.has(c.id))];
		this.hasMore = page.hasMore;
	}

	async loadMore(): Promise<void> {
		if (this.loadingMore || this.list.length === 0) return;
		this.loadingMore = true;
		const page = await this.#fetchPage(this.list[this.list.length - 1].updatedAt);
		this.loadingMore = false;
		if (!page) {
			this.errorMessage = "Couldn't load your conversations.";
			return;
		}
		this.errorMessage = null;
		this.list = [...this.list, ...page.conversations];
		this.hasMore = page.hasMore;
	}

	prepend(convo: ConversationSummary): void {
		this.list = [convo, ...this.list.filter((c) => c.id !== convo.id)];
	}

	/** Bump a conversation to the top after a new message. */
	touch(id: string, updatedAt: number): void {
		const convo = this.list.find((c) => c.id === id);
		if (!convo) return;
		this.list = [{ ...convo, updatedAt }, ...this.list.filter((c) => c.id !== id)];
	}

	async remove(id: string): Promise<boolean> {
		const prev = this.list;
		this.list = this.list.filter((c) => c.id !== id); // optimistic
		try {
			const res = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}`, {
				method: 'DELETE'
			});
			if (!res.ok) throw new Error(String(res.status));
			return true;
		} catch {
			this.list = prev; // rollback
			this.errorMessage = "Couldn't delete that conversation — try again.";
			return false;
		}
	}

	reset(): void {
		this.list = [];
		this.hasMore = false;
		this.loading = true;
		this.errorMessage = null;
	}
}

export const conversations = new ConversationsState();
```

- [ ] **Step 2: Sidebar component**

Create `src/lib/components/chat/ConversationSidebar.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { conversations } from '$lib/ask/conversations.svelte';
	import { timeAgo } from '$lib/time';

	let { activeId }: { activeId: string | null } = $props();

	async function remove(id: string) {
		const wasActive = id === activeId;
		const ok = await conversations.remove(id);
		if (ok && wasActive) void goto('/ask');
	}
</script>

<nav class="flex h-full flex-col" aria-label="Conversations">
	<a
		href="/ask"
		class="mx-3 mt-3 rounded-full bg-cardinal px-4 py-2 text-center text-xs font-semibold tracking-wider text-white uppercase hover:brightness-110"
	>
		+ New chat
	</a>
	{#if conversations.errorMessage}
		<p class="mx-3 mt-3 text-xs text-navy/50" role="alert">{conversations.errorMessage}</p>
	{/if}
	{#if conversations.loading}
		<div class="mx-3 mt-3 h-24 animate-pulse rounded-xl bg-white/10" aria-hidden="true"></div>
	{:else}
		<ul class="mt-2 flex-1 overflow-y-auto px-1">
			{#each conversations.list as convo (convo.id)}
				<li class="group relative">
					<a
						href="/ask/{convo.id}"
						aria-current={convo.id === activeId ? 'page' : undefined}
						class="block rounded-lg px-3 py-2 pr-9 text-sm hover:bg-navy/5 {convo.id === activeId
							? 'bg-navy/10 font-semibold'
							: ''}"
					>
						<span class="block truncate">{convo.title}</span>
						<span class="text-xs text-navy/40">{timeAgo(convo.updatedAt)}</span>
					</a>
					<button
						type="button"
						aria-label="Delete conversation: {convo.title}"
						onclick={() => remove(convo.id)}
						class="absolute top-2 right-2 rounded p-1 text-navy/40 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-cardinal"
					>
						✕
					</button>
				</li>
			{/each}
		</ul>
		{#if conversations.hasMore}
			<button
				type="button"
				disabled={conversations.loadingMore}
				onclick={() => conversations.loadMore()}
				class="mx-3 my-3 text-xs font-semibold tracking-wider text-navy/50 uppercase hover:text-navy disabled:opacity-40"
			>
				{conversations.loadingMore ? 'Loading…' : 'Load more'}
			</button>
		{/if}
	{/if}
</nav>
```

- [ ] **Step 3: Message row component**

Create `src/lib/components/chat/ChatMessageRow.svelte`:

```svelte
<script lang="ts">
	import type { ChatMessage } from '$lib/ai/payload';
	import AskAnswer from '$lib/components/AskAnswer.svelte';

	let { message }: { message: ChatMessage } = $props();

	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(message.content);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard unavailable — ignore */
		}
	}

	async function setFeedback(value: 'up' | 'down') {
		const prev = message.feedback;
		const next = prev === value ? null : value;
		message.feedback = next; // optimistic; parent's $state array is a deep proxy
		try {
			const res = await fetch(`/api/ai/messages/${encodeURIComponent(message.id)}/feedback`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ feedback: next })
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			message.feedback = prev;
		}
	}
</script>

{#if message.role === 'user'}
	<div class="flex justify-end">
		<p class="max-w-[85%] rounded-2xl bg-navy px-4 py-2.5 text-[15px] whitespace-pre-wrap text-white">
			{message.content}
		</p>
	</div>
{:else if message.status === 'error'}
	<p class="text-sm text-navy/50 italic">No answer — the assistant was unavailable.</p>
{:else}
	<div>
		<AskAnswer answer={message.content} />
		{#if message.status === 'truncated'}
			<p class="mt-2 text-xs text-navy/50 italic">This answer was cut short.</p>
		{/if}
		<div class="mt-2 flex items-center gap-3">
			<button
				type="button"
				onclick={copy}
				class="text-xs font-semibold tracking-wider text-navy/50 uppercase hover:text-navy"
			>
				{copied ? 'Copied' : 'Copy'}
			</button>
			<button
				type="button"
				aria-label="Good answer"
				aria-pressed={message.feedback === 'up'}
				onclick={() => setFeedback('up')}
				class="rounded p-1 {message.feedback === 'up' ? 'text-cardinal' : 'text-navy/40 hover:text-navy'}"
			>
				👍
			</button>
			<button
				type="button"
				aria-label="Bad answer"
				aria-pressed={message.feedback === 'down'}
				onclick={() => setFeedback('down')}
				class="rounded p-1 {message.feedback === 'down' ? 'text-cardinal' : 'text-navy/40 hover:text-navy'}"
			>
				👎
			</button>
		</div>
	</div>
{/if}
```

Note: `AskAnswer`'s markup starts with `class="mt-3 …"` — that top margin is fine inside the message flow; don't modify `AskAnswer`.

- [ ] **Step 4: Verify and commit**

Run: `npm run check` → 0 errors. Run: `npm test` → green.

```bash
npm run format
git add src/lib/ask/ src/lib/components/chat/
git commit -m "feat: conversation sidebar state and chat message components"
```

---

### Task 7: Route cutover — layout + `[[id]]` chat page; delete old page

**Files:**
- Create: `src/routes/ask/+layout.svelte`
- Create: `src/routes/ask/[[id]]/+page.svelte`
- Delete: `src/routes/ask/+page.svelte`, `src/lib/components/AskHistory.svelte`
- Modify: `src/lib/ai/payload.ts` (remove now-dead exports: `AskPayload`, `AskPayloadSchema`, `ASK_MAX_PROMPT_CHARS`, `AskHistoryEntry`, `AskHistoryResponse`)

**Interfaces:**
- Consumes: everything from Tasks 2–6; `latestThoughtHeadline` (`$lib/ai/thoughts`); `authClient`; `AskAnswer` for the streaming answer; `replaceState` from `$app/navigation`; `page` from `$app/state`.
- Produces: the shipped UI. `/ask` (new chat) and `/ask/<id>` (existing) render through one page component; the layout owns the session gate, sidebar, and mobile drawer.

Key mechanics for the implementer:
- `src/routes/ask/+page.svelte` MUST be deleted in the same commit that adds `src/routes/ask/[[id]]/+page.svelte` — they conflict (both match `/ask`) and the dev server/`npm run check` will error if both exist.
- Shallow routing: after the first send completes, `replaceState('/ask/' + id, {})` updates the URL **without** navigation — `page.params.id` does NOT change, which is why the page tracks `activeId` in its own state and only reacts to *real* param changes (sidebar clicks, back/forward, hard loads) via the `lastParam` guard below.

- [ ] **Step 1: Layout with session gate + sidebar shell**

Create `src/routes/ask/+layout.svelte`:

```svelte
<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { conversations } from '$lib/ask/conversations.svelte';
	import { authClient } from '$lib/auth-client';
	import ConversationSidebar from '$lib/components/chat/ConversationSidebar.svelte';

	let { children }: { children: Snippet } = $props();

	let user = $state<{ name: string } | null>(null);
	let sessionReady = $state(false);
	let drawerOpen = $state(false);
	let listLoaded = false;

	const activeId = $derived(page.params.id ?? null);

	onMount(() => {
		const store = authClient.useSession();
		return store.subscribe((s) => {
			user = s.data?.user ?? null;
			if (!s.isPending) sessionReady = true;
		});
	});

	$effect(() => {
		if (user && !listLoaded) {
			listLoaded = true;
			void conversations.load();
		}
	});

	// Close the mobile drawer on any navigation.
	$effect(() => {
		void page.url.pathname;
		drawerOpen = false;
	});

	function signIn() {
		void authClient.signIn.social({ provider: 'google', callbackURL: '/ask' });
	}
</script>

<svelte:head><title>Ask · Best Perspective</title></svelte:head>

{#if !sessionReady}
	<div class="mx-auto mt-16 h-40 max-w-3xl animate-pulse rounded-xl bg-white/10" aria-hidden="true"></div>
{:else if !user}
	<section class="animate-fade-up mx-auto max-w-3xl px-4 py-10 sm:px-6">
		<div class="card mt-8 p-8 text-center">
			<h2 class="display text-2xl">Sign in to use the ask feature</h2>
			<button
				type="button"
				onclick={signIn}
				class="mt-6 rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
			>
				Sign in with Google
			</button>
		</div>
	</section>
{:else}
	<div class="animate-fade-up mx-auto flex h-[calc(100dvh-8rem)] max-w-6xl gap-4 px-4 py-6 sm:px-6">
		<aside class="card hidden w-64 shrink-0 overflow-hidden lg:block">
			<ConversationSidebar {activeId} />
		</aside>
		{#if drawerOpen}
			<div class="fixed inset-0 z-40 lg:hidden">
				<button
					type="button"
					aria-label="Close conversation list"
					onclick={() => (drawerOpen = false)}
					class="absolute inset-0 bg-navy/40"
				></button>
				<aside class="card absolute inset-y-0 left-0 z-50 w-72 overflow-hidden rounded-r-xl">
					<ConversationSidebar {activeId} />
				</aside>
			</div>
		{/if}
		<main class="flex min-w-0 flex-1 flex-col">
			<button
				type="button"
				onclick={() => (drawerOpen = true)}
				class="mb-2 self-start rounded-lg border border-mist px-3 py-1.5 text-xs font-semibold tracking-wider text-navy/60 uppercase lg:hidden"
			>
				☰ Chats
			</button>
			{@render children()}
		</main>
	</div>
{/if}
```

- [ ] **Step 2: The chat page**

Create `src/routes/ask/[[id]]/+page.svelte`:

```svelte
<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import {
		CHAT_MAX_MESSAGE_CHARS,
		CONVERSATION_MESSAGE_CAP,
		deriveTitle,
		type ChatMessage,
		type ConversationDetail
	} from '$lib/ai/payload';
	import { latestThoughtHeadline } from '$lib/ai/thoughts';
	import { conversations } from '$lib/ask/conversations.svelte';
	import AskAnswer from '$lib/components/AskAnswer.svelte';
	import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';

	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let phase = $state<'idle' | 'streaming'>('idle');
	let streamingText = $state('');
	let thoughts = $state('');
	let errorMessage = $state<string | null>(null);
	let remaining = $state<number | null>(null);
	let loadingConvo = $state(false);
	let notFound = $state(false);
	let activeId = $state<string | null>(null);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let scrollEl = $state<HTMLElement | null>(null);

	const thoughtHeadline = $derived(latestThoughtHeadline(thoughts));
	const full = $derived(messages.length >= CONVERSATION_MESSAGE_CAP);

	// React to REAL route changes only (sidebar clicks, back/forward, hard loads).
	// replaceState after the first send changes the URL but not page.params, so it
	// never re-enters here — that's what keeps streaming state alive.
	let lastParam: string | null | undefined = undefined;
	$effect(() => {
		const param = page.params.id ?? null;
		if (param === lastParam) return;
		lastParam = param;
		activeId = param;
		errorMessage = null;
		streamingText = '';
		thoughts = '';
		phase = 'idle';
		if (param) void loadConversation(param);
		else {
			messages = [];
			notFound = false;
		}
	});

	async function loadConversation(id: string) {
		loadingConvo = true;
		notFound = false;
		try {
			const res = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}`);
			if (res.status === 404) {
				notFound = true;
				messages = [];
				return;
			}
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as ConversationDetail;
			messages = data.messages;
			scrollToEnd();
		} catch {
			errorMessage = "Couldn't load this conversation — try again.";
		} finally {
			loadingConvo = false;
		}
	}

	function scrollToEnd() {
		requestAnimationFrame(() => scrollEl?.scrollTo({ top: scrollEl.scrollHeight }));
	}

	async function send(event?: SubmitEvent) {
		event?.preventDefault();
		const text = input.trim();
		if (text.length < 3 || phase === 'streaming' || full) return;
		phase = 'streaming';
		errorMessage = null;
		streamingText = '';
		thoughts = '';
		messages = [
			...messages,
			{ id: `local-${crypto.randomUUID()}`, role: 'user', content: text, status: null, feedback: null, createdAt: Date.now() }
		];
		input = '';
		scrollToEnd();
		let truncated = false;
		try {
			const res = await fetch('/api/ai/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message: text, ...(activeId ? { conversationId: activeId } : {}) })
			});
			if (!res.ok || !res.body) {
				const serverMessage = (await res.json().catch(() => null))?.message;
				errorMessage =
					res.status === 429 || res.status === 400
						? (serverMessage ?? 'That message could not be sent.')
						: res.status === 503
							? 'AI features are offline right now.'
							: res.status === 401
								? 'Your session expired — sign in again.'
								: res.status === 404
									? 'Conversation not found — start a new chat.'
									: 'The rules assistant is unavailable — try again in a minute.';
				messages = messages.slice(0, -1); // roll back the optimistic user bubble
				input = text; // keep the message for retry
				phase = 'idle';
				return;
			}
			const remainingHeader = res.headers.get('x-bp-ai-remaining');
			if (remainingHeader !== null) remaining = Number(remainingHeader);
			const conversationId = res.headers.get('x-bp-conversation-id');
			const messageId = res.headers.get('x-bp-message-id');
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let lineBuffer = '';
			const handleLine = (line: string) => {
				if (!line) return;
				let msg: { t?: string; text?: string };
				try {
					msg = JSON.parse(line);
				} catch {
					return;
				}
				if (msg.t === 'think') thoughts += msg.text ?? '';
				else if (msg.t === 'text') streamingText += msg.text ?? '';
				else if (msg.t === 'truncated') truncated = true;
			};
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				lineBuffer += decoder.decode(value, { stream: true });
				let newline: number;
				while ((newline = lineBuffer.indexOf('\n')) !== -1) {
					handleLine(lineBuffer.slice(0, newline));
					lineBuffer = lineBuffer.slice(newline + 1);
				}
			}
			lineBuffer += decoder.decode();
			handleLine(lineBuffer);
			if (!streamingText.trim()) {
				errorMessage = 'No answer came back — try again.';
				phase = 'idle';
				return;
			}
			messages = [
				...messages,
				{
					id: messageId ?? `local-${crypto.randomUUID()}`,
					role: 'assistant',
					content: streamingText,
					status: truncated ? 'truncated' : 'complete',
					feedback: null,
					createdAt: Date.now()
				}
			];
			if (truncated) errorMessage = 'The answer was cut short — try asking again.';
			streamingText = '';
			phase = 'idle';
			if (!activeId && conversationId) {
				activeId = conversationId;
				replaceState(`/ask/${conversationId}`, {});
				conversations.prepend({ id: conversationId, title: deriveTitle(text), updatedAt: Date.now() });
			} else if (activeId) {
				conversations.touch(activeId, Date.now());
			}
			scrollToEnd();
		} catch {
			if (streamingText) {
				messages = [
					...messages,
					{ id: `local-${crypto.randomUUID()}`, role: 'assistant', content: streamingText, status: 'complete', feedback: null, createdAt: Date.now() }
				];
				errorMessage = 'The connection dropped mid-answer — what arrived is shown above.';
			} else {
				messages = messages.slice(0, -1);
				errorMessage = 'Network error — try again.';
			}
			streamingText = '';
			phase = 'idle';
		}
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		// Cmd/Ctrl+Enter inserts a newline; Shift+Enter keeps its native newline; bare Enter sends.
		if (event.metaKey || event.ctrlKey) {
			event.preventDefault();
			const el = event.currentTarget as HTMLTextAreaElement;
			el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
			input = el.value;
			return;
		}
		if (event.shiftKey) return;
		event.preventDefault();
		void send();
	}
</script>

{#if notFound}
	<div class="card p-8 text-center">
		<h2 class="display text-xl">Conversation not found</h2>
		<a href="/ask" class="mt-4 inline-block text-sm font-semibold text-cardinal hover:underline">
			Start a new chat
		</a>
	</div>
{:else}
	<section bind:this={scrollEl} class="flex-1 space-y-5 overflow-y-auto pb-4" aria-label="Messages">
		{#if loadingConvo}
			<div class="h-32 animate-pulse rounded-xl bg-white/10" aria-hidden="true"></div>
		{:else if messages.length === 0 && phase === 'idle'}
			<div class="card p-8 text-center text-sm text-navy/60">
				Ask anything about the rules — answers cite the rulebook.
			</div>
		{/if}
		{#each messages as message (message.id)}
			<ChatMessageRow {message} />
		{/each}
		{#if phase === 'streaming'}
			{#if !streamingText}
				<p class="flex items-center gap-2 text-sm text-navy/50 italic">
					<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-cardinal/60" aria-hidden="true"></span>
					{thoughtHeadline ? `Thinking — ${thoughtHeadline}` : 'Thinking…'}
				</p>
			{:else}
				<AskAnswer answer={streamingText} streaming={true} />
			{/if}
		{/if}
	</section>

	<div class="card mt-2 p-4">
		{#if errorMessage}
			<p class="mb-2 text-sm font-semibold text-cardinal" role="alert">{errorMessage}</p>
		{/if}
		{#if full}
			<p class="text-sm text-navy/60">
				This conversation is full —
				<a href="/ask" class="font-semibold text-cardinal hover:underline">start a new chat</a>.
			</p>
		{:else}
			<form onsubmit={send} class="flex items-end gap-3">
				<textarea
					bind:this={textareaEl}
					bind:value={input}
					onkeydown={onKeydown}
					maxlength={CHAT_MAX_MESSAGE_CHARS}
					rows="2"
					placeholder="Ask about the rules…"
					aria-label="Your message"
					class="min-h-0 flex-1 resize-none rounded-lg border border-mist p-3 text-sm focus:border-navy/50 focus:outline-none"
				></textarea>
				<button
					type="submit"
					disabled={phase === 'streaming' || input.trim().length < 3}
					class="rounded-full bg-cardinal px-5 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110 disabled:opacity-40"
				>
					Send
				</button>
			</form>
			<p class="mt-2 text-xs text-navy/50">
				{#if remaining !== null}
					{remaining} question{remaining === 1 ? '' : 's'} left today
				{:else}
					Ask is powered by AI which can make mistakes.
				{/if}
			</p>
		{/if}
	</div>
{/if}
```

- [ ] **Step 3: Delete the old page and history component; clean payload.ts**

```bash
git rm src/routes/ask/+page.svelte src/lib/components/AskHistory.svelte
```

In `src/lib/ai/payload.ts`, delete the `AskPayload` interface, `AskPayloadSchema`, `ASK_MAX_PROMPT_CHARS`, `AskHistoryEntry`, and `AskHistoryResponse` exports (grep first — after the deletions above nothing should import them; if something still does, stop and report).

- [ ] **Step 4: Verify**

Run: `npm run check` → 0 errors (route conflict would surface here).
Run: `npm test` → green.
Optional smoke: `npm run dev`, sign in with the test credentials, send a message (needs `GEMINI_API_KEY`; without it expect the 503 copy — that still proves the page wiring).
Do NOT run the full ai.spec.ts e2e — its ask/history sections are stale until Task 8.

- [ ] **Step 5: Commit**

```bash
npm run format
git add -A src/routes/ask src/lib/components src/lib/ai/payload.ts
git commit -m "feat: chat UI with sidebar, per-conversation pages, copy and feedback"
```

---

### Task 8: E2E rework + README

**Files:**
- Modify: `e2e/ai.spec.ts` — replace the `ask the rules` and `ask history` describe blocks (keep `scenario mode` and the shared helpers/imports at top, including `execSync` and the `d1`/`d1Select` helpers from the seeded test; move those helpers to module scope if they were local)
- Modify: `README.md` — AI features section

**Interfaces:**
- Consumes: the shipped feature; `signUpTestUser`; the local-D1 `wrangler d1 execute` seeding pattern already in the file.

Test strategy: mock `POST /api/ai/chat` (no Gemini in e2e); run conversations/feedback endpoints REAL against seeded D1 rows. Glob note: `**/api/ai/chat` does not match `/api/ai/conversations…` — no cross-mock bleed.

- [ ] **Step 1: Replace the two describe blocks**

New `ask the rules (chat)` block:

```ts
const CHAT_STREAM = (convoId: string, messageId: string) => ({
	status: 200,
	headers: {
		'content-type': 'application/x-ndjson; charset=utf-8',
		'x-bp-ai-remaining': '9',
		'x-bp-conversation-id': convoId,
		'x-bp-message-id': messageId
	},
	body: '{"t":"think","text":"**Checking the stall rules**"}\n{"t":"text","text":"Yes — per [15.D] that is a turnover. "}\n{"t":"text","text":"[99.ZZ] is not a real rule."}\n'
});

test.describe('ask the rules (chat)', () => {
	test('signed out: sign-in gate, no message box', async ({ page }) => {
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
		await expect(page.getByRole('textbox')).toHaveCount(0);
	});

	test('send streams an answer, URL becomes /ask/<id>, sidebar lists it, follow-up appends', async ({
		page
	}) => {
		await signUpTestUser(page, 'chat');
		let calls = 0;
		await page.route('**/api/ai/chat', (route) => {
			calls += 1;
			return route.fulfill(CHAT_STREAM('mock-convo-1', `mock-msg-${calls}`));
		});
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
		const link = page.getByRole('link', { name: '15.D' }).first();
		await expect(link).toHaveAttribute('href', '/rules/usau-official-2026-27/15#15.D');
		await expect(page).toHaveURL(/\/ask\/mock-convo-1$/);
		await expect(
			page.getByRole('navigation', { name: 'Conversations' }).getByText(/is it a stall at ten\?/i)
		).toBeVisible();
		await expect(page.getByText(/9 questions left today/)).toBeVisible();

		// Follow-up appends in place (still 1 page, now 2 exchanges).
		await page.getByRole('textbox', { name: 'Your message' }).fill('And what about nine?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText('And what about nine?')).toBeVisible();
		await expect(page.getByText(/that is a turnover/)).toHaveCount(2);
	});

	test('copy and feedback controls respond', async ({ page }) => {
		await signUpTestUser(page, 'chat-actions');
		await page.route('**/api/ai/chat', (route) => route.fulfill(CHAT_STREAM('mock-convo-2', 'mock-msg-a')));
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
		await page.getByRole('button', { name: /^copy$/i }).click();
		await expect(page.getByRole('button', { name: /^copied$/i })).toBeVisible();
		const thumbsUp = page.getByRole('button', { name: 'Good answer' });
		await thumbsUp.click();
		await expect(thumbsUp).toHaveAttribute('aria-pressed', 'true');
	});

	test('daily limit: 429 message shows, typed message is preserved', async ({ page }) => {
		await signUpTestUser(page, 'chat-limit');
		await page.route('**/api/ai/chat', (route) =>
			route.fulfill({
				status: 429,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Daily question limit reached — try again tomorrow' })
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/daily question limit reached/i)).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Your message' })).toHaveValue(
			'Is it a stall at ten?'
		);
	});

	test('Enter sends; Cmd/Ctrl+Enter inserts a newline instead', async ({ page }) => {
		await signUpTestUser(page, 'chat-keys');
		await page.route('**/api/ai/chat', (route) => route.fulfill(CHAT_STREAM('mock-convo-3', 'mock-msg-k')));
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		const box = page.getByRole('textbox', { name: 'Your message' });
		await box.fill('First line');
		await box.press('ControlOrMeta+Enter');
		await expect(box).toHaveValue('First line\n');
		await box.pressSequentially('second line');
		await box.press('Enter');
		await expect(page.getByText(/that is a turnover/)).toBeVisible();
	});
});
```

New `conversation history (seeded D1)` block — adapt the existing `d1`/`d1Select` helpers and seeding style; seed under fixed `seedc-` ids wiped at test start:

```ts
test.describe('conversation history (seeded D1)', () => {
	test('seeded rows: real list scopes and paginates; detail loads; DELETE soft-deletes; feedback writes', async ({
		page
	}) => {
		const { email } = await signUpTestUser(page, 'chat-db');
		d1(`DELETE FROM ai_messages WHERE id LIKE 'seedc-%'`);
		d1(`DELETE FROM ai_conversations WHERE id LIKE 'seedc-%'`);
		const userId = (d1Select(`SELECT id FROM user WHERE email = '${email}'`)[0] as { id: string }).id;
		d1(
			`INSERT OR IGNORE INTO user (id, name, email, email_verified) VALUES ('seedc-other-user', 'Other', 'seedc-other@example.com', 1)`
		);
		const base = Date.now();
		// 21 visible conversations forces pagination past the 20-row page.
		const convoValues: string[] = [];
		const msgValues: string[] = [];
		for (let i = 1; i <= 21; i++) {
			convoValues.push(
				`('seedc-v${i}', '${userId}', 'usau-official-2026-27', 'Seeded convo ${i}', ${base - i * 1000}, ${base - i * 1000}, NULL)`
			);
			msgValues.push(
				`('seedc-v${i}-u', 'seedc-v${i}', 'user', 'Seeded question ${i}', NULL, NULL, NULL, ${base - i * 1000})`,
				`('seedc-v${i}-a', 'seedc-v${i}', 'assistant', 'Seeded answer ${i} [15.D]', 'complete', 'seed', NULL, ${base - i * 1000 + 1})`
			);
		}
		// Deleted convo NEWEST of this user's rows (falsifiable filter check) + another user's convo.
		convoValues.push(
			`('seedc-del', '${userId}', 'usau-official-2026-27', 'Deleted convo', ${base - 100}, ${base - 100}, ${base})`,
			`('seedc-other', 'seedc-other-user', 'usau-official-2026-27', 'Other users convo', ${base - 200}, ${base - 200}, NULL)`
		);
		msgValues.push(
			`('seedc-other-a', 'seedc-other', 'assistant', 'Foreign answer', 'complete', 'seed', NULL, ${base - 200})`
		);
		d1(
			`INSERT INTO ai_conversations (id, user_id, ruleset_id, title, created_at, updated_at, deleted_at) VALUES ${convoValues.join(', ')}`
		);
		d1(
			`INSERT INTO ai_messages (id, conversation_id, role, content, status, model, feedback, created_at) VALUES ${msgValues.join(', ')}`
		);

		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		const sidebar = page.getByRole('navigation', { name: 'Conversations' });
		await expect(sidebar.getByText('Seeded convo 1', { exact: true })).toBeVisible();
		await expect(sidebar.getByText('Deleted convo')).toHaveCount(0);
		await expect(sidebar.getByText('Other users convo')).toHaveCount(0);
		await expect(sidebar.getByText('Seeded convo 21', { exact: true })).toHaveCount(0); // beyond page 1
		await sidebar.getByRole('button', { name: 'Load more' }).click();
		await expect(sidebar.getByText('Seeded convo 21', { exact: true })).toBeVisible();
		await expect(sidebar.getByRole('button', { name: 'Load more' })).toHaveCount(0);

		// Detail page loads real messages; feedback writes to the DB.
		await sidebar.getByText('Seeded convo 2', { exact: true }).click();
		await expect(page.getByText('Seeded question 2')).toBeVisible();
		await expect(page.getByText(/Seeded answer 2/)).toBeVisible();
		await page.getByRole('button', { name: 'Good answer' }).click();
		await expect
			.poll(() => (d1Select(`SELECT feedback FROM ai_messages WHERE id = 'seedc-v2-a'`)[0] as { feedback: string | null }).feedback)
			.toBe('up');

		// Real soft delete persists across reload; row still exists with deleted_at set.
		await sidebar.getByRole('button', { name: 'Delete conversation: Seeded convo 2' }).click();
		await expect(page).toHaveURL(/\/ask$/); // deleting the open conversation navigates home
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(sidebar.getByText('Seeded convo 2', { exact: true })).toHaveCount(0);
		const del = d1Select(`SELECT deleted_at FROM ai_conversations WHERE id = 'seedc-v2'`)[0] as {
			deleted_at: number | null;
		};
		expect(del.deleted_at).not.toBeNull();

		// Owner scoping negatives: foreign delete and foreign feedback are silent no-ops.
		const delRes = await page.request.delete('/api/ai/conversations/seedc-other');
		expect(delRes.ok()).toBeTruthy();
		expect(
			(d1Select(`SELECT deleted_at FROM ai_conversations WHERE id = 'seedc-other'`)[0] as { deleted_at: number | null }).deleted_at
		).toBeNull();
		const fbRes = await page.request.post('/api/ai/messages/seedc-other-a/feedback', {
			data: { feedback: 'down' }
		});
		expect(fbRes.ok()).toBeTruthy();
		expect(
			(d1Select(`SELECT feedback FROM ai_messages WHERE id = 'seedc-other-a'`)[0] as { feedback: string | null }).feedback
		).toBeNull();

		// Foreign conversation page → not-found state.
		await page.goto('/ask/seedc-other');
		await page.waitForLoadState('networkidle');
		await expect(page.getByText('Conversation not found')).toBeVisible();
	});
});
```

Adjust helper scoping/locators to what actually renders — but do not weaken what the assertions prove (scoping, deleted-filter falsifiability, real pagination, DB-level soft-delete and feedback checks, owner-scoping negatives).

- [ ] **Step 2: Run the e2e suite (twice)**

Run: `npx playwright test e2e/ai.spec.ts` — twice.
Expected: all tests pass both runs (4 scenario + 5 chat + 1 seeded).

- [ ] **Step 3: Update the README**

Replace the `- **Ask**` bullet under "AI features" with:

```markdown
- **Ask** (`/ask`, `POST /api/ai/chat`) — multi-turn chat over the rulebook; answers cite specific rules. Conversations live in a sidebar (`GET /api/ai/conversations`), open at `/ask/<id>`, support message copy and 👍/👎 feedback (`POST /api/ai/messages/<id>/feedback`), and delete softly (`DELETE /api/ai/conversations/<id>`). Every message sent counts against the daily ask quota; conversations cap at 25 messages.
```

- [ ] **Step 4: Full verification + commit**

Run: `npm test && npm run check && npm run lint` → all green.

```bash
npm run format
git add e2e/ai.spec.ts README.md
git commit -m "test: e2e coverage for chat; document chat endpoints in README"
```
