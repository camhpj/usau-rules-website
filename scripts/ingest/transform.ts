import * as cheerio from 'cheerio';
import MiniSearch, { type Options } from 'minisearch';
import type { GlossaryEntry, RuleNode, Section } from '../../src/lib/content/types';
import { SEARCH_OPTIONS } from '../../src/lib/search/options';

export { SEARCH_OPTIONS } from '../../src/lib/search/options';

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Depth-first walk over every rule (all nesting levels) across all sections. */
function walkRules(sections: Section[], fn: (rule: RuleNode, section: Section) => void): void {
	const visit = (rule: RuleNode, section: Section) => {
		fn(rule, section);
		for (const child of rule.children) visit(child, section);
	};
	for (const section of sections) {
		for (const rule of section.rules) visit(rule, section);
	}
}

export function sectionSlugForRuleId(id: string): string | null {
	if (id === 'preface') return 'preface';
	const appendixAnchor = id.match(/^appendix_([a-gA-G])$/);
	if (appendixAnchor) return `appendix-${appendixAnchor[1].toLowerCase()}`;
	const appendixRule = id.match(/^([A-Za-z])\d/);
	if (appendixRule) return `appendix-${appendixRule[1].toLowerCase()}`;
	const numeric = id.match(/^(\d+)/);
	if (numeric) return numeric[1];
	return null;
}

/** True for ids that address a whole section (no rule-level hash needed). */
function isSectionLevelId(id: string): boolean {
	return id === 'preface' || /^\d+$/.test(id) || /^appendix_[a-gA-G]$/.test(id);
}

