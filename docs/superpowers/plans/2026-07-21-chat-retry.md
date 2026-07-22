# Chat Retry (Regenerate In Place) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Failed assistant rows render "Something went wrong" with a Retry button that regenerates the answer in place: the server deletes the failed row and streams a fresh answer to the same question, leaving a clean transcript (question → answer).

**Architecture:** The chat endpoint gains a retry mode (`{conversationId, retry: true}` body, discriminated by a new Zod schema): it validates that the conversation's last row is a failed assistant row via a pure `pickRetryTarget` helper, deletes that row, and streams a regeneration of the preceding user question through the existing pipeline (quota, watchdog, persistence all unchanged). The client store's `send` gains a `retry` option that posts that body; the page removes the failed bubble optimistically and reuses the normal streaming UI; `ChatMessageRow` renders the new copy and shows Retry only on the conversation's last message while nothing is streaming.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Cloudflare Workers (D1 via drizzle), Zod, Vitest 4, Playwright e2e.

## Global Constraints

- No new dependencies. No schema/table changes.
- Owner decision (2026-07-21): regenerate in place — the failed row is deleted server-side; retry consumes a quota unit like any generation.
- Copy strings (verbatim): failed-row text "Something went wrong" (no trailing period); button label "Retry".
- Retry is only offered on the LAST message of a conversation, only when it is an assistant row with status 'error', and only while no stream is active for the current view.
- A conversation at the message cap may still retry (net row count is unchanged); the cap check applies only to normal sends.
- Comments must not reference intra-PR history — describe present behavior only.
- Must not regress: optimistic sidebar entries, afterNavigate view reset, completed-map pickup, concurrent streams (cap 3), stop semantics.
- Verification: `npm run test`, `npm run check`, `npm run lint`, `npm run test:e2e -- e2e/ai.spec.ts`.
- Commit style: conventional commits.

## File Map

- Modify: `src/lib/ai/payload.ts` — `ChatRetryPayload` + schema (Task 1)
- Modify: `src/lib/server/ai/chat.ts` + `chat.test.ts` — `pickRetryTarget` (Task 1)
- Modify: `src/routes/api/ai/chat/+server.ts` — retry branch (Task 1)
- Modify: `src/lib/ask/chat-stream.svelte.ts` — `retry` send option (Task 2)
- Modify: `src/lib/components/chat/ChatMessageRow.svelte` — copy + Retry button (Task 2)
- Modify: `src/routes/ask/[[id]]/+page.svelte` — retry handler + last-row wiring (Task 2)
- Modify: `e2e/ai.spec.ts` — retry e2e; update the old-copy assertion (Task 2)

---

### Task 1: Server retry mode

**Files:**
- Modify: `src/lib/ai/payload.ts`, `src/lib/server/ai/chat.ts`, `src/routes/api/ai/chat/+server.ts`
- Test: `src/lib/server/ai/chat.test.ts`

**Interfaces:**
- Produces: `ChatRetryPayloadSchema` (`{conversationId: string, retry: true}`); `pickRetryTarget(rows): RetryTarget | null` where `RetryTarget = {errorRowId: string, question: string, prior: StoredTurn[]}`. POST `/api/ai/chat` accepts the retry body and responds with the identical streaming contract (same headers, same NDJSON).

- [ ] **Step 1: Failing tests for `pickRetryTarget`**

In `src/lib/server/ai/chat.test.ts` add (adapt the import line to include `pickRetryTarget`):

```ts
describe('pickRetryTarget', () => {
	const u = (id: string, content: string) => ({ id, role: 'user' as const, content, status: null });
	const a = (id: string, content: string, status: string | null) => ({
		id,
		role: 'assistant' as const,
		content,
		status
	});

	it('targets a trailing failed row and the question before it', () => {
		const rows = [u('m1', 'first?'), a('m2', 'answer', 'complete'), u('m3', 'second?'), a('m4', '', 'error')];
		expect(pickRetryTarget(rows)).toEqual({
			errorRowId: 'm4',
			question: 'second?',
			prior: [u('m1', 'first?'), a('m2', 'answer', 'complete')]
		});
	});

	it('returns null when the conversation does not end in a failed row', () => {
		expect(pickRetryTarget([])).toBeNull();
		expect(pickRetryTarget([u('m1', 'q?')])).toBeNull(); // stopped-with-no-answer leaves no row
		expect(pickRetryTarget([u('m1', 'q?'), a('m2', 'fine', 'complete')])).toBeNull();
		expect(pickRetryTarget([u('m1', 'q?'), a('m2', 'partial', 'truncated')])).toBeNull();
	});

	it('returns null when no user question precedes the failed row', () => {
		expect(pickRetryTarget([a('m1', '', 'error')])).toBeNull();
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/server/ai/chat.test.ts` — expect FAIL: `pickRetryTarget` is not exported.

