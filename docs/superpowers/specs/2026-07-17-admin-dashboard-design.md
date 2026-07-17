# Admin dashboard — design

**Date:** 2026-07-17
**Status:** Approved approach; pending implementation plan
**Builds on:** the shipped ask-chat rework (`ai_conversations`, `ai_messages` with
`feedback`; `ai_asks` dropped in migration `0005_ask-chat.sql`). Reads the landed
AI tables directly; no schema changes.

## Goal

Give the site owner a private, read-only admin area for the three things they
actually need: **AI quality review** (read conversations, see 👍/👎, spot bad
answers and prompt-injection attempts), **usage & health metrics** (volume and
quality-rate tiles), and **raw data export** (per-table CSV). No user
moderation, no editing, no role-management UI.

## Decisions (from brainstorming)

- **Scope:** AI quality review + usage/health metrics + raw CSV export. User
  moderation / account editing / deletion is out.
- **Access gating:** env email allowlist (`ADMIN_EMAILS`), checked by a new
  `requireAdmin()` helper. No `role` column, no migration.
- **Metrics fidelity:** big-number stat tiles + simple tables + a few hand-rolled
  CSS/SVG mini bar rows. **No charting library.**
- **Export:** per-dataset CSV download, each **capped** at a max row count
  (newest-first); the UI flags when a dataset was truncated.
- **Single spec:** metrics + AI review + export ship together (the ask-chat
  rework it depends on has already landed).

## Architecture

Server-rendered `/admin` section inside the existing SvelteKit app. All data is
fetched in server `load` functions and export endpoints — raw rows never reach
the client except as rendered HTML or a downloaded file. Fits the existing
stack (SvelteKit on Cloudflare, D1 + Drizzle, better-auth); no new dependencies.

### Access gating

- New `requireAdmin(event)` in `src/lib/server/session.ts`, mirroring
  `requireUser`: resolve the session, then check the signed-in `user.email`
  (lower-cased, trimmed) against the parsed `ADMIN_EMAILS` env var
  (comma-separated, case-insensitive). Returns the user on success.
- **Failure mode: 404, not 403** — for signed-out users and signed-in
  non-admins alike. The admin area does not advertise its own existence. A small
  `parseAdminEmails(raw)` helper is unit-testable in isolation.
- `ADMIN_EMAILS` added to `wrangler.jsonc` `vars` and `.dev.vars`
  (e.g. `camhpjohnson@gmail.com`). When unset/empty, `requireAdmin` denies
  everyone (fail closed).
- Gate applied in `/admin/+layout.server.ts` (covers every page) **and**
  independently at the top of every export endpoint (defense in depth — export
  endpoints are not under the page layout).

### Routes

```
src/routes/admin/
  +layout.server.ts        # requireAdmin → 404 on failure
  +layout.svelte           # minimal admin nav (Dashboard | AI review | Export)
  +page.server.ts          # metric aggregates
  +page.svelte             # stat tiles + tables + mini bar rows
  ai/
    +page.server.ts        # conversation list (+ ?down=1 filter, ?before= cursor)
    +page.svelte           # conversation table
    [id]/
      +page.server.ts      # one conversation, owner-agnostic (admin sees all)
      +page.svelte         # full transcript
  export/
    +page.server.ts        # per-dataset row counts (for "capped" flags)
    +page.svelte           # download buttons
    [dataset].csv/+server.ts  # gated CSV stream, capped; serves /admin/export/<slug>.csv
```

## Metrics dashboard (`/admin`)

`+page.server.ts` runs a small set of Drizzle aggregate queries (all cheap,
index-backed where relevant). Rendered as big-number tiles grouped into
sections, plus a 14-day mini bar row for daily asks and daily sign-ups.

**Volume**
- Total users; new users last 7 / 30 days (`user.createdAt`).
- Total conversations; total messages (`ai_conversations`, `ai_messages`).
- Quiz attempts total; last 7 days; split by mode (`quiz_attempts.mode`).
- Asks today / last 7 days (`ai_usage` where `kind='ask'`).

**AI quality & health rates** (the signals worth watching)
- Assistant-message feedback: 👍 count, 👎 count, and 👎 ratio over messages
  that have any feedback (`ai_messages.feedback`).
- Assistant-message `truncated` and `error` rates over all assistant messages
  (`ai_messages.status`) — degraded-answer signal.
- AI-question fallback rate: `fallback` vs `served` over `ai_questions.status`
  — how often generation falls back to the bank.
- Quota hits: count of `(day,user,kind)` rows in `ai_usage` at/over the daily
  per-user cap in the last 7 days — latent demand signal. (Cap constant reused
  from the existing AI config, not re-hardcoded.)

**14-day mini rows**
- Daily asks (sum of `ai_usage.count` where `kind='ask'`, grouped by `day`).
- Daily sign-ups (`user.createdAt` bucketed by UTC day).
Rendered as inline CSS/`<div>` bars (max-normalized), no SVG library.

