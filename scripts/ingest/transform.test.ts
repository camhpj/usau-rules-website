import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import MiniSearch from 'minisearch';
import { parseRulesHtml } from './parse';
import {
	SEARCH_OPTIONS,
	buildGrounding,
	buildSearchIndexJson,
	collectImageUrls,
	extractGlossary,
	rewriteCrossRefs,
	rewriteImageUrls,
	sectionSlugForRuleId,
	wrapGlossaryTerms
} from './transform';

const fixture = () =>
	parseRulesHtml(readFileSync('scripts/ingest/fixtures/sample.html', 'utf8')).sections;

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

	it('rewrites hrefs in section-level html (appendix intro/table content), not just rule html', () => {
		const { sections } = parseRulesHtml(
			'<ul class="main-rules"><li><a id="appendix_c">Appendix C.</a> Misconduct' +
				'<div class="plain"><a href="https://usaultimate.org/rules/#9.A">Section 9.A</a></div>' +
				'</li></ul>'
		);
		rewriteCrossRefs(sections, 'usau-official-2026-27');
		const appendixC = sections.find((s) => s.slug === 'appendix-c')!;
		expect(appendixC.html).toContain('href="/rules/usau-official-2026-27/9#9.A"');
	});
});

describe('images', () => {
	it('collects and rewrites image urls', () => {
		const sections = fixture();
		const urls = collectImageUrls(sections);
		expect(urls).toEqual([
			'https://raw.githubusercontent.com/andrewlovseth/rules-of-ultimate/master/images/field.png'
		]);
		rewriteImageUrls(sections, new Map([[urls[0], '/rules-media/field.png']]));
		expect(sections.find((s) => s.slug === 'appendix-a')!.html).toContain(
			'src="/rules-media/field.png"'
		);
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

	it('recurses into nested definitions (e.g. under a header-only "Roles" rule)', () => {
		const { sections } = parseRulesHtml(
			'<ul class="main-rules"><li><a id="3">3.</a> Definitions<ul>' +
				'<li><a id="3.A">3.A.</a> Brick: A pull landing out-of-bounds.</li>' +
				'<li><a id="3.Q">3.Q.</a> Roles<ul>' +
				'<li><a id="3.Q.1">3.Q.1.</a> Captain: A player who represents the team.</li>' +
				'<li><a id="3.Q.2">3.Q.2.</a> Coach: A non-player who instructs.</li>' +
				'</ul></li></ul></li></ul>'
		);
		const glossary = extractGlossary(sections);
		expect(glossary).toMatchObject([
			{ ruleId: '3.A', term: 'Brick' },
			{ ruleId: '3.Q.1', term: 'Captain' },
			{ ruleId: '3.Q.2', term: 'Coach' }
		]);
		expect(glossary.map((e) => e.ruleId)).not.toContain('3.Q'); // header-only, no colon
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
		// Every body line must be citable: a section header, a [id]-prefixed rule,
		// or an (annotation) attached to one. Uncited prose can't be cited by the AI.
		const body = g.slice(g.indexOf('## '));
		const uncited = body.split('\n').filter((line) => {
			const t = line.trimStart();
			return t && !t.startsWith('##') && !t.startsWith('[') && !t.startsWith('(annotation)');
		});
		expect(uncited).toEqual([]);
	});

	it('builds a loadable MiniSearch index', () => {
		const json = buildSearchIndexJson(fixture());
		const mini = MiniSearch.loadJSON(json, SEARCH_OPTIONS as never);
		const hits = mini.search('self-officiated');
		expect(hits[0].id).toBe('1.A');
	});
});
