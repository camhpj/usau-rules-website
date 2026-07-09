# Best Perspective — Phase 1: Foundation & Rules Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation of Best Perspective: a themed SvelteKit app on Cloudflare Workers with the USAU Official Rules ingested into structured JSON, a prerendered rules explorer (TOC, reading view, glossary popovers, cross-ref links, Cmd+K search), and the minimal landing page.

**Architecture:** One SvelteKit app (`adapter-cloudflare`), fully prerendered in this phase. A standalone ingest pipeline (`scripts/ingest/`) parses the USAU rules HTML into Zod-validated JSON under `content/`, which is the only thing the app consumes. Search runs client-side over a prebuilt MiniSearch index.

**Tech Stack:** SvelteKit (Svelte 5) + Vite, TypeScript, Tailwind CSS v4, Bits UI, Zod, cheerio (ingest), MiniSearch, Vitest, Playwright, Wrangler.

**Spec:** `docs/superpowers/specs/2026-07-09-best-perspective-design.md` — read it first.

## Global Constraints

- Node 22, npm (no pnpm/yarn). TypeScript everywhere, including scripts.
- Palette tokens (exact): navy `#1C3557`, deep navy `#12233C`, cardinal `#B41F3A`, mist gray `#F0F1F3`, white surfaces. Cardinal is ONLY for CTAs/active/accent states.
- Display type: Barlow Condensed italic (700/900) uppercase; body/UI: Inter. Self-hosted via Fontsource. No external font/CDN requests.
- Wordmark copy: `BEST PERSPECTIVE`. Hero headline: `KNOW THE` / `RULES.` ("RULES." in cardinal). Chip: `2026-2027 OFFICIAL RULES`. Footer: `Unofficial study tool · Rules © USA Ultimate`.
- Single nav bar (no utility strip). Nav links: `RULES · QUIZ · ASK` + sign-in placeholder button (non-functional this phase).
- Ruleset id: `usau-official-2026-27`. Rule element anchors use the raw rule id (e.g. `id="15.A.3"`); look them up with `getElementById`, never CSS id selectors (dots).
- All content JSON must validate against the Zod schemas in `src/lib/content/types.ts`; validation runs in CI.
- Rules text is © USA Ultimate — keep source attribution visible in the explorer and footer.
- Commit after every task (conventional commits: `feat:`, `chore:`, `test:`...). End every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Scaffold app + Cloudflare adapter + CI

**Files:**
- Create: SvelteKit scaffold at repo root (`package.json`, `svelte.config.js`, `vite.config.ts`, `src/app.html`, `src/app.d.ts`, `tsconfig.json`, `.prettierrc`, …)
- Create: `wrangler.jsonc`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run dev|build|check|test|format|lint` scripts every later task relies on; `$content` alias → `content/` directory; Tailwind v4 wired via `@tailwindcss/vite`.

- [ ] **Step 1: Scaffold into the existing repo**

The repo root already contains `docs/` and `.gitignore` — scaffold in place:

```bash
npx sv create . --template minimal --types ts --no-add-ons --install npm
npx sv add tailwindcss prettier --install npm
```

If `sv` prompts interactively, choose: current directory, keep existing files, minimal template, TypeScript, Tailwind CSS add-on, Prettier add-on, npm.

- [ ] **Step 2: Install remaining deps**

```bash
npm i zod minisearch bits-ui
npm i -D @sveltejs/adapter-cloudflare wrangler vitest tsx cheerio @types/node @playwright/test @fontsource/barlow-condensed @fontsource-variable/inter
```

- [ ] **Step 3: Configure adapter + `$content` alias**

`svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		alias: { $content: 'content' }
	}
};

export default config;
```

`wrangler.jsonc`:

```jsonc
{
	"name": "best-perspective",
	"main": ".svelte-kit/cloudflare/_worker.js",
	"compatibility_date": "2026-07-01",
	"compatibility_flags": ["nodejs_compat"],
	"assets": {
		"binding": "ASSETS",
		"directory": ".svelte-kit/cloudflare"
	},
	"observability": { "enabled": true }
}
```

If the installed `@sveltejs/adapter-cloudflare` README/docs state a different `main`/assets layout, follow the adapter's documented layout — the adapter version wins over this snippet.

- [ ] **Step 4: Wire Vitest**

`vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
		environment: 'node'
	}
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"ingest": "tsx scripts/ingest/index.ts",
"validate:content": "tsx scripts/validate-content.ts"
```

- [ ] **Step 5: Extend `.gitignore`**

Append (keep existing entries):

```
/test-results
/playwright-report
```

- [ ] **Step 6: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint --if-present
      - run: npx prettier --check .
      - run: npm run check
      - run: npm run test
      - run: npm run validate:content --if-present
      - run: npm run build
```

- [ ] **Step 7: Verify build works end to end**

```bash
npm run check   # expect: 0 errors
npm run build   # expect: "done" with .svelte-kit/cloudflare output
npx wrangler dev --port 8787 &  # expect: serves the default page at :8787; then kill it
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold SvelteKit + Tailwind v4 + Cloudflare adapter + CI"
```

---

### Task 2: Theme, fonts, and app shell

**Files:**
- Modify: `src/app.css`, `src/app.html`
- Create: `src/lib/components/Nav.svelte`, `src/lib/components/Footer.svelte`, `src/lib/components/Chip.svelte`
- Create: `src/routes/+layout.svelte`, `src/routes/+layout.ts`

**Interfaces:**
- Produces: Tailwind theme tokens (`bg-navy`, `bg-navy-deep`, `text-cardinal`, `bg-mist`, `font-display`, `font-sans`), `.display` utility class, `.field-lines` shell texture class; `<Chip>` component (`props: { label: string }`); layout with `<slot/>` used by all routes.

- [ ] **Step 1: Theme tokens + base styles**

`src/app.css`:

```css
@import 'tailwindcss';
@import '@fontsource/barlow-condensed/700-italic.css';
@import '@fontsource/barlow-condensed/900-italic.css';
@import '@fontsource-variable/inter';

@theme {
	--color-navy: #1c3557;
	--color-navy-deep: #12233c;
	--color-cardinal: #b41f3a;
	--color-mist: #f0f1f3;
	--font-display: 'Barlow Condensed', 'Arial Narrow', sans-serif;
	--font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
}

@layer base {
	html {
		font-family: var(--font-sans);
		background: var(--color-navy-deep);
		color: white;
		scroll-behavior: smooth;
	}
}

@utility display {
	font-family: var(--font-display);
	font-style: italic;
	font-weight: 900;
	text-transform: uppercase;
	letter-spacing: -0.01em;
	line-height: 0.95;
}

/* faint field-line texture for the navy shell */
@utility field-lines {
	background-image:
		linear-gradient(to right, rgb(255 255 255 / 0.04) 1px, transparent 1px),
		linear-gradient(to bottom, rgb(255 255 255 / 0.03) 1px, transparent 1px);
	background-size: 96px 96px;
}
```

- [ ] **Step 2: Components**

`src/lib/components/Chip.svelte`:

```svelte
<script lang="ts">
	let { label }: { label: string } = $props();
</script>

<span
	class="inline-block rounded-sm border border-cardinal px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] text-white uppercase"
>
	{label}
</span>
```

`src/lib/components/Nav.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	const links = [
		{ href: '/rules', label: 'Rules' },
		{ href: '/quiz', label: 'Quiz' },
		{ href: '/ask', label: 'Ask' }
	];
</script>

<header class="sticky top-0 z-40 border-b border-white/10 bg-navy-deep/90 backdrop-blur">
	<nav class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
		<a href="/" class="display text-2xl text-white">
			Best <span class="text-cardinal">Perspective</span>
		</a>
		<div class="flex items-center gap-6">
			{#each links as link (link.href)}
				<a
					href={link.href}
					class="text-xs font-semibold tracking-[0.18em] uppercase transition-colors
						{page.url.pathname.startsWith(link.href) ? 'text-cardinal' : 'text-white/70 hover:text-white'}"
				>
					{link.label}
				</a>
			{/each}
			<button
				class="rounded-full border border-white/25 px-4 py-1.5 text-xs font-semibold tracking-wider text-white/80 uppercase hover:border-white/60 hover:text-white"
				title="Sign-in arrives in a later phase"
			>
				Sign in
			</button>
		</div>
	</nav>
</header>
```