Where a date bucket is needed, use the same UTC-day convention `ai_usage.day`
already uses, computed in SQL (`strftime`/`date(createdAt/1000,'unixepoch')`),
so buckets line up across tables.

## AI quality review (`/admin/ai`)

- **List:** recent conversations newest-first (`updatedAt DESC`), including
  soft-deleted ones (admin sees everything; a deleted row is badged "deleted").
  Columns: title, user email (join `user`), ruleset, message count, a "👎"
  badge if any assistant message in the conversation has `feedback='down'`,
  `timeAgo(updatedAt)`. Cursor-paginated with the existing history-pagination
  helpers (`before` against `updatedAt`, default limit ~30).
- **Filter:** `?down=1` narrows to conversations containing at least one 👎
  message (toggle link in the UI).
- **Transcript (`/admin/ai/[id]`):** full ordered message list. User messages
  right-aligned as today; assistant messages rendered through the existing
  `AskAnswer` component (citations preserved); each assistant message shows its
  `status` (`truncated`/`error` badges) and `feedback` state. This is the
  curation surface — reading real Q&A, seeing where the model was thumbed down,
  and spotting prompt-injection attempts in user messages. Read-only: no
  feedback controls, no delete.
- Unknown id → 404 (via the shared gate + a not-found check).

## Export (`/admin/export` + `[dataset].csv/+server.ts`)

- **Datasets:** `conversations`, `messages`, `quiz-attempts`,
  `question-responses`, `users`, `ai-usage`. A single `DATASETS` registry maps
  each slug → the Drizzle query (newest-first) and the ordered column list, so
  the page and the endpoint stay in sync.
- **Endpoint** `GET /admin/export/[dataset].csv`:
  - `requireAdmin` first (independent of the page layout).
  - Unknown slug → 404.
  - Streams `text/csv` with `Content-Disposition: attachment; filename="<dataset>-<count>.csv"`.
  - **Row cap:** `EXPORT_MAX_ROWS` (default 10,000), newest-first `LIMIT`. When
    the cap is hit the file still downloads; truncation is surfaced on the
    export page, not by failing.
  - `users` export excludes secrets — id, email, name, displayName,
    createdAt only. No session/account/token tables are exportable.
- **CSV helper** (`src/lib/server/admin/csv.ts`): builds a CSV string/stream
  from a header array + row iterable with correct escaping (wrap in quotes when
  the value contains `"`, `,`, `\n`, or `\r`; double interior quotes; null → empty).
  Unit-tested in isolation.
- **Export page:** one button per dataset (link to the `.csv` endpoint) with a
  row count from `+page.server.ts`; when `count > EXPORT_MAX_ROWS`, show
  "showing latest 10,000 of N".

## Shared helpers / boundaries

- `src/lib/server/session.ts` — `requireAdmin` + `parseAdminEmails` (pure).
- `src/lib/server/admin/metrics.ts` — the aggregate queries, each a small named
  function returning plain numbers/arrays, unit-testable against a seeded DB.
- `src/lib/server/admin/datasets.ts` — the `DATASETS` registry (query + columns).
- `src/lib/server/admin/csv.ts` — CSV serialization + escaping.
- Reuse existing pagination helpers and `timeAgo`; do not duplicate them.

## Error handling

- Any admin `load` query failure → the page renders with a muted inline error in
  that section rather than 500-ing the whole dashboard where practical; the gate
  itself still hard-fails (404) so access is never ambiguous.
- Export endpoint DB failure → 500 with a plain message (it's a direct download,
  no partial-file recovery needed given the cap keeps responses bounded).

## Testing

- **Unit (Vitest):**
  - `parseAdminEmails`: comma/space handling, case-insensitivity, empty → deny.
  - `requireAdmin`: allowlisted allow; non-listed signed-in → 404; signed-out →
    404; empty `ADMIN_EMAILS` → deny all.
  - CSV helper: escaping (quotes/commas/newlines/nulls), header row, empty set.
  - Metrics helpers: correct counts/rates against a small seeded fixture,
    including the 👎-ratio and fallback-rate math with zero-denominator guards.
  - Export cap/truncation predicate.
- **E2E (Playwright, seeded D1):**
  - Admin user reaches `/admin`, `/admin/ai`, `/admin/export`; a non-admin
    signed-in user and a signed-out visitor both get **404** on all three plus a
    `.csv` endpoint.
  - `/admin/ai?down=1` narrows the list to conversations with a 👎.
  - A conversation transcript renders another user's messages (admin sees all).
  - A `.csv` endpoint downloads with correct header + escaped rows, and the
    `users` export omits secret columns.
- **README:** short "Admin" section — env var, allowlist behavior, what's
  exportable.

## Out of scope

- User moderation, editing, or deletion from the panel.
- Charting library / real time-series charts (mini bars only).
- Real-time / auto-refreshing metrics.
- Role-management UI or DB-backed roles.
- Per-row export filtering, scheduled exports, or full-DB backup (the CSV cap
  plus `wrangler d1` covers archival).
