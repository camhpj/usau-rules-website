# Ask history — design

**Date:** 2026-07-16
**Status:** Approved approach; pending implementation plan

## Goal

Let signed-in users see the questions they previously asked on `/ask`, re-read the
answers, re-ask a question, and remove entries they don't want to keep. The data
already exists: every ask is logged server-side to the `ai_asks` table (prompt,
answer, status, timestamp, indexed on `(user_id, created_at)`). This feature is a
read surface over that table plus a soft-delete flag.

## Decisions (from brainstorming)

- **Scope:** AI ask-the-rules history only (not quiz question history).
- **Placement:** a "Previous questions" section on `/ask` itself, below the ask
  form/answer area. No dashboard section for now.
- **Layout:** a collapsed list — each entry is a row showing the question and a
  relative timestamp; clicking expands it in place to show the full answer.
- **Actions per entry:** *Ask again* (prefills and focuses the ask textarea) and
  *Delete*.
- **Delete is soft:** the `ai_asks` row doubles as the owner's Q&A quality log
  (owner decision in the original AI spec), so deleting hides the entry from the
  user without removing the row.

## Defaults (approved)

- Only `status = 'answered'` and `status = 'truncated'` rows appear; `error` rows
  (no answer) are excluded server-side.
- Page size 10, newest first, with a **Load more** button (cursor pagination).
- Delete asks no confirmation. The row is only hidden server-side, but there is no
  UI to un-hide, so from the user's perspective it is gone.
- History is signed-in only, same as the rest of `/ask`.

## Data model

One additive column on `ai_asks`:

```
hiddenAt: integer('hidden_at')  // ms epoch; NULL = visible in the user's history
```

New Drizzle migration (`drizzle/0004_ask-history.sql`, generated with drizzle-kit,
matching the existing migration series). No new index: reads go through the
existing `ai_asks_user_created_idx` and filter `hidden_at IS NULL` on the (small,
per-user) scanned rows.

## API

Both endpoints follow the existing `/api/bookmarks` pattern: `requireUser(event)`,
Zod validation, Drizzle via `event.locals.db`, `json(...)` responses.

### `GET /api/ai/asks`

Query params (Zod-validated):

- `before` — optional ms-epoch cursor; return asks with `createdAt < before`.
- `limit` — optional, default 10, clamped to 1–50.

Filters: `userId = session user`, `hiddenAt IS NULL`, `status != 'error'`.
Order: `createdAt DESC`. Fetches `limit + 1` rows to compute `hasMore`.

Response:

```json
{
  "asks": [
    { "id": "…", "prompt": "…", "answer": "…", "status": "answered", "createdAt": 1731700000000 }
  ],
  "hasMore": true
}
```

The next page's cursor is the `createdAt` of the last returned ask. `createdAt` is
`Date.now()` at insert per user, so per-user ties are not a practical concern.
`rulesetId` and `model` stay server-side; the client doesn't need them (citation
links currently always resolve against `DEFAULT_RULESET_ID`, same as the live
answer path).

### `DELETE /api/ai/asks/[id]`

Sets `hiddenAt = Date.now()` where `id` matches AND `userId` is the session user.
Returns `{ ok: true }` whether or not a row matched (idempotent; no existence
oracle for other users' ask ids).

### `POST /api/ai/ask` (existing — one addition)

Adds an `x-bp-ask-id: <askId>` response header (the UUID is already generated
before streaming starts). This lets the client prepend the just-completed Q&A to
the history list with a real id so *Delete* works on it immediately without a
refetch.

## UI (`/ask` page)

### Shared answer component

Extract the current answer-rendering markup (citation `segmentCitations` segments
→ rule links via `refHref`, plus the streaming cursor) into a shared component,
e.g. `src/lib/components/AskAnswer.svelte`, with props for the answer text and a
`streaming` flag. Used by:

1. the existing live-answer card (unchanged behavior, including the streaming
   cursor), and
2. expanded history entries (static, no cursor).

This is the one refactor included in scope; it prevents duplicating the citation
markup.

### Previous questions section

Rendered below the ask form / answer card, only when signed in.

- On mount (once the session resolves to a signed-in user), fetch
  `GET /api/ai/asks`. While loading, show a small pulse skeleton consistent with
  the page's existing skeleton style. If the fetch fails, show a one-line muted
  error ("Couldn't load your previous questions."); never block the ask flow.
- If the user has no history, render nothing (no empty-state card).
- Each entry: a disclosure row (Bits UI or a native-style button consistent with
  existing page idioms) showing the question (truncated to one line when
  collapsed) and a relative timestamp ("2d ago"). Expanding shows the full
  question if it was truncated, the answer via `AskAnswer`, and for
  `truncated` status a small note that the answer was cut short.
- Expanded entries show two text buttons: **Ask again** (sets the textarea value
  to the entry's prompt, focuses it, scrolls it into view — does not auto-submit,
  since asks consume daily quota) and **Delete** (optimistically removes the
  entry from the list, calls `DELETE`; on failure, restores the entry and shows
  the muted error line).
- **Load more** appears while `hasMore` is true; appends the next page using the
  last entry's `createdAt` as `before`.
- When a live ask completes (`phase === 'done'` with a non-empty answer), prepend
  `{ id: <x-bp-ask-id>, prompt, answer, status, createdAt: Date.now() }` to the
  local list. If the header is missing (shouldn't happen, but cheap to guard),
  skip the prepend rather than inserting an undeletable entry.

Accessibility: the disclosure rows are buttons with `aria-expanded`; Delete/Ask
again are real buttons with descriptive labels.

## Error handling summary

- History endpoints 401 via `requireUser` like every other authed endpoint; the
  page only calls them when a session exists, so users shouldn't see this.
- GET/DELETE failures degrade to a muted inline message; the ask flow is never
  blocked by history failures.
- The ask endpoint's logging remains fire-and-forget; a failed log simply means
  the entry won't appear in history (already the accepted trade-off).

## Testing

- **Unit (Vitest), following existing API/server test patterns:**
  - GET: pagination (limit clamp, cursor, `hasMore`), filtering of hidden and
    `error` rows, user scoping.
  - DELETE: sets `hiddenAt` only for the owner's row; idempotent on missing ids.
  - Any extracted pure helpers (e.g. relative-time formatting if added).
- **E2E (Playwright):** extend the existing ask smoke coverage minimally — with
  the test sign-in, ask a question (existing flow), then assert it appears under
  "Previous questions", expands to show the answer, and disappears on delete.

## Out of scope

- History on `/me`, cross-ruleset citation resolution, un-delete, editing,
  search/filtering of history, and any signed-out history.
