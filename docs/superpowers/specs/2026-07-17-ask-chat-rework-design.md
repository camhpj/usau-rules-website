# Ask chat rework — design

**Date:** 2026-07-17
**Status:** Approved approach; pending implementation plan
**Supersedes:** the history UI portion of `2026-07-16-ask-history-design.md`. Built on
top of the unmerged `feat/ask-history` branch, reworking its UI and endpoints in
place; its backend groundwork (soft-delete concept, seeded-D1 e2e pattern,
`AskAnswer.svelte`, `timeAgo`) carries forward.

## Goal

Turn `/ask` from a one-shot Q&A page into a complete multi-turn chat feature:
a conversation sidebar, dedicated per-conversation pages, follow-up messages
grounded in the rulebook, message copy and 👍/👎 feedback, and soft-deletable
conversations — on a data model built for conversations from the start, with
existing `ai_asks` data migrated in and the old table dropped.

## Decisions (from brainstorming)

- **Full chat build now** — not a UI-only restructure. Chat box, streaming with
  the existing thinking/loading animation, copy button, per-message feedback,
  conversation history with soft delete.
- **Proper conversation schema, migrate, drop** — no retrofitting `ai_asks`.
  Existing rows become 1-exchange conversations; `ai_asks` is then dropped.
- **Quota: per message.** Every message sent (new conversation or follow-up)
  consumes 1 ask from the existing caps (10/day/user, 200/day global,
  `ai_usage` unchanged). No new quota machinery.
- **Layout: sidebar chat app.** Conversation list in a left sidebar on desktop,
  slide-over drawer on mobile; chat pane at `/ask` (new) and `/ask/[id]`
  (existing conversation).
- **Signed-in only**, unchanged from today.

## Data model

New migration (`drizzle/0005_ask-chat.sql`) creates two tables, migrates, and
drops `ai_asks`.

### `ai_conversations`

| column      | type              | notes                                                    |
| ----------- | ----------------- | -------------------------------------------------------- |
| `id`        | text PK           | uuid                                                     |
| `userId`    | text FK → user.id | cascade delete                                           |
| `rulesetId` | text              | conversation is pinned to one ruleset                    |
| `title`     | text              | first user message, truncated to 80 chars                |
| `createdAt` | integer           | ms epoch                                                 |
| `updatedAt` | integer           | ms epoch of last message; drives sidebar ordering        |
| `deletedAt` | integer nullable  | soft delete; NULL = visible                              |

Index: `(userId, updatedAt)`.

### `ai_messages`

| column           | type                 | notes                                                  |
| ---------------- | -------------------- | ------------------------------------------------------ |
| `id`             | text PK              | uuid; public id used by the feedback endpoint          |
| `conversationId` | text FK → ai_conversations.id | cascade delete                                |
| `role`           | text enum            | `user` \| `assistant`                                  |
| `content`        | text                 | message text; empty string allowed for error rows      |
| `status`         | text enum nullable   | assistant only: `complete` \| `truncated` \| `error`   |
| `model`          | text nullable        | assistant only; per message so mid-conversation model changes stay accurate |
| `feedback`       | text enum nullable   | assistant only: `up` \| `down`; NULL = none            |
| `createdAt`      | integer              | ms epoch                                               |

Index: `(conversationId, createdAt)`.

Denormalization rationale (deliberate): `title` and `updatedAt` on the
conversation keep the sidebar query a single index scan with no join or
aggregate; the ~80-char duplication is the cheap side of that trade.

### Migration of existing data

In the same migration, per `ai_asks` row with `status != 'error'`:

1. Insert a conversation: fresh uuid, same `userId`/`rulesetId`,
   `title = substr(prompt, 1, 80)`, `createdAt = updatedAt = created_at`,
   `deletedAt = hidden_at` (already-deleted history stays deleted).
2. Insert two messages: the user message (`role='user'`, `content=prompt`,
   `createdAt = created_at`) and the assistant message (`role='assistant'`,
   `content=answer`, `status` mapped `answered`→`complete` /
   `truncated`→`truncated`, `model` copied, `createdAt = created_at + 1` so
   ordering is stable).

`error` rows are skipped: they have no answer to show, and a conversation whose
only exchange is a dead end isn't worth the UI state. Data volume is small; the
loss is accepted. After copying, `DROP TABLE ai_asks`.

The migration is plain SQL (`INSERT INTO … SELECT` with
`lower(hex(randomblob(16)))`-style ids or equivalent); it must be runnable by
`wrangler d1 migrations apply` on both local and remote with no app code.

## API

All endpoints signed-in only via `requireUser` (401 signed out), following the
existing endpoint patterns. The Task-3 endpoints `GET/DELETE /api/ai/asks` and
the old `POST /api/ai/ask` are **removed**.

### `POST /api/ai/chat` (streaming; replaces `/api/ai/ask`)

Body (Zod): `{ conversationId?: uuid, message: string (3–500 chars), rulesetId?: string }`.

- No `conversationId` → create the conversation (title from the message;
  `rulesetId` defaults to `DEFAULT_RULESET_ID`). With `conversationId` → must
  be owned by the caller and not deleted, else 404 (no existence oracle);
  `rulesetId` in the body is ignored in favor of the conversation's.
- **Guardrail:** if the conversation already has ≥ 25 messages, 400 with a
  friendly "This conversation is full — start a new one" message.
