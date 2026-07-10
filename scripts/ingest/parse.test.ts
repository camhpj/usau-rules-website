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
		expect(byslug['appendix-b']).toMatchObject({
			number: 'B',
			kind: 'appendix',
			title: 'Mixed Rules and Adaptations'
		});
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

	it('throws when no sections are found', () => {
		expect(() => parseRulesHtml('<html><body><p>nothing</p></body></html>')).toThrow(/no sections/);
	});

	it('accepts header-only rules with empty own text', () => {
		const minimal = `<html><body><ul class="main-rules"><li>
			<a id="9">9.</a> Stalls
			<ul>
				<li><a id="9.A">9.A.</a><ul><li><a id="9.A.1">9.A.1.</a> Child text.</li></ul></li>
			</ul>
		</li></ul></body></html>`;
		const result = parseRulesHtml(minimal);
		const headerOnly = result.sections[0].rules[0];
		expect(headerOnly.text).toBe('');
		expect(headerOnly.html).toBe('');
		expect(headerOnly.children).toHaveLength(1);
		expect(headerOnly.children[0].id).toBe('9.A.1');
	});

	it('keeps direct-child tables as section html and out of the title', () => {
		const minimal = `<html><body><ul class="main-rules"><li>
			<a id="appendix_e">Appendix E:</a> Youth Rules Adaptations
			<div class="plain">Intro.</div>
			<table><tbody><tr><td>U-12</td></tr></tbody></table>
			<ul><li><a id="E1">E1.</a> A rule.</li></ul>
		</li></ul></body></html>`;
		const { sections: s } = parseRulesHtml(minimal);
		const appendixE = s[0];
		expect(appendixE.title).toBe('Youth Rules Adaptations');
		expect(appendixE.html).toContain('<div');
		expect(appendixE.html).toContain('<table');
		expect(appendixE.rules.map((r) => r.id)).toEqual(['E1']);
	});
});