`src/lib/components/Footer.svelte`:

```svelte
<footer class="border-t border-white/10 py-6">
	<p class="mx-auto max-w-6xl px-4 text-center text-xs text-white/50 sm:px-6">
		Unofficial study tool · Rules © <a
			href="https://usaultimate.org/rules/"
			class="underline decoration-white/30 underline-offset-2 hover:text-white/80">USA Ultimate</a
		>
	</p>
</footer>
```

- [ ] **Step 3: Layout (fully prerendered app this phase)**

`src/routes/+layout.ts`:

```ts
export const prerender = true;
```

`src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import '../app.css';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';
	let { children } = $props();
</script>

<div class="field-lines flex min-h-screen flex-col bg-navy-deep">
	<Nav />
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer />
</div>
```

Set `<html lang="en">` and add `<title>Best Perspective</title>` handling: in `src/app.html` keep the standard scaffold; page titles come from `<svelte:head>` per route later.

- [ ] **Step 4: Verify visually**

```bash
npm run dev
```

Open http://localhost:5173 — expect navy shell, sticky nav with italic condensed wordmark ("Perspective" in cardinal), footer attribution. `npm run check` passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: navy-first theme tokens, fonts, nav/footer shell"
```

---

### Task 3: Content schemas (Zod) + validation script

**Files:**
- Create: `src/lib/content/types.ts`
- Create: `src/lib/content/types.test.ts`
- Create: `scripts/validate-content.ts`

**Interfaces:**
- Produces (exact — every later task depends on these):

```ts
export interface RuleNode {
	id: string; // "15.A.3", "B1.G.1"
	label: string; // display label as printed, e.g. "15.A.3."
	html: string; // sanitized inner HTML (xrefs internal, glossary-wrapped, images local)
	text: string; // plain text, whitespace-normalized
	annotations: string[]; // official annotations, [[..]] markers stripped
	refs: string[]; // rule/section ids this rule links to
	children: RuleNode[];
}
export interface Section {
	slug: string; // "1".."23" | "preface" | "appendix-a".."appendix-g"
	anchorId: string; // source anchor: "1" | "preface" | "appendix_a"
	number: string | null; // "1".."23" | "A".."G" | null (preface)
	kind: 'preface' | 'section' | 'appendix';
	title: string; // "Introduction", "Field Diagram"
	html: string | null; // section-level non-rule content (preface body, appendix tables)
	rules: RuleNode[];
}
export interface TocEntry { slug: string; number: string | null; kind: Section['kind']; title: string; ruleCount: number; }
export interface Manifest {
	id: string; title: string; shortTitle: string; edition: string;
	sourceUrl: string; sectionScheme: 'numeric' | 'alpha'; fetchedAt: string;
	sections: TocEntry[];
}
export interface GlossaryEntry { ruleId: string; term: string; definition: string; }
```

Zod schemas exported alongside: `RuleNodeSchema`, `SectionSchema`, `TocEntrySchema`, `ManifestSchema`, `GlossaryEntrySchema` (each `z.ZodType` of the interface above; `RuleNodeSchema` via `z.lazy` for recursion). All strings `.min(1)` except `html`/`text`/`definition` may be `''`-allowed only for `html`.

- [ ] **Step 1: Write failing tests**

`src/lib/content/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ManifestSchema, RuleNodeSchema, SectionSchema, GlossaryEntrySchema } from './types';

const rule = {
	id: '2.D.1',
	label: '2.D.1.',
	html: 'know and abide by the rules;',
	text: 'know and abide by the rules;',
	annotations: [],
	refs: [],
	children: []
};

