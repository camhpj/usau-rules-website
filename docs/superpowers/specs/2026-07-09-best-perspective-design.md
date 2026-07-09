# Best Perspective — Design Spec

**Date:** 2026-07-09
**Status:** Approved by user (brainstorming complete)

A beautifully designed web app for exploring the USA Ultimate (USAU) rules of ultimate and testing your knowledge of them. Named **Best Perspective** (the rules term for the player best positioned to make a call).

## Goals & Audience

- Two pillars: **explore the rules** and **test your knowledge**.
- Serve all audiences equally — new players, club players/captains, observers/rules nerds — via difficulty tiers (1–3) on quiz content rather than separate experiences.
- Visual quality is a first-class goal: inspired by USAU's brand identity without copying it.
- Content must be trivially extensible to more USAU rules documents (Club Guidelines, College Guidelines, 10 Simple Rules, Observer Manual, WFDF…).

## Stack

| Concern | Choice |
|---|---|
| Framework | SvelteKit (Svelte 5) + Vite, TypeScript |
| Styling | Tailwind CSS v4 |
| Primitives | Bits UI (headless, Radix-equivalent for Svelte; Radix itself is React-only) |
| Hosting | Cloudflare Workers via `adapter-cloudflare`, one app, one deploy |
| Database | Cloudflare D1 + Drizzle ORM |
| Auth | better-auth, Google OAuth as the sole provider |
| AI | Google Gemini Flash via server routes, full-rulebook-in-context grounding with context caching (no vector DB in v1) |
| Search | MiniSearch index built at build time, runs client-side |
| Testing | Vitest (unit), Playwright (e2e smoke), GitHub Actions CI, Cloudflare Workers Builds for deploys |

## Architecture

One SvelteKit app on Cloudflare Workers:

- **Prerendered at build time:** landing page and all rule reading pages (instant, linkable, SEO-friendly). Client-side navigation gives SPA feel.
- **Server routes on the same Worker:** Gemini endpoints, better-auth routes, progress persistence to D1.
- **Static content in the repo:** ruleset JSON, question bank JSON, search indexes, AI grounding text — all build artifacts of the ingest pipeline, all validated by Zod in CI.

## Content Pipeline (extensibility core)

A standalone ingest script (`scripts/ingest/`) fetches a ruleset's HTML from usaultimate.org, parses it into structured JSON under `content/rulesets/<id>/`, checked into git (diffable, hand-fixable). The app consumes only this JSON.

Per ruleset:

- **Manifest:** id (e.g. `usau-official-2026-27`), title, edition year, source URL, and **section scheme** (numeric 1–23 for the Official Rules; alphabetical A–W for Club Guidelines). Document shape is data, not code.
- **Sections → rules tree** with **stable hierarchical rule IDs** matching the document's own numbering (e.g. `15.A.3`) — durable anchors for deep links, bookmarks, citations, AI grounding.
- **Cross-references** parsed into links ("see 15.A").
- **Glossary** extracted from the Definitions section, used for inline term popovers.
- **MiniSearch index** and a **plain-text grounding bundle** (for Gemini context) emitted per ruleset.

v1 ships the Official Rules 2026-2027 (23 sections + appendices A–G). Adding a new ruleset = run ingest, fix parse quirks in JSON, add manifest entry. No app code changes.

**Rights note:** USAU rules are copyrighted but freely published; this is an unofficial fan study tool with clear attribution ("Unofficial study tool · Rules © USA Ultimate") and links back to the source. Conscious, accepted choice.

## Data Model

**Static (repo):** `content/questions/*.json` — question bank: id, type (multiple-choice), prompt, choices, answer, explanation, `ruleRefs[]` (rule IDs), difficulty 1–3, section tags, ruleset id. Seeded by an offline Gemini generation script grounded in the rulebook, then **human-reviewed before commit**.

**Dynamic (D1 via Drizzle):**

- better-auth tables (users, sessions, accounts)
- `quiz_attempts` — user, mode, ruleset, score/total, duration, timestamp
- `question_responses` — per-question results (attempt, question id, correct, chosen answer); powers section mastery
- `bookmarks` — user + rule ID
- `ai_questions` — log of every AI-generated question; curation flywheel: good ones graduate into the static bank
- AI usage counters (per-user daily caps)

## Features

### Landing (`/`)
Minimal, one viewport, self-explanatory. Single navy nav bar (wordmark **BEST PERSPECTIVE**, links RULES · QUIZ · ASK, sign-in button). Chip "2026-2027 OFFICIAL RULES", hero headline **"KNOW THE / RULES."** (heavy italic condensed uppercase, "RULES." accent), one subline, two white entry cards (Explore the rules / Test yourself), quiet ghost link "Ask a rules question", one-line attribution footer. Nothing else.

