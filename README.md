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

1. **Foundation** _(this phase)_ — scaffold, theme/tokens, ingest pipeline + Official Rules 2026-27 content, rules explorer, landing page, search, e2e coverage.
2. **Quiz** — quiz engine and a seeded/reviewed question bank; quick, mastery, and timed modes, local (no auth) — plus a "Quiz me on this section" shortcut on section headers.
3. **Accounts** — better-auth with Google OAuth, Cloudflare D1 for progress persistence, a dashboard, and bookmarks.
4. **AI** — Gemini-powered scenario generation and ask-the-rules, with rule-citation grounding and cost guardrails.

Club/College Guidelines ingest, Spanish content, and social features are out of scope for v1 but the content architecture supports adding them later.