- [ ] **Step 3: Implement the helper and schema**

In `src/lib/server/ai/chat.ts` add:

```ts
export interface RetryTarget {
	/** The failed assistant row a retry deletes before regenerating. */
	errorRowId: string;
	/** The user question being regenerated. */
	question: string;
	/** Rows preceding the question, for priorTurns assembly. */
	prior: StoredTurn[];
}

/**
 * Locate what a retry regenerates: the conversation's last row must be a
 * failed assistant row with a user question somewhere before it. Returns
 * null when the transcript doesn't end in a retryable failure.
 */
export function pickRetryTarget(rows: (StoredTurn & { id: string })[]): RetryTarget | null {
	const last = rows[rows.length - 1];
	if (!last || last.role !== 'assistant' || last.status !== 'error') return null;
	for (let i = rows.length - 2; i >= 0; i--) {
		if (rows[i].role === 'user') {
			return { errorRowId: last.id, question: rows[i].content, prior: rows.slice(0, i) };
		}
	}
	return null;
}
```

In `src/lib/ai/payload.ts`, below `ChatPayloadSchema`:

```ts
/** Regenerate the answer to a conversation's trailing failed exchange. */
export interface ChatRetryPayload {
	conversationId: string;
	retry: true;
}

export const ChatRetryPayloadSchema: z.ZodType<ChatRetryPayload> = z.object({
	// NOT z.string().uuid(): migrated conversations have derived ids like 'conv-<uuid>'.
	conversationId: z.string().min(1).max(64),
	retry: z.literal(true)
});
```

- [ ] **Step 4: Wire the route**

In `src/routes/api/ai/chat/+server.ts` (import `ChatRetryPayloadSchema` from `$lib/ai/payload` and `pickRetryTarget`, `type RetryTarget` from `$lib/server/ai/chat`):

1. Replace the body parse with a discriminated parse:

```ts
const raw = await event.request.json().catch(() => null);
const retryParse = ChatRetryPayloadSchema.safeParse(raw);
let userMessage: string | null = null; // null in retry mode
let existingId: string | null;
if (retryParse.success) {
	existingId = retryParse.data.conversationId;
} else {
	const parsed = ChatPayloadSchema.safeParse(raw);
	if (!parsed.success) error(400, 'invalid message');
	userMessage = parsed.data.message;
	existingId = parsed.data.conversationId ?? null;
}
```

2. In the existing-conversation branch, select `id` alongside `role`/`content`/`status` for the prior rows, then split by mode:

```ts
let retryTarget: RetryTarget | null = null;
if (retryParse.success) {
	retryTarget = pickRetryTarget(prior);
	if (!retryTarget) error(400, 'Nothing to retry in this conversation');
	priorTurns = toGeminiTurns(retryTarget.prior);
} else {
	if (prior.length >= CONVERSATION_MESSAGE_CAP)
		error(400, 'This conversation is full — start a new one');
	priorTurns = toGeminiTurns(prior);
}
```

(The new-conversation `else` branch requires `userMessage !== null` by construction — a retry body always carries a conversationId, so a retry can never reach it.)

3. In the persistence section, branch on mode — a retry deletes the failed row instead of inserting; the regenerated answer takes its place via the unchanged `persistAssistant`:

```ts
const now = Date.now();
const conversationId = existingId ?? crypto.randomUUID();
if (retryTarget) {
	await db.delete(aiMessages).where(eq(aiMessages.id, retryTarget.errorRowId));
} else {
	if (!existingId) {
		/* existing conversation-insert block, unchanged */
	}
	/* existing user-message insert block, unchanged, using userMessage! */
}
```

4. Task prompt: `taskPrompt: buildAskPrompt(retryTarget ? retryTarget.question : userMessage!)`. Title derivation (`deriveTitle(parsed.data.message)`) becomes `deriveTitle(userMessage!)` inside the new-conversation insert.

Everything else — ownership check, quota, grounding, streamText retry-once, observer, headers — stays exactly as is.

- [ ] **Step 5: Run the gates**

Run: `npm run test` (expect prior count + 3 new passing), `npm run check`, `npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/payload.ts src/lib/server/ai/chat.ts src/lib/server/ai/chat.test.ts src/routes/api/ai/chat/+server.ts
git commit -m "feat: chat retry mode regenerates a failed answer in place"
```

---

### Task 2: Client — copy, Retry button, regenerate flow

**Files:**
- Modify: `src/lib/ask/chat-stream.svelte.ts`, `src/lib/components/chat/ChatMessageRow.svelte`, `src/routes/ask/[[id]]/+page.svelte`
- Test: `e2e/ai.spec.ts`