### Explorer (`/rules`, `/rules/[ruleset]/[section]`)
- Ruleset picker (one card in v1) → reading view: left TOC sidebar (collapsible on mobile), center rule text on white card over navy shell.
- Rule-level anchors + copy-link affordance; cross-references are links; glossary terms get dotted-underline popovers (Bits UI).
- `Cmd+K` search over the prebuilt MiniSearch index — instant, client-side, free.
- "Quiz me on this section" shortcut on each section header → mastery mode.
- Bookmarking (signed in) pins rules to the dashboard.

### Quiz (`/quiz`)
One shared question-player component (question → answer → immediate feedback with explanation + rule citations deep-linking into the explorer). Four modes configure it:

1. **Quick quiz** — 10 bank questions, filter by section + difficulty.
2. **Section mastery** — per-section sets; mastery computed from response history (e.g. ≥90% over recent window), progress grid; missed questions resurface first.
3. **Scenario mode** (signed-in, AI) — Gemini-generated game vignettes; schema-validated JSON; every cited rule ID verified to exist before display; logged to `ai_questions`.
4. **Timed challenge** — 60-second streak run against the bank, personal bests.

Signed-out users: full explorer + bank quizzes (results not persisted). Sign-in unlocks persistence, mastery, bookmarks, and AI features.

### Ask the rules (`/ask`)
Signed-in. Natural-language question → streamed, grounded answer citing rule IDs (rendered as explorer links). Gemini receives the full rulebook grounding bundle (context-cached) and must answer only from it; off-topic → polite refusal.

### Dashboard (`/me`)
Attempt history, section mastery grid, bookmarks, timed-challenge bests.

## AI Integration & Cost Guardrails

- Single server module wraps all Gemini calls: model pinned to Gemini Flash, full-ruleset context with caching, Zod-validated structured outputs.
- Failed validation → one retry → fall back to bank questions (scenario) or apologetic error (ask).
- **Guardrails:** per-user daily caps (D1 counter), global daily budget kill-switch (env var), AI features require sign-in. Numbers tuned once real token counts are visible.

## Visual System — "Navy First"

Validated via mockups against USAU's real brand DNA (user-provided screenshot):

- **Palette:** deep navy `#1C3557` shell (deeper `#12233C` for depth), cardinal red `#B41F3A` strictly for CTAs/active states, white content surfaces, light gray `#F0F1F3` tints. Faint white field-line/end-zone-hatch texture on the navy shell.
- **Type:** Barlow Condensed Black Italic (self-hosted) for the display voice — uppercase, tight; Inter for UI/body. Long-form rule text on white for readability.
- **Motifs:** chip labels (e.g. "2026-2027 EDITION"), rounded (~12px) cards, thin hairlines, red circular arrow CTAs.
- **Layout rules:** single nav bar (no utility strip), minimal landing, navy shell + white cards everywhere.
- Mockups preserved in `.superpowers/brainstorm/` (gitignored).

## Error Handling

- Ingest/content: Zod validation fails CI loudly; bad scrapes can't ship.
- AI: validate → retry once → fallback; rule-ID citations verified against content.
- D1 writes: quiz play never blocks on persistence; client retries writes.
- Degradation: prerendered content works even if API/D1/AI are down.

## Testing

- **Vitest:** ingest parser (fixture HTML → expected JSON), content schemas, quiz scoring, mastery computation, AI response validation.
- **Playwright:** smoke the three core flows — read a rule, complete a quick quiz, ask a question (mocked AI).
- **CI:** GitHub Actions (lint, typecheck, test, content validation). Deploy via Cloudflare Workers Builds on push to main.

## Build Order

1. **Foundation:** scaffold, theme/tokens, ingest pipeline + Official Rules content, explorer, landing.
2. **Quiz:** engine + seeded/reviewed question bank; quick, mastery, timed modes (local, no auth).
3. **Accounts:** better-auth + D1, progress persistence, dashboard.
4. **AI:** scenario mode, ask-the-rules, guardrails and budgets.

Each phase ships something usable. Implementation is delegated to Sonnet 5 agents; planning/review stays with Fable.

## Out of Scope (v1)

- Club/College Guidelines content (architecture supports; not ingested)
- Spanish content, 10 Simple Rules
- Leaderboards, social features
- Vectorize RAG (only if cost/scale demands)
- Offline PWA
