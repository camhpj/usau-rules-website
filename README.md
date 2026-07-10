# Best Perspective

Best Perspective is a web app for exploring the USA Ultimate (USAU) rules of ultimate and testing your knowledge of them. It's named after the rules term for the player best positioned to make a call — the site's two goals are to: **explore the rules** and **test yourself**.

> This project is not affiliated with or endorsed by USA Ultimate. Rule text is reproduced from [usaultimate.org/rules](https://usaultimate.org/rules/) for study purposes, with a link back to the source on every ruleset page.

## Stack

| Concern    | Choice                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Framework  | SvelteKit (Svelte 5) + Vite, TypeScript                                                         |
| Styling    | Tailwind CSS v4                                                                                 |
| Primitives | [Bits UI](https://bits-ui.com) (headless components)                                            |
| Hosting    | Cloudflare Workers via `adapter-cloudflare`                                                     |
| Search     | [MiniSearch](https://lucaong.github.io/minisearch/) index built at build time, runs client-side |
| Testing    | Vitest (unit), Playwright (e2e smoke), GitHub Actions CI                                        |

See `docs/superpowers/specs/2026-07-09-best-perspective-design.md` for the full design spec.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173, hot-reloading
```

## Content pipeline

Rule content isn't fetched at request time — it's scraped and parsed once by an ingest script into structured JSON that's committed to the repo and read directly by the app.

```bash
npm run ingest                 # parse content/sources/*.html (already committed) into content/rulesets/<id>/
npm run ingest -- --refetch    # re-download the source HTML from usaultimate.org first, then re-parse
```

The ingest pipeline (`scripts/ingest/`) does the parsing (`parse.ts`), then transforms the result — rewriting cross-references into internal links, extracting the glossary, wrapping defined terms in `<dfn>` elements, downloading referenced images, and building the search index (`transform.ts`). Output lands under `content/rulesets/<ruleset-id>/` (`manifest.json`, `sections/*.json`, `glossary.json`) plus a search index under `static/search/`. Everything is Zod-validated, both at ingest time and in CI (`npm run validate:content`), so a bad scrape can't ship.

To add a new ruleset, add an entry to `RULESETS` in `scripts/ingest/config.ts` and re-run the ingest script.

## Quiz

The app's second pillar is testing yourself, at `/quiz`. Three modes, all local-only (no accounts yet — progress lives in `localStorage` until Phase 3 adds auth + D1 persistence):

- **Quick quiz** (`/quiz/quick`) — 10 questions drawn from the bank, optionally filtered by section and by difficulty tier (**Rookie**, **Veteran**, **Observer** — `difficulty` 1/2/3 in the question schema).
- **Section mastery** (`/quiz/mastery`) — work the rulebook section by section; missed questions come back first, and a section is "mastered" once your recent answers there hit ≥90%. Every rule section page has a "Quiz me on this section" shortcut that deep-links here via `?section=<slug>`.
- **Timed challenge** (`/quiz/timed`) — 60 seconds, auto-advancing, tracks your best streak and score.

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

## Testing

```bash
npx prettier --check .   # formatting (or: npm run lint)
npm run check            # svelte-check (app types)
npm run check:scripts    # tsc over scripts/ (not covered by svelte-check's tsconfig)
npm run test             # vitest unit tests
npm run test:watch       # vitest, watch mode
npm run validate:content # Zod-validate everything under content/rulesets/
npm run build            # production build (also required before e2e, since Playwright serves the built worker)
npm run test:e2e         # Playwright smoke suite against `wrangler dev` serving the built app
```

`npm run test:e2e` builds the app and boots it with `wrangler dev` on port 8787 automatically (see `playwright.config.ts`); no separate dev server is needed. The first run is slow (~1 minute build); set `CI=1` to force a fresh server per run instead of reusing one already listening on 8787.

CI (`.github/workflows/ci.yml`) runs the same checks — prettier, `check`, `check:scripts`, unit tests, content validation, build, and the Playwright suite — on every push and pull request against `main`.

## Deploy

The app is a single Cloudflare Worker (SvelteKit's `adapter-cloudflare`, static assets + a small server bundle for future API routes).

```bash
npx wrangler login
npm run build && npx wrangler deploy
```

Or connect the repo to [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) for git-triggered deploys on push to `main`.

## Roadmap

Best Perspective ships in four phases (full detail in `docs/superpowers/specs/2026-07-09-best-perspective-design.md`); each phase ships something usable:

1. [x] **Foundation** _(shipped)_ — scaffold, theme/tokens, ingest pipeline + Official Rules 2026-27 content, rules explorer, landing page, search, e2e coverage.
2. [x] **Quiz** _(shipped)_ — quiz engine, quick/mastery/timed modes, local (no auth) progress, "Quiz me on this section" shortcut, Gemini-assisted seeding script. The committed bank is saturated: 212 human-reviewed questions covering all 217 coverage targets across every section.
3. [ ] **Accounts** — better-auth with Google OAuth, Cloudflare D1 for progress persistence, a dashboard, and bookmarks.
4. [ ] **AI** — Gemini-powered scenario generation and ask-the-rules, with rule-citation grounding and cost guardrails.

Club/College Guidelines ingest, Spanish content, and social features are out of scope for v1 but the content architecture supports adding them later.