const CROSS_REF_PATTERNS = [/^https:\/\/usaultimate\.org\/rules\/#(.+)$/, /^#(.+)$/];

/** Rewrites source cross-ref hrefs to internal routes in place; returns whether anything changed. */
function rewriteHrefsIn(
	$: cheerio.CheerioAPI,
	rulesetId: string,
	onId?: (id: string) => void
): boolean {
	let changed = false;
	$('a[href]').each((_, el) => {
		const href = $(el).attr('href');
		if (!href) return;
		let id: string | null = null;
		for (const pattern of CROSS_REF_PATTERNS) {
			const match = href.match(pattern);
			if (match) {
				id = match[1];
				break;
			}
		}
		if (id === null) return;
		onId?.(id);
		const slug = sectionSlugForRuleId(id);
		if (slug === null) return; // unmappable id: leave href unchanged
		const newHref = isSectionLevelId(id)
			? `/rules/${rulesetId}/${slug}`
			: `/rules/${rulesetId}/${slug}#${id}`;
		$(el).attr('href', newHref);
		changed = true;
	});
	return changed;
}

export function rewriteCrossRefs(sections: Section[], rulesetId: string): void {
	walkRules(sections, (rule) => {
		if (!rule.html) return;
		const $ = cheerio.load(rule.html, null, false);
		const refs = new Set(rule.refs);
		const changed = rewriteHrefsIn($, rulesetId, (id) => refs.add(id));
		rule.refs = Array.from(refs);
		if (changed) rule.html = $.html();
	});
	// Section-level html (appendix tables, intro divs) can also carry raw source
	// hrefs; rewrite them the same way. Sections have no refs array to record into.
	for (const section of sections) {
		if (!section.html) continue;
		const $ = cheerio.load(section.html, null, false);
		const changed = rewriteHrefsIn($, rulesetId);
		if (changed) section.html = $.html();
	}
}

function scanImages(html: string | null, onSrc: (src: string) => void): void {
	if (!html) return;
	const $ = cheerio.load(html, null, false);
	$('img[src]').each((_, el) => {
		const src = $(el).attr('src');
		if (src) onSrc(src);
	});
}

export function collectImageUrls(sections: Section[]): string[] {
	const seen = new Set<string>();
	const order: string[] = [];
	const record = (src: string) => {
		if (!seen.has(src)) {
			seen.add(src);
			order.push(src);
		}
	};
	for (const section of sections) {
		scanImages(section.html, record);
		walkRules([section], (rule) => scanImages(rule.html, record));
	}
	return order;
}

function rewriteImagesInHtml(html: string, map: Map<string, string>): string {
	const $ = cheerio.load(html, null, false);
	let changed = false;
	$('img[src]').each((_, el) => {
		const src = $(el).attr('src');
		if (src && map.has(src)) {
			$(el).attr('src', map.get(src)!);
			changed = true;
		}
	});
	return changed ? $.html() : html;
}

export function rewriteImageUrls(sections: Section[], map: Map<string, string>): void {
	for (const section of sections) {
		if (section.html) section.html = rewriteImagesInHtml(section.html, map);
		walkRules([section], (rule) => {
			if (rule.html) rule.html = rewriteImagesInHtml(rule.html, map);
		});
	}
}

export function extractGlossary(sections: Section[]): GlossaryEntry[] {
	const section = sections.find((s) => s.slug === '3');
	if (!section) return [];
	const glossary: GlossaryEntry[] = [];
	// Definitions can be grouped under a header-only rule (e.g. "3.Q Roles" with
	// term-defining children), so recurse through the whole section 3 tree rather
	// than just its top-level rules.
	const visit = (rule: RuleNode) => {
		const colonIndex = rule.text.indexOf(':');
		if (colonIndex !== -1) {
			const term = rule.text.slice(0, colonIndex).trim();
			if (term.length >= 2 && term.length <= 60) {
				glossary.push({ ruleId: rule.id, term, definition: rule.text });
			}
		}
		for (const child of rule.children) visit(child);
	};
	for (const rule of section.rules) visit(rule);
	return glossary;
}

interface TextNodeRef {
	node: { data: string };
}

/** Depth-first collection of text nodes, skipping subtrees rooted at <a>/<dfn>. */
function collectWrappableTextNodes($: cheerio.CheerioAPI): TextNodeRef[] {
	const out: TextNodeRef[] = [];
	const visit = (node: unknown, skip: boolean) => {
		const n = node as { type: string; name?: string; children?: unknown[]; data?: string };
		if (n.type === 'text') {
			if (!skip) out.push({ node: n as { data: string } });
			return;
		}
		const children = n.children;
		if (!children) return;
		const childSkip = skip || (n.type === 'tag' && (n.name === 'a' || n.name === 'dfn'));
		for (const child of children) visit(child, childSkip);
	};
	const root = $.root().get(0);
	if (root) visit(root, false);
	return out;
}

export function wrapGlossaryTerms(sections: Section[], glossary: GlossaryEntry[]): void {
	const sortedTerms = [...glossary].sort((a, b) => b.term.length - a.term.length);
	walkRules(sections, (rule, section) => {
		if (section.slug === '3') return;
		if (!rule.html) return;
		const $ = cheerio.load(rule.html, null, false);
		const wrapped = new Set<string>();
		let mutated = false;
		for (const entry of sortedTerms) {
			if (wrapped.has(entry.ruleId)) continue;
			const regex = new RegExp(`\\b(${escapeRegExp(entry.term)})\\b`, 'i');
			const textNodes = collectWrappableTextNodes($);
			for (const { node } of textNodes) {
				const data = node.data;
				const match = data.match(regex);
				if (match && match.index !== undefined) {
					const before = data.slice(0, match.index);
					const matched = match[0];
					const after = data.slice(match.index + matched.length);
					const replacement = `${escapeHtml(before)}<dfn data-rule="${entry.ruleId}">${escapeHtml(matched)}</dfn>${escapeHtml(after)}`;
					$(node as never).replaceWith(replacement);
					wrapped.add(entry.ruleId);
					mutated = true;
					break;
				}
			}
		}
		if (mutated) rule.html = $.html();
	});
}

export function buildGrounding(sections: Section[], header: string): string {
	const lines: string[] = [header];
	for (const section of sections) {
		lines.push(`## ${section.number ? section.number + '. ' : ''}${section.title}`);
		const walk = (rule: RuleNode, depth: number) => {
			const indent = '  '.repeat(depth);
			lines.push(`${indent}[${rule.id}] ${rule.text}`);
			for (const annotation of rule.annotations) {
				lines.push(`${indent}  (annotation) ${annotation}`);
			}
			for (const child of rule.children) walk(child, depth + 1);
		};
		for (const rule of section.rules) walk(rule, 0);
		if (section.html) {
			const $ = cheerio.load(section.html, null, false);
			const text = normalize($.text());
			if (text) lines.push(text);
		}
	}
	return lines.join('\n');
}

interface SearchDoc {
	id: string;
	label: string;
	text: string;
	sectionSlug: string;
	sectionTitle: string;
}

export function buildSearchIndexJson(sections: Section[]): string {
	// SEARCH_OPTIONS is `as const` (readonly arrays); MiniSearch's Options wants
	// mutable string[], so spread into fresh arrays rather than casting away safety.
	const options: Options<SearchDoc> = {
		fields: [...SEARCH_OPTIONS.fields],
		storeFields: [...SEARCH_OPTIONS.storeFields]
	};
	const mini = new MiniSearch<SearchDoc>(options);
	const docs: SearchDoc[] = [];
	walkRules(sections, (rule, section) => {
		docs.push({
			id: rule.id,
			label: rule.label,
			text: rule.text,
			sectionSlug: section.slug,
			sectionTitle: section.title
		});
	});
	mini.addAll(docs);
	return JSON.stringify(mini);
}
