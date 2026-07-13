# Timed-Challenge Leaderboard — Design Spec

**Date:** 2026-07-13
**Status:** Approved by user (brainstorming complete)

A public all-time top-10 leaderboard for the timed challenge, with opt-in unique display names. Backlogged since Phase 3; built on the already-server-verified `quiz_attempts` data.

## Decisions (user-approved)

- **Board:** all-time top 10. One entry per player: their single best run (`score` desc, `bestStreak` desc tiebreak, then earliest `createdAt` — first to reach a score outranks later equals).
- **Identity:** opt-in display name; no name → not listed. One-click "First L." suggestion (derived from the Google account name) plus free-text custom names. **Names are unique, case-insensitively**; the one-click path auto-resolves conflicts with numeric suffixes ("Cameron J. 2").
- **Privacy:** initials chip on the board, never the Google avatar or full name. Clearing your name removes you from the board instantly.
- **Placement:** public `/leaderboard` page (prerendered shell + client fetch), linked from the timed-challenge intro, the quiz hub timed card, and the `/me` dashboard.
- **Own rank:** signed-in players with a display name see their own row (rank over the full opted-in population) pinned beneath the top 10 when outside it.
- **Clean slate:** all pre-existing `mode='timed'` attempts are wiped (they're 60-second-era scores; the mode is now 5 minutes). User-run checkpoint, local + remote.
- **Architecture:** live query over `quiz_attempts` — no materialized table, no cache (Approach 1).

## Data model

- `user.display_name` — nullable `text`; **unique index on `lower(display_name)`**. Added via a drizzle named migration (`display-name`). No other schema changes.

## API

### `GET /api/leaderboard` (public — no auth required)

One window-function query (D1/SQLite `row_number()`/`rank()`): best timed attempt per user, restricted to users with a display name, joined to `user`.

```jsonc
{
	"entries": [
		{ "rank": 1, "displayName": "Cameron J.", "score": 112, "bestStreak": 41, "at": 1783950000000 }
		// … up to 10
	],
	"me": { "rank": 23, "displayName": "Sam K.", "score": 87, "bestStreak": 12, "at": 1783940000000 } // or null
}
```

`me` is populated only when the request carries a signed-in session whose user has a display name; rank is computed over all opted-in players, not just the top 10. Signed-out requests simply get `me: null`.

### `PUT /api/profile/display-name` (signed-in)

Body: `{ "displayName": string | null, "resolveConflict"?: boolean }`

- `null` clears the name (opt-out; instant board removal). → `200 {displayName: null}`
- Validation (server-side): trim; 2–30 chars; letters, digits, spaces, `.`, `'`, `-` only; profanity screened with the `obscenity` npm package (pure TS, Workers-compatible). Rejection → `400` with a friendly generic message.
- Uniqueness conflict (case-insensitive):
  - `resolveConflict: true` (the one-click suggestion path): the server appends the first free numeric suffix — "Cameron J. 2", "Cameron J. 3" — saves, and returns the chosen name.
  - otherwise: `409 { "suggestion": "Cameron J. 2" }`; the UI prefills the suggestion for the user to accept or edit.
- Insert races resolve by retrying on the unique-index violation (bounded loop).

The "First L." suggestion string is derived **server-side** from the session's Google `name` (first word + first letter of last word + "."); exposed to the UI via a small `GET /api/profile/display-name` returning `{displayName, suggestion}`.

Both routes live under `/api/`, so the existing `hooks.server.ts` dynamic gate covers them — no hooks change.

## UI

1. **`/leaderboard`** — public prerendered shell page; client-fetches the API on mount. Navy shell, white `rounded-xl` card. Table rows: rank, initials chip (first letter of display name), display name, score, best streak, date. Own-rank row pinned beneath the board when `me` is present and outside the top 10. Empty state: "No runs on the board yet — set a name and play the timed challenge." Signed-out UX: full board, no `me` row, nothing broken.
2. **`/me` "Leaderboard" card** — shows the current name with change/remove controls, or the claim flow: a one-click "Use Cameron J." button (server suggestion, `resolveConflict: true`) plus a custom-name input. Links to `/leaderboard`.
3. **Post-run nudge** — on the timed results screen, when the just-finished run's server-verified score would place in the top 10 AND the player has no display name: "This run would be #N on the leaderboard — claim your spot", with the same claim controls inline. Dismissable; never blocks the results. (Qualification check: client compares the finish response's score against the fetched board.)

Links: timed intro screen and quiz hub timed card get "See the leaderboard →".

Visual system: existing tokens only — navy `#1C3557` / deep `#12233C` shell, cardinal `#B41F3A` CTAs/accents, mist `#F0F1F3`, `.display` type, white cards.

## Integrity

- **`RunClaims` gains `rulesetId`** (flagged must-revisit in the Phase 3 final review): bound into the HMAC run token at timed-start, verified at finish against the submitted payload's `rulesetId`. Deploying this invalidates any in-flight run once — accepted.
- Scores remain server-recomputed (existing Phase 3 anti-cheat); the leaderboard adds no new trust in client data.
- The leaderboard endpoint reads only display-name-holding users' name + attempt aggregates — no emails, no images, no other user data.

## Clean-slate checkpoint (user-run)

`DELETE FROM quiz_attempts WHERE mode='timed'` applied local and remote (FK cascade also removes those runs' `question_responses`, trimming mastery history slightly — accepted). Devices' localStorage may keep showing a stale 60-second personal best until beaten — cosmetic, accepted.

## Error handling

- Board fetch failure → quiet error state with retry ("Couldn't load the leaderboard — try again").
- Name-set failures surface the server message inline (400 invalid/profane, 409 with suggestion).
- The nudge never blocks or delays the results screen; all its network work is fire-and-forget from the page's perspective.

## Testing

- **Vitest:** ranking helper (one entry per user, tie order score→streak→earliest), name validation (charset, length, profanity, trim), suffix resolution ("base taken → base 2 → base 3", case-insensitive matching).
- **Playwright (real local API, test sign-in):** signed-out board loads (empty state); claim a suggested name → play/complete a timed run → row appears on `/leaderboard`; custom-name 409 → suggestion accepted; own-rank row renders; name removal empties the board. Suite conventions (`networkidle` before first interaction) as always.

## Out of scope

- Weekly/rotating boards, per-section boards.
- Display-name moderation beyond the profanity filter (no report/admin tooling).
- Avatars on the board.
- Backfill/migration of 60-second-era scores (wiped instead).