describe('content schemas', () => {
	it('accepts a valid nested rule node', () => {
		const parent = { ...rule, id: '2.D', label: '2.D.', children: [rule] };
		expect(RuleNodeSchema.parse(parent).children).toHaveLength(1);
	});

	it('rejects a rule without an id', () => {
		expect(() => RuleNodeSchema.parse({ ...rule, id: '' })).toThrow();
	});

	it('accepts a valid section and manifest', () => {
		const section = {
			slug: '2', anchorId: '2', number: '2', kind: 'section',
			title: 'Spirit of the Game', html: null, rules: [rule]
		};
		expect(SectionSchema.parse(section).kind).toBe('section');
		const manifest = {
			id: 'usau-official-2026-27', title: 'Official Rules of Ultimate',
			shortTitle: 'Official Rules', edition: '2026-2027',
			sourceUrl: 'https://usaultimate.org/rules/', sectionScheme: 'numeric',
			fetchedAt: '2026-07-09T00:00:00.000Z',
			sections: [{ slug: '2', number: '2', kind: 'section', title: 'Spirit of the Game', ruleCount: 5 }]
		};
		expect(ManifestSchema.parse(manifest).sections[0].ruleCount).toBe(5);
	});

	it('rejects a bad section kind and a bad glossary entry', () => {
		expect(() => SectionSchema.parse({ slug: 'x', anchorId: 'x', number: null, kind: 'chapter', title: 'X', html: null, rules: [] })).toThrow();
		expect(() => GlossaryEntrySchema.parse({ ruleId: '3.A', term: '', definition: 'd' })).toThrow();
	});
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test` → FAIL (module `./types` not found).

- [ ] **Step 3: Implement `src/lib/content/types.ts`** exactly per the Interfaces block above (interfaces + Zod schemas + `export type`s). Keep it under ~90 lines; no extra fields.

- [ ] **Step 4: Run tests** — `npm run test` → PASS.

- [ ] **Step 5: Validation script** — `scripts/validate-content.ts`:

```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestSchema, SectionSchema, GlossaryEntrySchema } from '../src/lib/content/types';
import { z } from 'zod';

const root = 'content/rulesets';
if (!existsSync(root)) {
	console.log('no content yet — skipping');
	process.exit(0);
}
let checked = 0;
for (const id of readdirSync(root)) {
	const dir = join(root, id);
	const manifest = ManifestSchema.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
	if (manifest.id !== id) throw new Error(`manifest id ${manifest.id} != dir ${id}`);
	for (const entry of manifest.sections) {
		const section = SectionSchema.parse(
			JSON.parse(readFileSync(join(dir, 'sections', `${entry.slug}.json`), 'utf8'))
		);
		if (section.slug !== entry.slug) throw new Error(`slug mismatch in ${id}/${entry.slug}`);
		checked++;
	}
	z.array(GlossaryEntrySchema).parse(JSON.parse(readFileSync(join(dir, 'glossary.json'), 'utf8')));
}
console.log(`✓ content valid (${checked} sections)`);
```

Run `npm run validate:content` → expect `no content yet — skipping`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: content Zod schemas + CI validation script"
```

---

### Task 4: Ingest — parser core

**Files:**
- Create: `scripts/ingest/parse.ts`
- Create: `scripts/ingest/fixtures/sample.html`
- Test: `scripts/ingest/parse.test.ts`

**Interfaces:**
- Consumes: types from `src/lib/content/types` (import path `../../src/lib/content/types`).
- Produces: `parseRulesHtml(html: string): { sections: Section[] }` — sections in document order (preface first, then 1..23, then appendices). `RuleNode.html` here is still RAW (source hrefs/images untouched, no glossary wrapping); `refs: []` at this stage. Annotations extracted and stripped.

**Source HTML facts (verified against the live page 2026-07-09):**
- Two `<ul class="main-rules">` blocks: first holds sections `1`–`23`, second holds appendices (`<a id="appendix_a">Appendix A:</a> Field Diagram`, …).
- Every rule is an `<li>` whose first element child is `<a id="2.D.1">2.D.1.</a>`, followed by inline content, then optionally a nested `<ul>` of child rules. Appendix rule ids look like `B1.G.1`, `C1.A.2.a`.
- Official annotations: `<span class="annotation">[[…]]</span>` as direct children of an `<li>` (sometimes after the nested `<ul>`).
- Preface: `<p id="preface_title"><a id="preface"></a>Preface</p><p id="prefaceBody">…</p>` (outside the `main-rules` lists).
- Appendix A/D contain `<div class="plain">` blocks with `<table>`s and `<img>`s (hotlinked to raw.githubusercontent.com) instead of / in addition to rule lists.

- [ ] **Step 1: Create the fixture** — `scripts/ingest/fixtures/sample.html` (hand-trimmed replica of the real structure; keep exactly this):

```html
<html><body>
<p id="preface_title"><a id="preface"></a>Preface</p>
<p id="prefaceBody">Ultimate is a sport that inspires players and fans alike.</p>
<ul class="main-rules">
	<li>
		<a id="1">1.</a> Introduction
		<ul>
			<li><a id="1.A">1.A.</a> Description: Ultimate is a non-contact, self-officiated disc sport.</li>
			<li>
				<a id="1.B">1.B.</a> Rules Variations
				<ul>
					<li><a id="1.B.1">1.B.1.</a> Appendices outline rules changes, per <a href="https://usaultimate.org/rules/#appendix_b">Appendix B</a>.</li>
					<li><a id="1.B.2">1.B.2.</a> Event Organizer Clause: see <a href="https://usaultimate.org/rules/#12.A">12.A</a>.</li>
				</ul>
				<span class="annotation">[[Organizers should announce variations before play.]]</span>
			</li>
		</ul>
	</li>
	<li>
		<a id="3">3.</a> Definitions
		<ul>
			<li><a id="3.A">3.A.</a> Best perspective: The most complete view available by a player.</li>
			<li><a id="3.B">3.B.</a> Brick: A pull landing out-of-bounds, untouched.</li>
		</ul>
	</li>
</ul>
<ul class="main-rules">
	<li>
		<a id="appendix_a">Appendix A:</a> Field Diagram
		<div class="plain"><table class="fieldDiagram"><tbody><tr><td>
			<img decoding="async" src="https://raw.githubusercontent.com/andrewlovseth/rules-of-ultimate/master/images/field.png" />
		</td></tr></tbody></table></div>
	</li>
	<li>
		<a id="appendix_b">Appendix B:</a> Mixed Rules and Adaptations
		<ul>
			<li><a id="B1">B1.</a> Personnel
				<ul><li><a id="B1.A">B1.A.</a> Mixed teams play with seven players.</li></ul>
			</li>
		</ul>
	</li>
</ul>
</body></html>
```

- [ ] **Step 2: Write failing tests** — `scripts/ingest/parse.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRulesHtml } from './parse';

const html = readFileSync('scripts/ingest/fixtures/sample.html', 'utf8');
const { sections } = parseRulesHtml(html);
const byslug = Object.fromEntries(sections.map((s) => [s.slug, s]));

describe('parseRulesHtml', () => {
	it('finds preface, numbered sections, and appendices in order', () => {
		expect(sections.map((s) => s.slug)).toEqual(['preface', '1', '3', 'appendix-a', 'appendix-b']);
		expect(byslug['preface'].kind).toBe('preface');
		expect(byslug['preface'].html).toContain('inspires players');
		expect(byslug['1']).toMatchObject({ number: '1', kind: 'section', title: 'Introduction' });
		expect(byslug['appendix-b']).toMatchObject({ number: 'B', kind: 'appendix', title: 'Mixed Rules and Adaptations' });
	});

	it('builds the nested rule tree with labels', () => {
		const s1 = byslug['1'];
		expect(s1.rules.map((r) => r.id)).toEqual(['1.A', '1.B']);
		const b = s1.rules[1];
		expect(b.label).toBe('1.B.');
		expect(b.children.map((r) => r.id)).toEqual(['1.B.1', '1.B.2']);
		expect(b.children[0].text).toContain('Appendices outline rules changes');
	});

	it('extracts annotations and strips them from html/text', () => {
		const b = byslug['1'].rules[1];
		expect(b.annotations).toEqual(['Organizers should announce variations before play.']);
		expect(b.html).not.toContain('annotation');
		expect(b.text).not.toContain('[[');
	});

	it('keeps raw cross-reference hrefs at this stage', () => {
		expect(byslug['1'].rules[1].children[1].html).toContain('https://usaultimate.org/rules/#12.A');
	});

	it('captures appendix non-rule html (tables/images) as section html', () => {
		expect(byslug['appendix-a'].rules).toHaveLength(0);
		expect(byslug['appendix-a'].html).toContain('<table');
		expect(byslug['appendix-b'].rules[0].children[0].id).toBe('B1.A');
	});

	it('rule text excludes descendant rules', () => {
		expect(byslug['1'].rules[1].text).toBe('Rules Variations');
	});
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run scripts/ingest/parse.test.ts` → FAIL (parse.ts missing).

- [ ] **Step 4: Implement `scripts/ingest/parse.ts`**

```ts
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { RuleNode, Section } from '../../src/lib/content/types';

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

function parseRuleLi($: CheerioAPI, li: Cheerio<AnyNode>): RuleNode | null {
	const anchor = li.children('a[id]').first();
	if (anchor.length === 0) return null;
	const id = anchor.attr('id')!;
	const label = normalize(anchor.text());

	const children: RuleNode[] = [];
	li.children('ul').each((_, ul) => {
		$(ul)
			.children('li')
			.each((_, child) => {
				const node = parseRuleLi($, $(child));
				if (node) children.push(node);
			});
	});

	const annotations: string[] = [];
	li.children('span.annotation').each((_, el) => {
		annotations.push(normalize($(el).text()).replace(/^\[\[/, '').replace(/\]\]$/, ''));
	});

	// own content = li minus anchor, nested uls, annotations
	const clone = li.clone();
	clone.children('ul').remove();
	clone.children('span.annotation').remove();
	clone.children('a[id]').first().remove();
	const html = normalize(clone.html() ?? '');
	const text = normalize(clone.text());

	return { id, label, html, text, annotations, refs: [], children };
}

function sectionFromLi($: CheerioAPI, li: Cheerio<AnyNode>): Section | null {
	const anchor = li.children('a[id]').first();
	if (anchor.length === 0) return null;
	const anchorId = anchor.attr('id')!;
	const appendixMatch = anchorId.match(/^appendix_([a-g])$/);

	const rules: RuleNode[] = [];
	li.children('ul').each((_, ul) => {
		$(ul)
			.children('li')
			.each((_, child) => {
				const node = parseRuleLi($, $(child));
				if (node) rules.push(node);
			});
	});

	// title = li text minus anchor text, minus rule/extra content
	const clone = li.clone();
	clone.children('ul').remove();
	clone.children('div').remove();
	clone.children('a[id]').first().remove();
	const title = normalize(clone.text());

	// non-rule section content (appendix tables/diagrams)
	let html: string | null = null;
	const extras = li.children('div');
	if (extras.length > 0) html = normalize(extras.toArray().map((d) => $.html(d)).join('\n'));

	if (appendixMatch) {
		const letter = appendixMatch[1].toUpperCase();
		return { slug: `appendix-${appendixMatch[1]}`, anchorId, number: letter, kind: 'appendix', title, html, rules };
	}
	return { slug: anchorId, anchorId, number: anchorId, kind: 'section', title, html, rules };
}

export function parseRulesHtml(html: string): { sections: Section[] } {
	const $ = cheerio.load(html);
	const sections: Section[] = [];

	const prefaceBody = $('#prefaceBody');
	if (prefaceBody.length > 0) {
		sections.push({
			slug: 'preface', anchorId: 'preface', number: null, kind: 'preface',
			title: 'Preface', html: normalize(prefaceBody.html() ?? ''), rules: []
		});
	}

	$('ul.main-rules').each((_, ul) => {
		$(ul)
			.children('li')
			.each((_, li) => {
				const section = sectionFromLi($, $(li));
				if (section) sections.push(section);
			});
	});

	if (sections.length === 0) throw new Error('no sections found — did the source markup change?');
	return { sections };
}
```

- [ ] **Step 5: Run tests** — `npx vitest run scripts/ingest/parse.test.ts` → PASS (fix implementation, not tests, if not).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: ingest parser for USAU rules HTML (sections, rule tree, annotations)"
```

---

### Task 5: Ingest — transforms (cross-refs, images, glossary, grounding, search)

**Files:**
- Create: `scripts/ingest/transform.ts`
- Test: `scripts/ingest/transform.test.ts`

**Interfaces:**
- Consumes: `Section`, `RuleNode`, `GlossaryEntry` types; parser output shape.
- Produces (exact signatures — Task 6 calls these in this order):

```ts
export function sectionSlugForRuleId(id: string): string | null; // "15.A.3"→"15", "B1.G"→"appendix-b", "appendix_c"→"appendix-c", "preface"→"preface", else null
export function rewriteCrossRefs(sections: Section[], rulesetId: string): void; // mutates html (internal hrefs) + fills refs[]
export function collectImageUrls(sections: Section[]): string[]; // unique, document order
export function rewriteImageUrls(sections: Section[], map: Map<string, string>): void; // src → local path
export function extractGlossary(sections: Section[]): GlossaryEntry[]; // from section slug "3"
export function wrapGlossaryTerms(sections: Section[], glossary: GlossaryEntry[]): void; // adds <dfn data-rule="3.A">
export function buildGrounding(sections: Section[], header: string): string;
export function buildSearchIndexJson(sections: Section[]): string; // serialized MiniSearch
export const SEARCH_OPTIONS: object; // shared client/server MiniSearch options
```

Behavior details:
- `rewriteCrossRefs`: for every `<a href>` matching `https://usaultimate.org/rules/#<id>` (also tolerate `href="#<id>"`), map to `/rules/${rulesetId}/${sectionSlugForRuleId(id)}#${id}` (section-level ids like `12` link to `/rules/${rulesetId}/12` with no hash). Unmappable ids: leave href unchanged. Push the raw id into the owning rule's `refs` (deduped). Operate per rule node with cheerio (`cheerio.load(html, null, false)` fragment mode).
- `extractGlossary`: section `3`'s top-level rules; `term` = text before the first `:` (must be 2–60 chars, otherwise skip); `definition` = full rule `text` (keep the term prefix — it reads fine).
- `wrapGlossaryTerms`: for each rule in every section EXCEPT slug `3`, wrap the FIRST case-insensitive whole-word occurrence of each term in the rule's own `html` text nodes (not inside `<a>`/`<dfn>`) with `<dfn data-rule="${ruleId}">…</dfn>`. Match longest terms first. Use cheerio fragment traversal of text nodes, not a global regex over html.
- `buildGrounding`: header line, then per section `\n## ${number ? number + '. ' : ''}${title}`, then one line per rule (depth-first): `${'  '.repeat(depth)}[${id}] ${text}` plus `${indent}  (annotation) ${a}` lines. Appendix/section `html` content: append its cheerio `.text()` normalized.
- `buildSearchIndexJson`: MiniSearch with `SEARCH_OPTIONS = { fields: ['text', 'label', 'sectionTitle'], storeFields: ['label', 'text', 'sectionSlug', 'sectionTitle'] }`; documents = every rule (all depths): `{ id, label, text, sectionSlug, sectionTitle }`. Return `JSON.stringify(mini)`.

- [ ] **Step 1: Write failing tests** — `scripts/ingest/transform.test.ts` (reuse the Task 4 fixture through `parseRulesHtml`):

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import MiniSearch from 'minisearch';
import { parseRulesHtml } from './parse';
import {
	SEARCH_OPTIONS, buildGrounding, buildSearchIndexJson, collectImageUrls,
	extractGlossary, rewriteCrossRefs, rewriteImageUrls, sectionSlugForRuleId, wrapGlossaryTerms
} from './transform';

const fixture = () => parseRulesHtml(readFileSync('scripts/ingest/fixtures/sample.html', 'utf8')).sections;

describe('sectionSlugForRuleId', () => {
	it('maps ids to section slugs', () => {
		expect(sectionSlugForRuleId('15.A.3')).toBe('15');
		expect(sectionSlugForRuleId('12')).toBe('12');
		expect(sectionSlugForRuleId('B1.G.1')).toBe('appendix-b');
		expect(sectionSlugForRuleId('appendix_c')).toBe('appendix-c');
		expect(sectionSlugForRuleId('preface')).toBe('preface');
		expect(sectionSlugForRuleId('not-a-rule')).toBeNull();
	});
});

describe('rewriteCrossRefs', () => {
	it('rewrites source hrefs to internal routes and records refs', () => {
		const sections = fixture();
		rewriteCrossRefs(sections, 'usau-official-2026-27');
		const rule = sections.find((s) => s.slug === '1')!.rules[1].children[1]; // 1.B.2
		expect(rule.html).toContain('href="/rules/usau-official-2026-27/12#12.A"');
		expect(rule.refs).toEqual(['12.A']);
		const sibling = sections.find((s) => s.slug === '1')!.rules[1].children[0]; // 1.B.1 → appendix_b
		expect(sibling.html).toContain('href="/rules/usau-official-2026-27/appendix-b"');
	});
});

describe('images', () => {
	it('collects and rewrites image urls', () => {
		const sections = fixture();
		const urls = collectImageUrls(sections);
		expect(urls).toEqual(['https://raw.githubusercontent.com/andrewlovseth/rules-of-ultimate/master/images/field.png']);
		rewriteImageUrls(sections, new Map([[urls[0], '/rules-media/field.png']]));
		expect(sections.find((s) => s.slug === 'appendix-a')!.html).toContain('src="/rules-media/field.png"');
	});
});

describe('glossary', () => {
	it('extracts terms from section 3', () => {
		const glossary = extractGlossary(fixture());
		expect(glossary).toMatchObject([
			{ ruleId: '3.A', term: 'Best perspective' },
			{ ruleId: '3.B', term: 'Brick' }
		]);
	});

	it('wraps first whole-word occurrences outside links, not in section 3', () => {
		const sections = fixture();
		// plant an occurrence
		const r = sections.find((s) => s.slug === '1')!.rules[0]; // 1.A
		r.html += ' A brick restarts at the brick mark.';
		const glossary = extractGlossary(sections);
		wrapGlossaryTerms(sections, glossary);
		const wrapped = r.html.match(/<dfn data-rule="3.B">brick<\/dfn>/gi) ?? [];
		expect(wrapped).toHaveLength(1); // first occurrence only
		const defs = sections.find((s) => s.slug === '3')!.rules[0].html;
		expect(defs).not.toContain('<dfn'); // never inside definitions themselves
	});
});

describe('grounding + search', () => {
	it('builds a cited grounding document', () => {
		const g = buildGrounding(fixture(), 'Official Rules of Ultimate (2026-2027)');
		expect(g).toContain('## 1. Introduction');
		expect(g).toContain('[1.B.1]');
		expect(g).toContain('(annotation) Organizers should announce variations before play.');
	});

	it('builds a loadable MiniSearch index', () => {
		const json = buildSearchIndexJson(fixture());
		const mini = MiniSearch.loadJSON(json, SEARCH_OPTIONS as never);
		const hits = mini.search('self-officiated');
		expect(hits[0].id).toBe('1.A');
	});
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run scripts/ingest/transform.test.ts` → FAIL.

- [ ] **Step 3: Implement `scripts/ingest/transform.ts`** per the Interfaces block. Implementation notes (follow them):
  - Walk rules with a shared `function walkRules(sections, fn: (rule, section) => void)` helper (depth-first).
  - `rewriteCrossRefs`/`wrapGlossaryTerms`/`rewriteImageUrls` re-serialize each rule/section `html` via fragment loads: `const $ = cheerio.load(rule.html, null, false); … rule.html = $.html();` — never regex over HTML for anchors/text nodes.
  - `wrapGlossaryTerms` text-node walk: `$('*').contents().filter(n => n.type === 'text')` plus root-level text nodes; skip when any ancestor is `a` or `dfn`; build one `RegExp(`\\b(${escaped})\\b`, 'i')` per term, longest first; track a per-rule `Set` of wrapped ruleIds.
  - Escape regex metacharacters in terms (`term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`).

- [ ] **Step 4: Run tests** — `npx vitest run scripts/ingest` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: ingest transforms — xrefs, images, glossary, grounding, search index"
```

---

### Task 6: Ingest — CLI, real run, committed content

**Files:**
- Create: `scripts/ingest/config.ts`, `scripts/ingest/index.ts`
- Create (generated): `content/sources/usau-official-2026-27.html`, `content/rulesets/usau-official-2026-27/**`, `static/search/usau-official-2026-27.json`, `static/rules-media/*`

**Interfaces:**
- Consumes: `parseRulesHtml`, all Task 5 transforms, Zod schemas.
- Produces: the on-disk content layout every app task reads:
  - `content/rulesets/<id>/manifest.json` (Manifest)
  - `content/rulesets/<id>/sections/<slug>.json` (Section, one per TOC entry)
  - `content/rulesets/<id>/glossary.json` (GlossaryEntry[])
  - `content/rulesets/<id>/grounding.txt`
  - `static/search/<id>.json` (MiniSearch serialization)
  - `static/rules-media/<basename>` (downloaded images)

- [ ] **Step 1: Ruleset registry** — `scripts/ingest/config.ts`:

```ts
export interface RulesetConfig {
	id: string;
	title: string;
	shortTitle: string;
	edition: string;
	sourceUrl: string;
	sectionScheme: 'numeric' | 'alpha';
}

export const RULESETS: RulesetConfig[] = [
	{
		id: 'usau-official-2026-27',
		title: 'Official Rules of Ultimate',
		shortTitle: 'Official Rules',
		edition: '2026-2027',
		sourceUrl: 'https://usaultimate.org/rules/',
		sectionScheme: 'numeric'
	}
];
```

- [ ] **Step 2: CLI** — `scripts/ingest/index.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { ManifestSchema, SectionSchema, type Manifest } from '../../src/lib/content/types';
import { RULESETS } from './config';
import { parseRulesHtml } from './parse';
import {
	buildGrounding, buildSearchIndexJson, collectImageUrls, extractGlossary,
	rewriteCrossRefs, rewriteImageUrls, wrapGlossaryTerms
} from './transform';

const UA = 'Mozilla/5.0 (compatible; BestPerspective ingest; +https://github.com/camhpj)';
const refetch = process.argv.includes('--refetch');

async function fetchText(url: string): Promise<string> {
	const res = await fetch(url, { headers: { 'user-agent': UA } });
	if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
	return res.text();
}

for (const cfg of RULESETS) {
	const snapshotPath = join('content/sources', `${cfg.id}.html`);
	mkdirSync('content/sources', { recursive: true });
	if (refetch || !existsSync(snapshotPath)) {
		console.log(`fetching ${cfg.sourceUrl}`);
		writeFileSync(snapshotPath, await fetchText(cfg.sourceUrl));
	}
	const { sections } = parseRulesHtml(readFileSync(snapshotPath, 'utf8'));

	rewriteCrossRefs(sections, cfg.id);
	const glossary = extractGlossary(sections);
	wrapGlossaryTerms(sections, glossary);

	// images → static/rules-media
	mkdirSync('static/rules-media', { recursive: true });
	const urlMap = new Map<string, string>();
	for (const url of collectImageUrls(sections)) {
		const name = basename(new URL(url).pathname);
		const local = join('static/rules-media', name);
		if (!existsSync(local)) {
			console.log(`downloading ${name}`);
			const res = await fetch(url, { headers: { 'user-agent': UA } });
			if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
			writeFileSync(local, Buffer.from(await res.arrayBuffer()));
		}
		urlMap.set(url, `/rules-media/${name}`);
	}
	rewriteImageUrls(sections, urlMap);

	const manifest: Manifest = {
		id: cfg.id, title: cfg.title, shortTitle: cfg.shortTitle, edition: cfg.edition,
		sourceUrl: cfg.sourceUrl, sectionScheme: cfg.sectionScheme,
		fetchedAt: new Date().toISOString(),
		sections: sections.map((s) => ({
			slug: s.slug, number: s.number, kind: s.kind, title: s.title,
			ruleCount: countRules(s)
		}))
	};

	const dir = join('content/rulesets', cfg.id);
	mkdirSync(join(dir, 'sections'), { recursive: true });
	writeFileSync(join(dir, 'manifest.json'), JSON.stringify(ManifestSchema.parse(manifest), null, '\t'));
	for (const s of sections) {
		writeFileSync(join(dir, 'sections', `${s.slug}.json`), JSON.stringify(SectionSchema.parse(s), null, '\t'));
	}
	writeFileSync(join(dir, 'glossary.json'), JSON.stringify(glossary, null, '\t'));
	writeFileSync(join(dir, 'grounding.txt'), buildGrounding(sections, `${cfg.title} (${cfg.edition})\nSource: ${cfg.sourceUrl}`));
	mkdirSync('static/search', { recursive: true });
	writeFileSync(join('static/search', `${cfg.id}.json`), buildSearchIndexJson(sections));

	const total = manifest.sections.reduce((n, s) => n + s.ruleCount, 0);
	console.log(`✓ ${cfg.id}: ${manifest.sections.length} sections, ${total} rules, ${glossary.length} glossary terms`);
}

function countRules(s: { rules: { children: unknown[] }[] }): number {
	let n = 0;
	const walk = (nodes: { children: unknown[] }[]) => {
		for (const node of nodes) { n++; walk(node.children as never); }
	};
	walk(s.rules as never);
	return n;
}
```

- [ ] **Step 3: Run the real ingest**

```bash
npm run ingest
npm run validate:content
```

Expected sanity numbers (fail the task and investigate the parser if far off):
- **31 sections** (preface + 23 sections + 7 appendices)
- **≥ 650 rules** total; glossary **≥ 25 terms** (all of section 3's top-level entries)
- ≥ 100 distinct rule refs across the doc; ~92 annotations
- `static/rules-media/` gains the appendix images (field.png, lines.png, hand-signal images, …)
- `validate:content` prints `✓ content valid (31 sections)`

Spot-check `content/rulesets/usau-official-2026-27/sections/3.json`: rule `3.A` term "Best perspective" present; `sections/2.json` has the annotation about discussions not exceeding thirty seconds.

- [ ] **Step 4: Commit content**

```bash
git add -A && git commit -m "feat: ingest CLI + USAU Official Rules 2026-27 content artifacts"
```

---

### Task 7: Content loader + explorer routes (TOC + reading view)

**Files:**
- Create: `src/lib/content/load.ts`, `src/lib/content/load.test.ts`
- Create: `src/routes/rules/+page.svelte`, `src/routes/rules/+page.ts`
- Create: `src/routes/rules/[ruleset]/+page.ts`, `src/routes/rules/[ruleset]/+page.svelte`
- Create: `src/routes/rules/[ruleset]/[section]/+page.ts`, `src/routes/rules/[ruleset]/[section]/+page.svelte`
- Create: `src/lib/components/rules/TocSidebar.svelte`, `src/lib/components/rules/RuleNode.svelte`

**Interfaces:**
- Consumes: content JSON via `$content` alias; types from Task 3.
- Produces:

```ts
// src/lib/content/load.ts — build-time (prerender) content access
export function listRulesets(): Manifest[];
export function getManifest(rulesetId: string): Manifest; // throws 404-style Error if unknown
export function getSection(rulesetId: string, slug: string): Section;
export function getGlossary(rulesetId: string): GlossaryEntry[];
```

Routes produced: `/rules`, `/rules/usau-official-2026-27`, `/rules/usau-official-2026-27/[section]` — all prerendered via `entries`.

- [ ] **Step 1: Failing loader tests** — `src/lib/content/load.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getGlossary, getManifest, getSection, listRulesets } from './load';

describe('content loader (against real committed content)', () => {
	it('lists the official ruleset', () => {
		expect(listRulesets().map((m) => m.id)).toContain('usau-official-2026-27');
	});
	it('loads manifest with 31 ordered sections', () => {
		const m = getManifest('usau-official-2026-27');
		expect(m.sections).toHaveLength(31);
		expect(m.sections[0].slug).toBe('preface');
	});
	it('loads a section with rules', () => {
		const s = getSection('usau-official-2026-27', '2');
		expect(s.title).toBe('Spirit of the Game');
		expect(s.rules.length).toBeGreaterThan(3);
	});
	it('loads glossary including Best perspective', () => {
		const terms = getGlossary('usau-official-2026-27').map((g) => g.term.toLowerCase());
		expect(terms).toContain('best perspective');
	});
	it('throws on unknown ids', () => {
		expect(() => getManifest('nope')).toThrow();
		expect(() => getSection('usau-official-2026-27', '99')).toThrow();
	});
});
```

- [ ] **Step 2: Run to verify failure**, then implement `src/lib/content/load.ts`:

```ts
import { ManifestSchema, SectionSchema, GlossaryEntrySchema, type GlossaryEntry, type Manifest, type Section } from './types';
import { z } from 'zod';

const manifests = import.meta.glob('$content/rulesets/*/manifest.json', { eager: true }) as Record<string, { default: unknown }>;
const sections = import.meta.glob('$content/rulesets/*/sections/*.json', { eager: true }) as Record<string, { default: unknown }>;
const glossaries = import.meta.glob('$content/rulesets/*/glossary.json', { eager: true }) as Record<string, { default: unknown }>;

const byId = new Map<string, Manifest>();
for (const mod of Object.values(manifests)) {
	const m = ManifestSchema.parse(mod.default);
	byId.set(m.id, m);
}

export function listRulesets(): Manifest[] {
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getManifest(rulesetId: string): Manifest {
	const m = byId.get(rulesetId);
	if (!m) throw new Error(`unknown ruleset: ${rulesetId}`);
	return m;
}

export function getSection(rulesetId: string, slug: string): Section {
	getManifest(rulesetId);
	const key = Object.keys(sections).find((k) => k.includes(`/${rulesetId}/sections/${slug}.json`));
	if (!key) throw new Error(`unknown section: ${rulesetId}/${slug}`);
	return SectionSchema.parse(sections[key].default);
}

export function getGlossary(rulesetId: string): GlossaryEntry[] {
	const key = Object.keys(glossaries).find((k) => k.includes(`/${rulesetId}/glossary.json`));
	if (!key) throw new Error(`unknown ruleset: ${rulesetId}`);
	return z.array(GlossaryEntrySchema).parse(glossaries[key].default);
}
```

Note: if `import.meta.glob` with the `$content` alias fails under vitest, add the same alias to `vite.config.ts` `test`-visible config via `resolve: { alias: { $content: '/content' } }` — keep svelte.config.js as the source of truth for the app.

- [ ] **Step 3: Run tests** — PASS.

- [ ] **Step 4: Routes.**

`src/routes/rules/+page.ts`:

```ts
import { listRulesets } from '$lib/content/load';
export const load = () => ({ rulesets: listRulesets() });
```

`src/routes/rules/+page.svelte` — page title "Rulebooks"; grid of white rounded cards (one per ruleset): chip with `edition`, `display` title, section/rule counts, link to `/rules/{id}`. Style: white card `rounded-xl bg-white text-navy p-6 hover:-translate-y-0.5 transition` on the navy shell, cardinal arrow affordance (match the landing mockup's entry-card language).

`src/routes/rules/[ruleset]/+page.ts`:

```ts
import { getManifest, listRulesets } from '$lib/content/load';
import { error } from '@sveltejs/kit';

export const entries = () => listRulesets().map((m) => ({ ruleset: m.id }));
export const load = ({ params }) => {
	try {
		return { manifest: getManifest(params.ruleset) };
	} catch {
		error(404, 'Unknown ruleset');
	}
};
```

`src/routes/rules/[ruleset]/+page.svelte` — ruleset overview: chip (edition), `display` h1 (title), source attribution link, then the TOC as a two-column list of white cards grouped: Preface, numbered sections (show `number.` + title + ruleCount), Appendices. Each links to `/rules/{manifest.id}/{slug}`.

`src/routes/rules/[ruleset]/[section]/+page.ts`:

```ts
import { getManifest, getSection, getGlossary, listRulesets } from '$lib/content/load';
import { error } from '@sveltejs/kit';

export const entries = () =>
	listRulesets().flatMap((m) => m.sections.map((s) => ({ ruleset: m.id, section: s.slug })));

export const load = ({ params }) => {
	try {
		const manifest = getManifest(params.ruleset);
		return {
			manifest,
			section: getSection(params.ruleset, params.section),
			glossary: getGlossary(params.ruleset)
		};
	} catch {
		error(404, 'Unknown section');
	}
};
```

`src/lib/components/rules/RuleNode.svelte` (recursive; Svelte 5 self-import):

```svelte
<script lang="ts">
	import type { RuleNode as TRuleNode } from '$lib/content/types';
	import RuleNode from './RuleNode.svelte';
	let { node, depth = 0 }: { node: TRuleNode; depth?: number } = $props();
</script>

<div id={node.id} class="scroll-mt-24 {depth > 0 ? 'mt-3 ml-4 border-l border-mist pl-4 sm:ml-5' : 'mt-6'}">
	<div class="group flex items-baseline gap-2">
		<a
			href="#{node.id}"
			class="shrink-0 font-mono text-[13px] font-semibold text-cardinal no-underline hover:underline"
			title="Link to {node.id}">{node.label}</a
		>
		<div class="rule-html min-w-0 text-[15px] leading-relaxed text-navy">
			{@html node.html}
		</div>
	</div>
	{#each node.annotations as annotation (annotation)}
		<aside class="mt-2 rounded-md border-l-2 border-cardinal/60 bg-mist px-3 py-2 text-sm text-navy/80">
			<span class="text-[10px] font-bold tracking-wider text-cardinal uppercase">Official annotation</span>
			<p class="mt-0.5">{annotation}</p>
		</aside>
	{/each}
	{#each node.children as child (child.id)}
		<RuleNode node={child} depth={depth + 1} />
	{/each}
</div>
```

`src/lib/components/rules/TocSidebar.svelte`:

```svelte
<script lang="ts">
	import type { Manifest } from '$lib/content/types';
	let { manifest, current }: { manifest: Manifest; current: string } = $props();
</script>

<nav aria-label="Sections" class="space-y-0.5 text-sm">
	{#each manifest.sections as s (s.slug)}
		<a
			href="/rules/{manifest.id}/{s.slug}"
			aria-current={s.slug === current ? 'page' : undefined}
			class="block rounded-md px-3 py-1.5 transition-colors
				{s.slug === current ? 'bg-white/10 font-semibold text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'}"
		>
			{#if s.number}<span class="mr-1.5 font-mono text-xs text-cardinal">{s.number}.</span>{/if}
			{s.title}
		</a>
	{/each}
</nav>
```

`src/routes/rules/[ruleset]/[section]/+page.svelte`:

```svelte
<script lang="ts">
	import TocSidebar from '$lib/components/rules/TocSidebar.svelte';
	import RuleNode from '$lib/components/rules/RuleNode.svelte';
	let { data } = $props();
	const idx = $derived(data.manifest.sections.findIndex((s) => s.slug === data.section.slug));
	const prev = $derived(data.manifest.sections[idx - 1]);
	const next = $derived(data.manifest.sections[idx + 1]);
</script>

<svelte:head><title>{data.section.title} · {data.manifest.shortTitle} · Best Perspective</title></svelte:head>

<div class="mx-auto flex max-w-6xl gap-8 px-4 py-8 sm:px-6">
	<aside class="sticky top-24 hidden max-h-[calc(100vh-8rem)] w-64 shrink-0 self-start overflow-y-auto lg:block">
		<TocSidebar manifest={data.manifest} current={data.section.slug} />
	</aside>

	<article class="min-w-0 flex-1 rounded-xl bg-white p-6 text-navy sm:p-10">
		<p class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">
			{data.manifest.title} · {data.manifest.edition}
		</p>
		<h1 class="display mt-2 text-4xl text-navy sm:text-5xl">
			{#if data.section.number}<span class="text-cardinal">{data.section.number}.</span>{/if}
			{data.section.title}
		</h1>

		{#if data.section.html}
			<div class="rule-html mt-6 leading-relaxed">{@html data.section.html}</div>
		{/if}
		{#each data.section.rules as rule (rule.id)}
			<RuleNode node={rule} />
		{/each}

		<nav class="mt-10 flex justify-between border-t border-mist pt-6 text-sm font-semibold">
			{#if prev}<a class="text-navy/70 hover:text-cardinal" href="/rules/{data.manifest.id}/{prev.slug}">← {prev.title}</a>{:else}<span></span>{/if}
			{#if next}<a class="text-navy/70 hover:text-cardinal" href="/rules/{data.manifest.id}/{next.slug}">{next.title} →</a>{/if}
		</nav>
	</article>
</div>
```

Add scoped `.rule-html` styles in `src/app.css` (links cardinal-underlined; `dfn` dotted-underlined, not italic, `cursor: help`; tables bordered `border-mist` with padded cells; images `max-width: 100%`).

- [ ] **Step 5: Verify** — `npm run check` passes; `npm run build` prerenders all 31+ section pages with zero crawl errors; `npm run dev`, open `/rules/usau-official-2026-27/2` — nested rules render with cardinal labels, annotation callouts, working prev/next; anchors scroll (`/rules/usau-official-2026-27/3#3.A`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: rules explorer — loader, TOC, prerendered reading view"
```

---

### Task 8: Glossary popovers + anchor highlight

**Files:**
- Create: `src/lib/components/rules/GlossaryPopover.svelte`
- Modify: `src/routes/rules/[ruleset]/[section]/+page.svelte` (mount popover + highlight logic)

**Interfaces:**
- Consumes: `GlossaryEntry[]` from page data; `<dfn data-rule="3.A">` elements produced by ingest.
- Produces: `<GlossaryPopover glossary={data.glossary} rulesetId={data.manifest.id} container={articleEl} />` — self-contained enrichment; no other task depends on its internals.

- [ ] **Step 1: Implement `GlossaryPopover.svelte`** — event delegation + Bits UI Popover with `customAnchor`:

```svelte
<script lang="ts">
	import { Popover } from 'bits-ui';
	import type { GlossaryEntry } from '$lib/content/types';

	let {
		glossary, rulesetId, container
	}: { glossary: GlossaryEntry[]; rulesetId: string; container: HTMLElement | undefined } = $props();

	let open = $state(false);
	let anchor = $state<HTMLElement | null>(null);
	let entry = $state<GlossaryEntry | null>(null);

	$effect(() => {
		if (!container) return;
		const onClick = (e: MouseEvent) => {
			const dfn = (e.target as HTMLElement).closest('dfn[data-rule]');
			if (!dfn || !container.contains(dfn)) return;
			e.preventDefault();
			entry = glossary.find((g) => g.ruleId === dfn.getAttribute('data-rule')) ?? null;
			anchor = dfn as HTMLElement;
			open = entry !== null;
		};
		container.addEventListener('click', onClick);
		return () => container.removeEventListener('click', onClick);
	});
</script>

<Popover.Root bind:open>
	<Popover.Portal>
		<Popover.Content
			customAnchor={anchor}
			sideOffset={6}
			class="z-50 max-w-sm rounded-lg border border-mist bg-white p-4 text-sm text-navy shadow-xl"
		>
			{#if entry}
				<p class="display text-lg text-navy">{entry.term}</p>
				<p class="mt-1 leading-relaxed text-navy/80">{entry.definition}</p>
				<a
					class="mt-2 inline-block text-xs font-semibold tracking-wider text-cardinal uppercase hover:underline"
					href="/rules/{rulesetId}/3#{entry.ruleId}"
				>
					Definition {entry.ruleId} →
				</a>
			{/if}
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
```

If the installed bits-ui version doesn't support `customAnchor` on `Popover.Content`, check its docs for the current anchor-override API (`Popover.Anchor` with `virtualEl` etc.) and adapt — requirement: popover opens next to the clicked `dfn`.

- [ ] **Step 2: Wire into the section page** — in `+page.svelte`: `let articleEl = $state<HTMLElement>()`, `bind:this={articleEl}` on the `<article>`, render `<GlossaryPopover glossary={data.glossary} rulesetId={data.manifest.id} container={articleEl} />` after it. Add anchor-highlight on navigation in the same component:

```ts
import { afterNavigate } from '$app/navigation';
afterNavigate(() => {
	const id = decodeURIComponent(location.hash.slice(1));
	if (!id) return;
	const el = document.getElementById(id);
	if (!el) return;
	el.scrollIntoView({ block: 'start' });
	el.classList.add('anchor-flash');
	setTimeout(() => el.classList.remove('anchor-flash'), 2000);
});
```

`src/app.css`:

```css
.anchor-flash {
	animation: anchor-flash 2s ease-out;
}
@keyframes anchor-flash {
	from { background-color: rgb(180 31 58 / 0.12); }
	to { background-color: transparent; }
}
```

- [ ] **Step 3: Verify** — `npm run dev`: on `/rules/usau-official-2026-27/9`, click a dotted-underlined term (e.g. "pull") → popover with definition + "Definition 3.X →" link that navigates and flashes the rule. `npm run check` passes.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: glossary popovers and rule-anchor highlight"
```

---

### Task 9: Cmd+K search

**Files:**
- Create: `src/lib/components/SearchDialog.svelte`
- Modify: `src/routes/+layout.svelte` (mount + shortcut), `src/lib/components/Nav.svelte` (search button)

**Interfaces:**
- Consumes: `static/search/usau-official-2026-27.json` (fetch at runtime), `SEARCH_OPTIONS`-equivalent MiniSearch options — duplicate them in a tiny shared module `src/lib/search/options.ts` (`export const SEARCH_OPTIONS = { fields: ['text', 'label', 'sectionTitle'], storeFields: ['label', 'text', 'sectionSlug', 'sectionTitle'] } as const;`) and refactor `scripts/ingest/transform.ts` to import from it (single source of truth; scripts may import from `src/lib`, never the reverse).
- Produces: global search dialog opening on `Cmd/Ctrl+K` or nav button click.

- [ ] **Step 1: Refactor options into `src/lib/search/options.ts`**; in `scripts/ingest/transform.ts` replace the local definition with `export { SEARCH_OPTIONS } from '../../src/lib/search/options';` (re-export — Task 5's tests import it from `./transform` and must keep passing). Run `npm run test` → still PASS.

- [ ] **Step 2: Implement `SearchDialog.svelte`:**

```svelte
<script lang="ts">
	import { Dialog } from 'bits-ui';
	import MiniSearch from 'minisearch';
	import { goto } from '$app/navigation';
	import { SEARCH_OPTIONS } from '$lib/search/options';

	const RULESET = 'usau-official-2026-27';
	let { open = $bindable(false) }: { open?: boolean } = $props();
	let query = $state('');
	let selected = $state(0);
	let mini = $state<MiniSearch | null>(null);

	$effect(() => {
		if (open && !mini) {
			fetch(`/search/${RULESET}.json`)
				.then((r) => r.text())
				.then((json) => (mini = MiniSearch.loadJSON(json, SEARCH_OPTIONS as never)));
		}
	});

	const results = $derived(
		mini && query.length > 1
			? mini.search(query, { prefix: true, fuzzy: 0.2, boost: { label: 3 } }).slice(0, 12)
			: []
	);
	$effect(() => { query; selected = 0; });

	function go(hit: { id: string; sectionSlug: string }) {
		open = false;
		query = '';
		goto(`/rules/${RULESET}/${hit.sectionSlug}#${encodeURIComponent(hit.id)}`);
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, results.length - 1); }
		if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); }
		if (e.key === 'Enter' && results[selected]) go(results[selected] as never);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-navy-deep/70 backdrop-blur-sm" />
		<Dialog.Content class="fixed top-24 left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl bg-white shadow-2xl">
			<Dialog.Title class="sr-only">Search the rules</Dialog.Title>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={query}
				onkeydown={onKeydown}
				autofocus
				placeholder="Search the rules… (e.g. stall count, travel)"
				class="w-full border-b border-mist px-5 py-4 text-navy outline-none placeholder:text-navy/40"
			/>
			<ul class="max-h-96 overflow-y-auto p-2">
				{#each results as hit, i (hit.id)}
					<li>
						<button
							class="w-full rounded-lg px-3 py-2.5 text-left {i === selected ? 'bg-mist' : 'hover:bg-mist/60'}"
							onmouseenter={() => (selected = i)}
							onclick={() => go(hit as never)}
						>
							<span class="font-mono text-xs font-semibold text-cardinal">{hit.label}</span>
							<span class="ml-2 text-xs text-navy/50 uppercase">{hit.sectionTitle}</span>
							<p class="mt-0.5 line-clamp-2 text-sm text-navy">{hit.text}</p>
						</button>
					</li>
				{:else}
					{#if query.length > 1 && mini}
						<li class="px-3 py-6 text-center text-sm text-navy/50">No rules match “{query}”.</li>
					{/if}
				{/each}
			</ul>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
```

- [ ] **Step 3: Wire shortcut + nav button** — in `+layout.svelte`:

```svelte
<script>
	import SearchDialog from '$lib/components/SearchDialog.svelte';
	let searchOpen = $state(false);
	// pass an "onSearch" prop to Nav: <Nav onSearch={() => (searchOpen = true)} />
</script>

<svelte:window
	onkeydown={(e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchOpen = true; }
	}}
/>
<SearchDialog bind:open={searchOpen} />
```

In `Nav.svelte`, accept `onSearch?: () => void` prop; add a button before the links: rounded border, magnifier glyph `⌕` (or inline SVG), text `Search`, kbd hint `⌘K`, `onclick={onSearch}`.

- [ ] **Step 4: Verify** — dev server: `Cmd+K` → type "stall" → results show rule labels + section names; Enter navigates to the rule and flashes it. Works from the landing page too. `npm run check` passes.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Cmd+K rules search over prebuilt MiniSearch index"
```

---

### Task 10: Landing page + stub routes

**Files:**
- Create: `docs/design/landing-mockup.html` (copied reference)
- Modify: `src/routes/+page.svelte`
- Create: `src/routes/quiz/+page.svelte`, `src/routes/ask/+page.svelte`

**Interfaces:**
- Consumes: theme utilities from Task 2; approved mockup as the visual source of truth.
- Produces: final Phase 1 landing; stub pages so nav links never 404.

- [ ] **Step 1: Preserve the mockup as an in-repo design reference**

```bash
mkdir -p docs/design
cp .superpowers/brainstorm/69836-1783630796/content/navy-first-landing.html docs/design/landing-mockup.html
```

Read it before building — layout, spacing, and card language should match it closely (it was user-approved).

- [ ] **Step 2: Implement `src/routes/+page.svelte`** — one-viewport landing per the mockup and Global Constraints copy:

```svelte
<script lang="ts">
	import Chip from '$lib/components/Chip.svelte';
	const RULESET = 'usau-official-2026-27';
</script>

<svelte:head><title>Best Perspective — the rules of ultimate</title></svelte:head>

<section class="mx-auto flex min-h-[calc(100vh-4rem-4.5rem)] max-w-6xl flex-col justify-center px-4 py-12 sm:px-6">
	<Chip label="2026-2027 Official Rules" />
	<h1 class="display mt-5 text-[clamp(3.5rem,10vw,7.5rem)] text-white">
		Know the<br /><span class="text-cardinal">Rules.</span>
	</h1>
	<p class="mt-5 max-w-xl text-lg text-white/70">
		The official rules of ultimate — explorable, searchable, and quizzable.
	</p>

	<div class="mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
		<a
			href="/rules/{RULESET}"
			class="group rounded-xl bg-white p-6 text-navy transition-transform hover:-translate-y-0.5"
		>
			<h2 class="display text-2xl">Explore the rules</h2>
			<p class="mt-1.5 text-sm text-navy/70">
				Every section, definition, and official annotation — linked, searchable, readable.
			</p>
			<span class="mt-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-1">→</span>
		</a>
		<a
			href="/quiz"
			class="group rounded-xl bg-white p-6 text-navy transition-transform hover:-translate-y-0.5"
		>
			<h2 class="display text-2xl">Test yourself</h2>
			<p class="mt-1.5 text-sm text-navy/70">
				Quick quizzes, game scenarios, and section mastery — with rule citations.
			</p>
			<span class="mt-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-1">→</span>
		</a>
	</div>

	<a href="/ask" class="mt-6 inline-flex max-w-3xl items-center gap-2 text-sm text-white/60 hover:text-white">
		<span aria-hidden="true">✦</span> Ask a rules question — grounded answers with citations
	</a>
</section>
```

Compare against `docs/design/landing-mockup.html` in the browser and adjust spacing/sizes until they visibly match.

- [ ] **Step 3: Stub pages.** Both share the pattern (navy shell, centered):

`src/routes/quiz/+page.svelte`:

```svelte
<svelte:head><title>Quiz · Best Perspective</title></svelte:head>
<section class="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 text-center">
	<p class="text-xs font-semibold tracking-[0.18em] text-cardinal uppercase">Coming soon</p>
	<h1 class="display mt-3 text-5xl text-white">Test yourself</h1>
	<p class="mt-4 text-white/70">
		Quick quizzes, scenario drills, and section mastery are on the way. Until then, hit the books.
	</p>
	<a href="/rules" class="mt-8 rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110">Explore the rules</a>
</section>
```

`src/routes/ask/+page.svelte`: same layout; h1 `Ask the rules`, body copy "Natural-language answers with exact rule citations arrive in a later phase."

- [ ] **Step 4: Verify** — landing matches mockup at desktop + 390px mobile width; all three nav links resolve; `npm run check` + `npm run build` pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: landing page per approved mockup + quiz/ask stubs"
```

---

### Task 11: Playwright e2e + README + final verification

**Files:**
- Create: `playwright.config.ts`, `e2e/explorer.spec.ts`
- Create: `README.md`
- Modify: `.github/workflows/ci.yml`, `package.json`

**Interfaces:**
- Consumes: the built app served by `wrangler dev`.
- Produces: `npm run test:e2e`; CI runs unit + e2e; README documents setup/ingest/deploy.

- [ ] **Step 1: Config** — `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	use: { baseURL: 'http://127.0.0.1:8787' },
	webServer: {
		command: 'npm run build && npx wrangler dev --port 8787',
		url: 'http://127.0.0.1:8787',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
```

Add script `"test:e2e": "playwright test"`.

- [ ] **Step 2: Write the smoke tests** — `e2e/explorer.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('landing → explore → read a rule', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /know the rules/i })).toBeVisible();
	await page.getByRole('link', { name: /explore the rules/i }).click();
	await expect(page).toHaveURL(/\/rules\/usau-official-2026-27$/);
	await page.getByRole('link', { name: /spirit of the game/i }).first().click();
	await expect(page.getByRole('heading', { name: /spirit of the game/i })).toBeVisible();
	await expect(page.locator('[id="2.A"]')).toBeVisible();
});

test('cmd+k search jumps to a rule', async ({ page }) => {
	await page.goto('/');
	await page.keyboard.press('ControlOrMeta+k');
	await page.getByPlaceholder(/search the rules/i).fill('stall count');
	await page.getByRole('button').filter({ hasText: /stall/i }).first().click();
	await expect(page).toHaveURL(/\/rules\/usau-official-2026-27\/.+#/);
});

test('glossary popover opens with definition link', async ({ page }) => {
	await page.goto('/rules/usau-official-2026-27/9');
	const dfn = page.locator('article dfn[data-rule]').first();
	await dfn.click();
	await expect(page.getByRole('link', { name: /definition 3\./i })).toBeVisible();
});

test('quiz and ask stubs resolve', async ({ page }) => {
	for (const path of ['/quiz', '/ask']) {
		await page.goto(path);
		await expect(page.getByText(/coming soon|later phase/i)).toBeVisible();
	}
});
```

- [ ] **Step 3: Run** — `npx playwright install chromium` then `npm run test:e2e` → all 4 PASS. Debug the app (not the tests) on failure, unless a selector genuinely mismatches implemented markup.

- [ ] **Step 4: CI** — append to the `ci` job after the build step:

```yaml
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
```

- [ ] **Step 5: README.md** — document: what Best Perspective is (one paragraph + attribution/disclaimer), stack, `npm i` / `npm run dev`, content pipeline (`npm run ingest -- --refetch` to re-scrape; content is committed), testing commands, deploy (`npx wrangler login && npx wrangler deploy`, or connect the repo to Cloudflare Workers Builds), and the phase roadmap from the spec.

- [ ] **Step 6: Full verification suite**

```bash
npx prettier --check . && npm run check && npm run test && npm run validate:content && npm run build && npm run test:e2e
```

All green. Then:

```bash
git add -A && git commit -m "test: e2e smoke suite + README"
```

---

## Deferred to later phases (do NOT build now)

- Phase 2: quiz engine, question bank, quick/mastery/timed modes, "Quiz me on this section" shortcut on section headers
- Phase 3: better-auth + Google OAuth, D1 progress, dashboard, bookmarks UI
- Phase 4: Gemini scenario generation, ask-the-rules, cost guardrails
- Club Guidelines ingest (add a `RULESETS` entry + parser tolerance when requested)
