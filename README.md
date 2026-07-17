# Best Perspective

Best Perspective is a web app for exploring the USA Ultimate (USAU) rules of ultimate and testing your knowledge of them. It's named after the rules term for the player best positioned to make a call — the site's two goals are to: **explore the rules** and **test yourself**.

> This project is not affiliated with or endorsed by USA Ultimate. Rule text is reproduced from [usaultimate.org/rules](https://usaultimate.org/rules/) for study purposes, with a link back to the source on every ruleset page.

## Features

- **Rules explorer** — browse, search, and cross-link the full USAU rulebook.
- **Quiz** — quick quizzes, section mastery, and a timed challenge, all built on a 212-question human-reviewed bank.
- **Accounts** — sign in with Google to sync quiz history, section mastery, and timed-challenge bests to the cloud, and to bookmark rules; see it all on the `/me` dashboard.
- **Leaderboard** — an all-time top 10 for the timed challenge (`/leaderboard`), opt-in and profanity-filtered: claim a unique display name to appear, with your own rank shown even off the visible top 10.
- **AI** — ask-the-rules Q&A and on-demand scenario questions, grounded in the rulebook via Gemini; see [AI features](#ai-features).

Signing in is optional: the rules explorer and all three quiz modes work fully signed-out, with progress kept in `localStorage` only. Signing in adds cross-device sync (via a local-first background sync, so quizzing never blocks on the network) plus bookmarks and the dashboard. The AI features — scenario generation and ask-the-rules (see [AI features](#ai-features)) — are the one area that requires being signed in.

## Stack

| Concern    | Choice                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Framework  | SvelteKit (Svelte 5) + Vite, TypeScript                                                         |
| Styling    | Tailwind CSS v4                                                                                 |
| Primitives | [Bits UI](https://bits-ui.com) (headless components)                                            |
| Hosting    | Cloudflare Workers via `adapter-cloudflare`                                                     |
| Auth       | [better-auth](https://www.better-auth.com/) with Google OAuth                                   |
| Database   | Cloudflare D1 via [Drizzle ORM](https://orm.drizzle.team/)                                      |
| Search     | [MiniSearch](https://lucaong.github.io/minisearch/) index built at build time, runs client-side |
| Testing    | Vitest (unit), Playwright (e2e smoke), GitHub Actions CI                                        |

See `docs/superpowers/specs/2026-07-09-best-perspective-design.md` for the full design spec.

## Getting started

```bash
npm install
cp .dev.vars.example .dev.vars   # dummy secrets + ALLOW_TEST_SIGNIN=1 for local dev
npm run db:migrate:local         # apply D1 migrations to the local (Miniflare) database
npm run dev                      # http://localhost:5173, hot-reloading
```

Google sign-in requires real OAuth credentials in `.dev.vars` (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) — see [Deploy](#deploy). Without them, the app still runs: everything except sign-in and its synced features works, and `ALLOW_TEST_SIGNIN=1` (set by default in `.dev.vars.example`, **never** set this in production) enables an email/password test sign-in used by e2e and local auth testing.

## Content pipeline

Rule content isn't fetched at request time — it's scraped and parsed once by an ingest script into structured JSON that's committed to the repo and read directly by the app.

```bash
npm run ingest                 # parse content/sources/*.html (already committed) into content/rulesets/<id>/
npm run ingest -- --refetch    # re-download the source HTML from usaultimate.org first, then re-parse
```

The ingest pipeline (`scripts/ingest/`) does the parsing (`parse.ts`), then transforms the result — rewriting cross-references into internal links, extracting the glossary, wrapping defined terms in `<dfn>` elements, downloading referenced images, and building the search index (`transform.ts`). Output lands under `content/rulesets/<ruleset-id>/` (`manifest.json`, `sections/*.json`, `glossary.json`) plus a search index under `static/search/`. Everything is Zod-validated, both at ingest time and in CI (`npm run validate:content`), so a bad scrape can't ship.

To add a new ruleset, add an entry to `RULESETS` in `scripts/ingest/config.ts` and re-run the ingest script.

## Quiz

The app's second pillar is testing yourself, at `/quiz`. Three modes; progress always lives in `localStorage` first, and syncs to Cloudflare D1 in the background once you're signed in (see [Persistence & auth](#persistence--auth)):

- **Quick quiz** (`/quiz/quick`) — 10 questions drawn from the bank, optionally filtered by section and by difficulty tier (**Rookie**, **Veteran**, **Observer** — `difficulty` 1/2/3 in the question schema).
- **Section mastery** (`/quiz/mastery`) — work the rulebook section by section; missed questions come back first, and a section is "mastered" once your recent answers there hit ≥90%. Every rule section page has a "Quiz me on this section" shortcut that deep-links here via `?section=<slug>`.
- **Timed challenge** (`/quiz/timed`) — five minutes, auto-advancing, tracks your best streak and score.

### Question bank

Questions live under `content/questions/<rulesetId>/<sectionSlug>.json`, one file per rule section, loaded and validated the same way as ruleset content (`npm run validate:content`). Every question is **curated and human-reviewed** — nothing is served to users straight out of the generator. Each question has a prompt, exactly 4 choices, an `answerIndex`, an explanation, and `ruleRefs` back into the rulebook (rendered as citation links in the results screen).

### Seeding the bank

`scripts/seed-questions/` runs a **coverage-queue** model rather than "N questions per section": it ranks every rule by importance into a finite set of _targets_ (the saturation ceiling), figures out which targets the committed bank doesn't cover yet, and asks the Gemini API for exactly those — grounded in the section's rule text — merging results onto whatever's already committed for that section.

A rule becomes a target when its importance score (derived from how often other rules reference it, its own annotation count, and how shallow it sits in the section) clears `targetThreshold` in `scripts/seed-questions/config.ts`, and its own text is at least `minTargetTextLength` characters (bare headers are skipped — they're covered once their children are). A target is _covered_ once some question cites that rule id or one of its descendants. Coverage is always recomputed from the question files on disk, never from a state file, so raising or lowering `targetThreshold` between runs simply changes the ceiling and everything recomputes fresh.

```bash
GEMINI_API_KEY=… npm run seed:questions                   # generate for every section with uncovered targets
GEMINI_API_KEY=… npm run seed:questions -- --section 15   # only section 15
GEMINI_API_KEY=… npm run seed:questions -- --force        # drop targeted section(s)' questions and regenerate their coverage from scratch
npm run seed:questions -- --report                        # print the coverage report only — no key needed, no API calls
```

Each run requests at most `targetsPerSectionPerRun` uncovered targets per section (highest-importance first) and reports how many of those were fulfilled; a target the model repeatedly can't turn into a question stays visible under "requested but unfulfilled" in the report so it can be hand-authored or added to `excludeTargets`. Once every target is covered, the script prints `saturated` and exits without calling the API. **Always review every generated question before committing** — check the rule citations, the correct answer, and the distractors for accuracy — then run `npm run validate:content` to confirm the schema is satisfied.

## AI features

Two AI surfaces, both server-only (the Gemini API key never reaches the client) and both **signed-in only**:

- **Ask** (`/ask`, `POST /api/ai/chat`) — multi-turn chat over the rulebook; answers cite specific rules. Conversations live in a sidebar (`GET /api/ai/conversations`), open at `/ask/<id>`, support message copy and 👍/👎 feedback (`POST /api/ai/messages/<id>/feedback`), and delete softly (`DELETE /api/ai/conversations/<id>`). Every message sent counts against the daily ask quota; conversations cap at 25 messages.
- **Scenario quiz** (`/quiz/scenario`, `POST /api/ai/scenario`) — on-demand, freshly generated scenario questions, validated against the rule-id set and the question schema before being served; if generation fails twice it falls back to a bank question instead of erroring.

Every call goes through `src/lib/server/ai/config.ts`, which pins the model (`gemini-3-flash-preview`) in one place, and uses an explicit Gemini context cache (1 hour TTL) for each ruleset's `grounding.txt` so the ~46k-token rulebook prefix isn't re-sent (and re-billed) on every request.

**Guardrails:**

- Per-user daily caps: 10 asks/day, 10 scenarios/day.
- Global daily budget: 200 AI requests/day across all users and both kinds combined.
- Kill-switch: set `AI_DISABLED=1` to take `/api/ai/*` offline immediately (also returns 503 if `GEMINI_API_KEY` is unset).
- Sign-in is required for both endpoints — there's no signed-out AI usage.

**Setup:** get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

```bash
# Local: add to .dev.vars (leave empty to develop without AI — /api/ai/* returns 503, UI shows "offline")
GEMINI_API_KEY=…

# Prod
npx wrangler secret put GEMINI_API_KEY
```

**Curation flywheel.** AI-served scenario questions are logged to the `ai_questions` D1 table but never committed as-is. Review recently served questions with:

```bash
npx wrangler d1 execute usau-rules-website-db --remote --command \
  "select id, json_extract(question,'$.prompt') as prompt from ai_questions where status='served' order by created_at desc limit 20"
```

Good ones graduate into `content/questions/` with a real `<section>-<nn>` id, human-reviewed before commit — the same standard as every other question in the bank (see [Question bank](#question-bank)). `/ask` conversations and their messages are similarly logged to `ai_conversations`/`ai_messages` (thinking summaries are not retained) to improve answer quality over time. In the same spirit of being upfront about what's visible to others: a claimed leaderboard display name is public the moment it's set (shown on `/leaderboard` and to anyone viewing the board), and clearing it (`/me` → remove) drops you off the board immediately — no grace period, no cached row.

## Persistence & auth

Sign-in is Google OAuth only, via [better-auth](https://www.better-auth.com/) (`src/lib/server/auth.ts`, `src/lib/auth-client.ts`), backed by Cloudflare D1 (`src/lib/server/db/`, schema + migrations under `drizzle/`).

- **Local-first sync.** Every quiz attempt and mastery update is written to `localStorage` immediately and queued in a client-side outbox (`src/lib/quiz/sync.ts`); a background flush pushes queued items to `POST /api/attempts` once signed in, and `GET /api/sync` hydrates local state on sign-in from whatever's already in D1. Nothing in the quiz flow blocks on the network or on being signed in. Bookmarks are signed-in-only: toggling one fires a direct, optimistic `PUT`/`DELETE /api/bookmarks` call with no localStorage cache or offline queue.
- **Server-validated timed runs.** The timed challenge (`/quiz/timed`) can't be won by replaying client state: `POST /api/timed/start` issues an HMAC-signed run token (`src/lib/server/quiz/run-token.ts`), and `POST /api/timed/finish` recomputes the score server-side from the token and the submitted answer log (`src/lib/server/quiz/verify.ts`) before it's allowed to count as a best.
- **Rendering.** The rules explorer, quiz, and marketing pages are prerendered static pages; `/me` (the signed-in dashboard) and everything under `/api/*` are dynamic server routes running on the Worker.
- **Local dev auth.** `ALLOW_TEST_SIGNIN=1` (set in `.dev.vars.example`) turns on an email/password test sign-in path used by Playwright and local testing, so Google OAuth credentials aren't required just to exercise signed-in behavior locally. It must never be set in a deployed environment.

## Testing

```bash
npx prettier --check .    # formatting (or: npm run lint)
npm run check             # svelte-check (app types)
npm run check:scripts     # tsc over scripts/ (not covered by svelte-check's tsconfig)
npm run test              # vitest unit tests
npm run test:watch        # vitest, watch mode
npm run validate:content  # Zod-validate everything under content/rulesets/
npm run build             # production build (also required before e2e, since Playwright serves the built worker)
npm run test:e2e          # Playwright smoke suite against `wrangler dev` serving the built app
npm run db:generate       # generate a Drizzle migration from schema.ts changes
npm run db:migrate:local  # apply migrations to the local (Miniflare) D1 database
npm run db:migrate:remote # apply migrations to the deployed D1 database
```

`npm run test:e2e` builds the app and boots it with `wrangler dev` on port 8787 automatically (see `playwright.config.ts`), applying local D1 migrations first; no separate dev server is needed. The first run is slow (~1 minute build); set `CI=1` to force a fresh server per run instead of reusing one already listening on 8787. e2e auth coverage relies on `ALLOW_TEST_SIGNIN=1` from `.dev.vars` (see [Getting started](#getting-started)); CI copies `.dev.vars.example` into place before running the suite.

CI (`.github/workflows/ci.yml`) runs the same checks — prettier, `check`, `check:scripts`, unit tests, content validation, build, and the Playwright suite — on every push and pull request against `main`.

## Deploy

The app is a single Cloudflare Worker (SvelteKit's `adapter-cloudflare`, static assets + a server bundle for auth and the `/api/*` and `/me` routes), backed by a Cloudflare D1 database, deployed with [wrangler](https://developers.cloudflare.com/workers/wrangler/). Production runs at `usaurules.com`: `wrangler.jsonc` declares the custom domain and `BETTER_AUTH_URL`, and wrangler provisions the domain on deploy — the `usaurules.com` zone must already exist in the Cloudflare account.

```bash
npx wrangler login

# One-time setup
npx wrangler d1 create usau-rules-website-db   # then update the database_id in wrangler.jsonc
npm run db:migrate:remote                      # apply migrations to the remote D1 database
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID       # prod OAuth client
npx wrangler secret put GOOGLE_CLIENT_SECRET   # prod OAuth client

# Every deploy
npm run build && npx wrangler deploy
```

Google OAuth needs two separate client IDs/secrets, since better-auth ties the redirect URI to a single origin: a **dev** client scoped to `localhost` (its secret lives only in the gitignored `.dev.vars`, never committed) and a **prod** client scoped to `usaurules.com` (its secret only ever passes through `wrangler secret put`, never a file in the repo). `ALLOW_TEST_SIGNIN` must not be set as a deployed secret.

Or connect the repo to [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) for git-triggered deploys on push to `main` (still requires the one-time D1 + secrets setup above).

## Roadmap

Best Perspective ships in four phases (full detail in `docs/superpowers/specs/2026-07-09-best-perspective-design.md`); each phase ships something usable:

1. [x] **Foundation** _(shipped)_ — scaffold, theme/tokens, ingest pipeline + Official Rules 2026-27 content, rules explorer, landing page, search, e2e coverage.
2. [x] **Quiz** _(shipped)_ — quiz engine, quick/mastery/timed modes, local (no auth) progress, "Quiz me on this section" shortcut, Gemini-assisted seeding script. The committed bank is saturated: 212 human-reviewed questions covering all 217 coverage targets across every section.
3. [x] **Accounts** _(shipped)_ — live at [usaurules.com](https://usaurules.com) — better-auth with Google OAuth, Cloudflare D1 for local-first progress persistence, server-validated timed runs, bookmarks, and the `/me` dashboard.
4. [x] **AI** _(code-complete)_ — Gemini-powered scenario generation (`/quiz/scenario`) and ask-the-rules (`/ask`), with rule-citation grounding and cost guardrails; see [AI features](#ai-features).

Club/College Guidelines ingest, Spanish content, and social features are out of scope for v1 but the content architecture supports adding them later.