- Consumes 1 ask from the existing quotas (same 429 messages as today).
- Persists the user message before calling Gemini. Builds the request as:
  system policy + cached rulebook grounding (existing context-cache machinery,
  unchanged) + prior conversation turns in order + the new message.
- Streams ndjson exactly like today (`think` / `text` / `truncated` frames);
  same retry-once-then-502 behavior before the stream opens. On stream close,
  persists the assistant message (`complete`/`truncated`) and bumps the
  conversation's `updatedAt`. On the 502 path, persists an assistant message
  with `status='error'`, `content=''`.
- Response headers: `x-bp-conversation-id`, `x-bp-message-id` (the assistant
  message's id, generated up front like today's `askId`), `x-bp-ai-remaining`.

### `GET /api/ai/conversations`

Sidebar list: `{ conversations: [{ id, title, updatedAt }], hasMore }`,
`userId`-scoped, `deletedAt IS NULL`, ordered `updatedAt DESC`,
cursor-paginated (`before` = ms cursor against `updatedAt`, `limit` default
20 clamp 1–50) reusing the Task-2 `parseHistoryQuery`/`pageRows` helpers.

### `GET /api/ai/conversations/[id]`

Full conversation: `{ id, title, rulesetId, messages: [{ id, role, content,
status, feedback, createdAt }] }`, ordered by `createdAt`. Owner-scoped and not
deleted, else 404.

### `DELETE /api/ai/conversations/[id]`

Soft delete: sets `deletedAt` where owner matches and not already deleted.
Always `{ ok: true }` (idempotent, no existence oracle).

### `POST /api/ai/messages/[id]/feedback`

Body: `{ feedback: 'up' | 'down' | null }` (null clears). Updates the message
only if it's an assistant message in a conversation owned by the caller
(join); always `{ ok: true }`.

## UI

`/ask` and `/ask/[id]` share a chat shell component:

- **Sidebar** (desktop; slide-over drawer behind a hamburger on mobile):
  "+ New chat" link to `/ask`, conversation rows (title, `timeAgo(updatedAt)`,
  active-row highlight, delete button per row — no confirmation, matching
  today's delete). "Load more" when `hasMore`. Deleting the open conversation
  navigates to `/ask`. Empty list renders just "+ New chat".
- **Chat pane:** user messages right-aligned in bubbles; assistant messages
  rendered through the existing `AskAnswer` (citation links preserved);
  `status='error'` assistant messages render instead as a muted "No answer —
  the assistant was unavailable" placeholder (no copy/feedback buttons);
  `truncated` ones get the existing "cut short" note. Normal messages get a
  **copy** button (copies raw answer text, brief "Copied" confirmation) and
  **👍/👎** toggle buttons (active state visible; clicking the active one
  clears). Streaming state reuses the current pulse + "Thinking — {headline}"
  animation and the in-text cursor.
- **Input:** textarea pinned below the messages; Enter sends, Shift+Enter
  newline, Cmd/Ctrl+Enter newline (today's behavior); disabled while
  streaming; same 500-char cap; remaining-questions counter and error messages
  in the same styles as today. At the 25-message guardrail the input is
  replaced with a "Start a new chat" prompt.
- **Flow:** sending from `/ask` streams in place, then updates the URL to
  `/ask/<id>` (from `x-bp-conversation-id`) without a reload and prepends the
  conversation to the sidebar. Sending a follow-up on `/ask/[id]` appends both
  messages optimistically. Failed sends surface the existing error copy; the
  typed message stays in the input for retry.
- `/ask/[id]` loads the conversation client-side (matching the page's existing
  client-side auth pattern); unknown/foreign/deleted id → inline "Conversation
  not found" state with a link back to `/ask`.
- `AskHistory.svelte` and the "Previous questions" section are deleted.

## Error handling

- History/sidebar fetch failures degrade to muted inline messages and never
  block sending a new message.
- Feedback/copy/delete failures: muted inline notice; optimistic UI reverts on
  delete failure (as today).
- Mid-stream disconnect: rendered partial answer stays visible with the
  existing "connection dropped" copy; the server still persists what it
  received via the stream-close observer.

## Testing

- **Unit (Vitest):** title derivation/truncation, transcript-assembly helper
  (ordering, role mapping), guardrail predicate, plus the existing
  pagination-helper tests carried forward.
- **E2E (Playwright), reworking `e2e/ai.spec.ts`'s ask sections:**
  - Mocked `POST /api/ai/chat`: send → stream renders → URL becomes
    `/ask/<id>` → sidebar shows the conversation; follow-up appends; copy and
    👍/👎 interact (feedback endpoint real or mocked as convenient).
  - Seeded-D1 test (pattern from `feat/ask-history`): seed conversations +
    messages incl. a deleted one and another user's; assert real
    `GET /api/ai/conversations` scoping/filtering/pagination, real
    conversation-page load, real DELETE soft-delete persistence (DB-level
    check), real feedback write, and owner-scoping negative cases.
  - Migration sanity: after `db:migrate:local`, previously seeded `ai_asks`
    fixtures appear as conversations (covered implicitly by running migrations
    in the e2e webServer boot against a seeded state, or a focused check).
- **README:** AI features section rewritten for the chat model.

## Out of scope

- Conversation renaming, search, sharing, export.
- AI-generated conversation titles.
- Regenerate-answer / edit-message.
- Cross-ruleset switching inside a conversation.
- Admin/quality dashboards over the feedback data.