**Interfaces:**
- Consumes: Task 1's retry body `{conversationId, retry: true}` on POST `/api/ai/chat`.
- Produces: `chatStream.send(text, {conversationId, viewToken, retry?: boolean})` — with `retry: true`, `text` is ignored and the retry body is posted; `ChatMessageRow` prop `onretry?: (() => void) | null`.

- [ ] **Step 1: Store option**

In `src/lib/ask/chat-stream.svelte.ts`, widen the options type to `{ conversationId: string | null; viewToken: symbol; retry?: boolean }` and change only the fetch body:

```ts
body: JSON.stringify(
	opts.retry
		? { conversationId: opts.conversationId, retry: true }
		: { message: text, ...(opts.conversationId ? { conversationId: opts.conversationId } : {}) }
),
```

Nothing else changes: a retry always has a conversationId, so the optimistic-entry branch never fires for it, and the guards/streaming/settle paths are identical.

- [ ] **Step 2: ChatMessageRow copy + button**

In `src/lib/components/chat/ChatMessageRow.svelte`, add the prop and replace the error branch:

```svelte
let { message, onretry = null }: { message: ChatMessage; onretry?: (() => void) | null } = $props();
```

```svelte
{:else if message.status === 'error'}
	<div class="flex items-center gap-3">
		<p class="text-sm text-navy/50 italic">Something went wrong</p>
		{#if onretry}
			<button
				type="button"
				onclick={onretry}
				class="text-xs font-semibold tracking-wider text-cardinal uppercase hover:underline"
			>
				Retry
			</button>
		{/if}
	</div>
```

- [ ] **Step 3: Page wiring**

In `src/routes/ask/[[id]]/+page.svelte`:

1. Add derived state near `activeJob`:

```ts
const lastMessage = $derived(messages[messages.length - 1] ?? null);
const canRetry = $derived(
	!activeJob &&
		activeId !== null &&
		lastMessage?.role === 'assistant' &&
		lastMessage?.status === 'error'
);
```

2. Add the handler (near `send`):

```ts
async function retry() {
	if (!canRetry || !activeId) return;
	const gen = viewGeneration;
	const failedRow = messages[messages.length - 1];
	// The server deletes the failed row before regenerating — mirror it here.
	messages = messages.slice(0, -1);
	errorMessage = null;
	const result = await chatStream.send('', {
		conversationId: activeId,
		viewToken: myToken,
		retry: true
	});
	if (gen !== viewGeneration) return;
	if (result.kind === 'failed' || result.kind === 'rejected') {
		messages = [...messages, failedRow]; // the send never started; the row is still persisted
	}
	errorMessage = result.message;
}
```

3. Pass the callback only for the retryable last row:

```svelte
{#each messages as message (message.id)}
	<ChatMessageRow {message} onretry={canRetry && message.id === lastMessage?.id ? retry : null} />
{/each}
```

- [ ] **Step 4: e2e**

In `e2e/ai.spec.ts`:

1. Update the existing "error with no text shows unavailable bubble" test's copy assertion from "No answer — the assistant was unavailable." to "Something went wrong" (rename the test to match, e.g. "…shows the something-went-wrong bubble").
2. Add "retry regenerates a failed answer in place": route `POST /api/ai/chat` with a call counter — first call fulfills an error-only stream (headers + `{"t":"error"}` line), second call fulfills a normal success stream; also capture the second call's `route.request().postDataJSON()`. Send a message; expect "Something went wrong" and a "Retry" button. Click Retry; expect: the "Something went wrong" text is gone, the answer text is visible, exactly ONE user bubble with the original question exists (no duplicate), and the captured second body is `{conversationId: <id>, retry: true}` with no `message` field.

- [ ] **Step 5: Run the gates**

Run: `npm run test:e2e -- e2e/ai.spec.ts` (all green, including the two Task-1-independent suites), `npm run check`, `npm run lint`, `npm run test`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ask/chat-stream.svelte.ts src/lib/components/chat/ChatMessageRow.svelte src/routes/ask/[[id]]/+page.svelte e2e/ai.spec.ts
git commit -m "feat: something-went-wrong copy with in-place retry for failed answers"
```

---

## Final verification

- `npm run test`, `npm run check`, `npm run lint`, `npm run test:e2e -- e2e/ai.spec.ts` all green.
- Owner manual checks: force a failure (e.g. kill network mid-thinking or use an invalid API key), see "Something went wrong" + Retry; Retry streams a fresh answer and the transcript shows question → answer with no failed row after reload.
- Known accepted edge (documented here deliberately): if the retry request reaches the server but generation fails again pre-stream, the server has already deleted the old failed row and persists a NEW failed row with a fresh id, while the client restores its stale copy of the old bubble; the ids differ until the next reload. Error rows have no interactive affordances tied to their id, so this is cosmetic.
- Do NOT push — owner verifies locally first.
