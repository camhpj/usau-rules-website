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

	// title = the li's direct text nodes only (element content can never leak in)
	const title = normalize(
		li
			.contents()
			.filter((_, n) => n.type === 'text')
			.text()
	);

	// non-rule section content (appendix tables/diagrams): every direct element
	// child except the id anchor and the rule <ul>s
	const anchorEl = anchor.get(0);
	const extras = li
		.children()
		.toArray()
		.filter((el) => el !== anchorEl && el.tagName !== 'ul');
	const html = extras.length > 0 ? normalize(extras.map((el) => $.html(el)).join('\n')) : null;

	if (appendixMatch) {
		const letter = appendixMatch[1].toUpperCase();
		return {
			slug: `appendix-${appendixMatch[1]}`,
			anchorId,
			number: letter,
			kind: 'appendix',
			title,
			html,
			rules
		};
	}
	return { slug: anchorId, anchorId, number: anchorId, kind: 'section', title, html, rules };
}

export function parseRulesHtml(html: string): { sections: Section[] } {
	const $ = cheerio.load(html);
	const sections: Section[] = [];

	const prefaceBody = $('#prefaceBody');
	if (prefaceBody.length > 0) {
		sections.push({
			slug: 'preface',
			anchorId: 'preface',
			number: null,
			kind: 'preface',
			title: 'Preface',
			html: normalize(prefaceBody.html() ?? ''),
			rules: []
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
