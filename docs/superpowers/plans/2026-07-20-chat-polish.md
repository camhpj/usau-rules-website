# Chat Polish (Rough Edges) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four rough edges found in owner smoke testing: New chat must always give a fresh view (even before a pending send's headers arrive), a new conversation must appear in the sidebar the instant Send is clicked, and stopping a chat before any answer text must not leave a "the assistant was unavailable" row.

**Architecture:** (1) The `/ask/[[id]]` page's view reset moves from a `page.params` diffing `$effect` to SvelteKit's `afterNavigate`, which fires on every completed navigation — including same-URL ones like clicking "New chat" while already on `/ask` — while the URL-adoption `replaceState` (not a navigation) still never resets the view. (2) `chatStream.send` prepends an optimistic `pending` sidebar entry at send-time and resolves it to the real conversation id at headers-time (drops it on pre-header failure). (3) `statusForStream` returns `null` for a cancelled stream with no answer text; the chat route then skips the assistant insert (keeping the `updatedAt` bump), so `error` rows once again always mean a real failure.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Vitest 4, Playwright e2e.

## Global Constraints

- No new dependencies. No schema changes or migrations.
- Owner decisions (2026-07-20): optimistic client-side sidebar entry (no server restructure); a cancelled stream with no answer text persists NO assistant row (not a new status value).
- Comments must not reference intra-PR history ("we used to…") — describe present behavior only.
- Copy strings unchanged; new pending-entry timestamp copy (verbatim): "Sending…".
- Existing behavior that must not regress: URL adoption via `replaceState` after a blank-view send; completed-map pickup with message-id dedupe; stop settles silently; concurrent streams (cap 3).
- Verification: `npm run test`, `npm run check`, `npm run lint`, `npx playwright test e2e/ai.spec.ts`.
- Commit style: conventional commits.

## File Map

- Modify: `src/routes/ask/[[id]]/+page.svelte` — afterNavigate reset (Task 1)
- Modify: `e2e/ai.spec.ts` — New-chat-during-pending-send tests (Task 1); pending sidebar entry test (Task 2)
- Modify: `src/lib/ai/payload.ts` — optional `pending` on `ConversationSummary` (Task 2)
- Modify: `src/lib/ask/conversations.svelte.ts` — `resolve`/`drop` (Task 2)
- Modify: `src/lib/ask/chat-stream.svelte.ts` — optimistic entry lifecycle (Task 2)
- Modify: `src/lib/components/chat/ConversationSidebar.svelte` — pending rendering (Task 2)
- Modify: `src/lib/server/ai/chat.ts` + `src/lib/server/ai/chat.test.ts` — nullable status (Task 3)
- Modify: `src/routes/api/ai/chat/+server.ts` — skip insert on null status (Task 3)

---

### Task 1: New chat always resets the view (afterNavigate)

**Files:**
- Modify: `src/routes/ask/[[id]]/+page.svelte`
- Test: `e2e/ai.spec.ts`

**Why:** The current route-change `$effect` compares `page.params.id` against `lastParam`, so navigating `/ask` → `/ask` (New chat while a blank-view send is pending, or after stopping one) is invisible: the view keeps its messages and — because `myToken` isn't regenerated — still owns the in-flight job, showing Stop instead of a fresh composer.

**Interfaces:**
- Consumes: `afterNavigate` from `$app/navigation` (fires after every completed navigation, including same-URL navigations and initial mount; NOT fired by `replaceState`).
- Produces: no API changes; `lastParam` and the `page` import are deleted.

- [ ] **Step 1: Replace the route-change effect**

In `src/routes/ask/[[id]]/+page.svelte`:

1. Change the imports: `import { afterNavigate, replaceState } from '$app/navigation';` and DELETE `import { page } from '$app/state';` (nothing else uses `page` after this change).
2. Delete the `let lastParam …` declaration, the whole route-change `$effect` (the one reading `page.url` / `page.params.id`), and its leading comment block.
3. In the same position add:

```ts
// Reset the view on every completed navigation — including same-URL ones,
// like clicking "New chat" while already on a blank /ask with a send in
// flight (a params compare would miss those). Also runs once on mount. URL
// adoption below uses replaceState, which is not a navigation, so adopting
// an id never resets the view.
afterNavigate((nav) => {
	const param = nav.to?.params?.id ?? null;
	viewGeneration += 1;
	myToken = Symbol(); // a background send from the old view must not adopt this view's URL
	activeId = param;
	errorMessage = null;
	messages = []; // clear immediately so a conversation switch never flashes the old thread
	notFound = false;
	loadingConvo = false;
	if (param) void loadConversation(param);
});
```

4. In the URL-adoption `$effect`, delete the line `lastParam = cid;` and its trailing comment (nothing resyncs anymore — there is no `lastParam`).

- [ ] **Step 2: Add the two e2e regressions (write first, watch them fail on the old code if convenient — the suite must pass at the end)**

In `e2e/ai.spec.ts`, following the file's existing mock/helper patterns (`signUpTestUser`, delayed `route.fulfill` as used by "an in-flight answer survives navigating away and back"):

Test A — "new chat gives a fresh composer while a send is still pending":
1. Sign up; intercept `POST /api/ai/chat` with a fulfill delayed behind a manually-resolved promise (do not resolve yet).
2. Fill and send "Where does a pull start from?" on `/ask`; expect the user bubble visible and the Stop button visible.
3. Click the "New chat" link; expect the user bubble is GONE, the Send button (not Stop) is visible, and the URL is `/ask`.
4. Resolve the delayed fulfill (headers for the background send arrive); expect a sidebar entry appears; expect the composer of the current view still shows Send (the background job must not attach to the new view).

Test B — "new chat clears a stopped pre-headers send":
1. Sign up; intercept `POST /api/ai/chat` so it never fulfills until aborted (`route.fulfill` guarded so an abort doesn't throw — `.catch(() => {})`).
2. Send a message; click Stop while still pending (no headers).
3. Click "New chat"; expect the user bubble is gone and the composer is fresh (Send visible, textarea empty).

- [ ] **Step 3: Run the gates**

Run: `npx playwright test e2e/ai.spec.ts` (all pass, including the 15 existing), `npm run check`, `npm run lint`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/ask/[[id]]/+page.svelte e2e/ai.spec.ts
git commit -m "fix: new chat resets the view even while a send is pending"
```

---

### Task 2: Optimistic sidebar entry at send-time

**Files:**
- Modify: `src/lib/ai/payload.ts`, `src/lib/ask/conversations.svelte.ts`, `src/lib/ask/chat-stream.svelte.ts`, `src/lib/components/chat/ConversationSidebar.svelte`
- Test: `e2e/ai.spec.ts`

**Why:** The sidebar prepend currently happens at headers-time, and the server doesn't send headers until the Gemini stream opens — so a new conversation appears only once Gemini responds. The entry should appear the instant Send is clicked.

**Interfaces:**
- Consumes: `conversations.prepend` (existing), `deriveTitle` (already imported in chat-stream).
- Produces: `ConversationSummary.pending?: boolean` (client-only flag); `conversations.resolve(tempId, convo)`; `conversations.drop(id)`. Job temp keys (`new-<uuid>`) double as optimistic entry ids.

- [ ] **Step 1: Extend the types and store**

In `src/lib/ai/payload.ts`, add to `ConversationSummary`:

```ts
/** Client-only: optimistic sidebar entry awaiting its server id. */
pending?: boolean;
```

In `src/lib/ask/conversations.svelte.ts`, add below `touch`:

```ts
/** Swap an optimistic entry for the server's real conversation, in place. */
resolve(tempId: string, convo: ConversationSummary): void {
	this.list = this.list.map((c) => (c.id === tempId ? convo : c));
}

/** Remove a local-only entry (no server call). */
drop(id: string): void {
	this.list = this.list.filter((c) => c.id !== id);
}
```

- [ ] **Step 2: Wire the lifecycle in `chatStream.send`**

In `src/lib/ask/chat-stream.svelte.ts`:

1. Immediately after `this.jobs.set(key, job);` add:

```ts
if (!opts.conversationId) {
	// Optimistic sidebar entry; resolved to the real id at headers-time. If the
	// send dies before headers the entry is dropped — the server may still have
	// persisted the conversation, in which case the next full sidebar load
	// surfaces it.
	conversations.prepend({ id: key, title: deriveTitle(text), updatedAt: Date.now(), pending: true });
}
```

2. Replace the headers-time block:

```ts
if (cid && !opts.conversationId) {
	// The server has persisted the conversation — swap in its real id.
	job.conversationId = cid;
	conversations.resolve(key, { id: cid, title: deriveTitle(text), updatedAt: Date.now() });
} else if (cid) {
	conversations.touch(cid, Date.now());
}
```

3. In the `!res.ok || !res.body` branch, before `this.#settle(job);` add:

```ts
if (!opts.conversationId) conversations.drop(key);
```

4. In the outer `catch`, at the top (before the `job.streamingText.trim()` check) add:

```ts
// Pre-headers death (stop or network): the optimistic entry has no real id.
if (!opts.conversationId && !messageId) conversations.drop(key);
```

- [ ] **Step 3: Render pending entries**

In `src/lib/components/chat/ConversationSidebar.svelte`, inside the `{#each}` `<li>`, wrap the existing anchor + hover-gradient + delete button in `{#if !convo.pending}` and add the pending branch (no link, no delete, same footprint):

```svelte
{#if convo.pending}
	<div class="block rounded-lg px-3 py-2 text-sm text-navy/70">
		<span class="block truncate">{convo.title}</span>
		<span class="text-xs text-navy/40">Sending…</span>
	</div>
{:else}
	<!-- existing <a>, gradient div, and delete button, unchanged -->
{/if}
```

- [ ] **Step 4: e2e regression**

In `e2e/ai.spec.ts` add "a new conversation appears in the sidebar the moment it is sent": delayed-fulfill `POST /api/ai/chat` (unresolved); send a message from `/ask`; expect a sidebar entry with the derived title and the text "Sending…" BEFORE resolving; resolve; expect the entry becomes a link (`role: 'link'`) to `/ask/<id>` and "Sending…" disappears. On mobile-width-only sidebars use the existing pattern for opening the Conversations nav if the file's other sidebar assertions do so.

- [ ] **Step 5: Run the gates**

Run: `npx playwright test e2e/ai.spec.ts`, `npm run check`, `npm run lint`, `npm run test` (payload type change touches unit-tested modules).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/payload.ts src/lib/ask/conversations.svelte.ts src/lib/ask/chat-stream.svelte.ts src/lib/components/chat/ConversationSidebar.svelte e2e/ai.spec.ts
git commit -m "feat: optimistic sidebar entry the moment a new chat is sent"
```

---

### Task 3: Stopped-with-no-answer leaves no assistant row

**Files:**
- Modify: `src/lib/server/ai/chat.ts`, `src/routes/api/ai/chat/+server.ts`
- Test: `src/lib/server/ai/chat.test.ts`

**Why:** A cancelled stream with no answer text currently persists an empty `error` row, which renders as "No answer — the assistant was unavailable." after reload — inaccurate for a deliberate Stop. Owner decision: persist nothing for that case; `error` rows then always mean a real failure.

**Interfaces:**
- Produces: `statusForStream(outcome, answerText): 'complete' | 'truncated' | 'error' | null` — `null` means "persist no assistant row".

- [ ] **Step 1: Failing tests**

In `src/lib/server/ai/chat.test.ts`, update/add in the `statusForStream` block:

```ts
it('persists nothing for a cancelled stream with no answer text', () => {
	expect(statusForStream('cancelled', '')).toBeNull();
	expect(statusForStream('cancelled', '  \n')).toBeNull();
});

it('still records an error row when a non-cancelled stream produced no text', () => {
	expect(statusForStream('error', '')).toBe('error');
	expect(statusForStream('complete', '')).toBe('error');
	expect(statusForStream('truncated', '')).toBe('error');
});
```

Adjust any existing case asserting `statusForStream('cancelled', '') === 'error'`.

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run src/lib/server/ai/chat.test.ts` — expect the cancelled-null cases to FAIL.

- [ ] **Step 3: Implement**

In `src/lib/server/ai/chat.ts`:

```ts
/**
 * DB status for a finished stream, or null when no assistant row should be
 * persisted. Partial answers are worth keeping — an errored or cancelled
 * stream that produced text persists as truncated. A stream that ends with
 * no answer text persists as an error row — except a cancelled one: the
 * client walked away before any answer existed, so the transcript keeps
 * only the user's question.
 */
export function statusForStream(
	outcome: StreamOutcome,
	answerText: string
): 'complete' | 'truncated' | 'error' | null {
	if (!answerText.trim()) return outcome === 'cancelled' ? null : 'error';
	if (outcome === 'error' || outcome === 'cancelled') return 'truncated';
	return outcome;
}
```

In `src/routes/api/ai/chat/+server.ts`, change `persistAssistant` to accept `'complete' | 'truncated' | 'error' | null` and guard the insert (the `updatedAt` bump still runs — the user message is real activity):

```ts
const persistAssistant = async (status: 'complete' | 'truncated' | 'error' | null) => {
	try {
		const at = Date.now();
		if (status !== null) {
			await db.insert(aiMessages).values({
				id: assistantMessageId,
				conversationId,
				role: 'assistant',
				content: status === 'error' ? '' : answerText,
				status,
				model: GEMINI_MODEL,
				createdAt: at
			});
		}
		await db
			.update(aiConversations)
			.set({ updatedAt: at })
			.where(eq(aiConversations.id, conversationId));
	} catch (cause) {
		console.error('chat: failed to persist assistant message', cause);
	}
};
```

The pre-stream failure path keeps calling `persistAssistant('error')` unchanged.

- [ ] **Step 4: Run the gates**

Run: `npm run test`, `npm run check`, `npm run lint`. (No e2e change: the pure logic is unit-covered and the route diff is a null-guard.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/ai/chat.ts src/lib/server/ai/chat.test.ts src/routes/api/ai/chat/+server.ts
git commit -m "fix: a stopped chat with no answer leaves no assistant row"
```

---

## Final verification

- `npm run test`, `npm run check`, `npm run lint`, `npx playwright test e2e/ai.spec.ts` all green.
- Owner manual checks: New chat mid-send gives a fresh composer; New chat after a pre-headers Stop clears the bubble; sidebar entry appears the instant Send is clicked ("Sending…" → link); stop-before-any-text then reload shows only the question, no "unavailable" row.
- Do NOT push — owner verifies locally first.
